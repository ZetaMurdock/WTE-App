// The outcome ledger: the missing edge between a roll and what it DOES.
//
// The Codex has always known which rolls an ability calls for — `parseAbilityActions`
// recovers the routes, the DVs and the damage dice from the prose. What no layer
// recovered was the CONSEQUENCE edge: the parsed save was never linked to the
// parsed damage, so "or takes 2d8" produced two sibling buttons and a human had
// to remember which one followed which.
//
// This module closes that loop without any new authoring format. A save request
// already travels the wire carrying its source ability and its DV; when the
// validated result comes back, we know the verdict, and the ability's own prose
// tells us what a failure costs. That is enough to hand the Curator a card that
// says "Kira failed — apply 3d10 Cold?" instead of leaving them to do the
// bookkeeping by hand.
//
// Deliberately NOT an authority: nothing here writes to a token. The ledger
// computes and proposes; VttScreen applies through the same validated ops a
// Curator's manual edit uses. The Curator stays sovereign.
import { parseAbilityActions } from "../../game/abilityActions";
import { effectStepLabel, type EffectStep } from "../../game/abilityEffects";
import { counterThresholds, stepsAtThreshold } from "../../game/counterTracks";
import { rollRefLabel } from "../../game/inceptGrants";

/** How a resolution landed. `pending` means the roll has not arrived yet. */
export type OutcomeVerdict = "pass" | "fail" | "pending";

/** Which verdict arms a consequence. Most ability prose describes the failure
 *  branch only, so `fail` is the default the deriver assigns. */
export type ConsequenceTrigger = "fail" | "pass" | "always";

export type ConsequenceKind = "damage" | "heal" | "condition" | "ruling" | "counter";

/**
 * What a track owes the table at one of its `At N` marks.
 *
 * Precomputed and carried ON the counter consequence, for the reason
 * `VttEffectTick` is flat: the crossing happens when the Curator presses Apply,
 * and by then the ability's page — and its step list — is long out of scope. The
 * card is the only thing still holding the declaration, so it has to hold all of
 * it.
 *
 * `consequences` never contains another counter's thresholds. A page that writes
 * `At 8: Counter: Blight +1` on the Blight track is asking for a loop, and the
 * deriver refuses to build one rather than recursing until the stack gives out.
 */
export interface CounterThreshold {
  at: number;
  consequences: OutcomeConsequence[];
}

export interface OutcomeConsequence {
  /** Stable within its outcome, so the card can track what was already applied. */
  id: string;
  kind: ConsequenceKind;
  /** What the button says: "3d10 Cold", "Slowed · 2 rounds", "Curator adjudicates". */
  label: string;
  on: ConsequenceTrigger;
  /** Dice for damage/heal, `parseDiceTerms`-compatible. */
  expr?: string;
  damageType?: string;
  /** Condition tag applied to `token.statuses`. */
  condition?: string;
  /** Rounds the prose gives the condition, when it names one. */
  rounds?: number;
  /** Prose says a successful save still takes half — the card offers both. */
  half?: boolean;
  /** counter — the track this row moves, as the page named it. Open text like a
   *  condition tag: Blight, Fear Points and Overload Charges are one mechanism
   *  with many names, and a table inventing its own currency must not need a
   *  code change to spend it. */
  counter?: string;
  /** counter — how far the track moves, signed. */
  delta?: number;
  /** counter — the ceiling the page declared for it, when it declared one. */
  cap?: number;
  /** counter — what this track owes at each `At N` the page declared. Empty for
   *  a track that is only a number the table reads. */
  thresholds?: CounterThreshold[];
  /** The ability's own page declared this step, rather than the prose scanner
   *  recovering it from a sentence. A reader has to be able to tell the two
   *  apart — one is what the author wrote, the other is the engine's best
   *  reading of what they meant — and only the first is ever safe to apply
   *  without a Curator's click. */
  declared?: boolean;
}

/**
 * One target inside a resolution — its own roll, its own verdict, its own
 * record of what already landed on it.
 *
 * Every field here used to sit directly on `PendingOutcome`, because a
 * resolution was a resolution against one token. An area ability breaks that:
 * Hail Rain over a corridor is ONE ability, ONE save DV and ONE set of declared
 * consequences resolving against everyone standing in it. Splitting that into
 * 23 sibling cards would have made the Curator confirm the same ability 23
 * times — the point at which "confirm everything" stops being sovereignty and
 * starts being an obstacle people route around.
 *
 * So the per-target half moved down here and the shared half stayed up there.
 * A single-target card is the degenerate case with exactly one of these, which
 * is why there is still only one card component, one store, one expiry rule and
 * one auto-apply gate rather than two of each drifting apart.
 */
export interface OutcomeTarget {
  /** Stable within its outcome. The token id where there is one, so a second
   *  arrival naming the same token lands on the row that already exists rather
   *  than opening a duplicate beside it. */
  id: string;
  tokenId?: string;
  name: string;
  /** Ties THIS target to the roll request that will settle it. Per target, not
   *  per card: 23 targets means 23 requests, arriving in whatever order their
   *  owners get to them. */
  requestId?: string;
  rollTotal?: number;
  verdict: OutcomeVerdict;
  /** Consequence ids already committed against this target, so re-applying
   *  takes a deliberate act — and so one target's applied damage can never
   *  suppress another's. */
  applied: string[];
  /** Consequence ids the Curator applied and then took back with undo.
   *
   *  Auto-apply needs to know the difference between "never committed" and
   *  "committed and reversed". Without it, undoing an auto-applied hit only
   *  held until the panel remounted — the row was armed again, the ref that
   *  fires each consequence once was gone with the unmount, and the damage the
   *  Curator had just taken off the token landed a second time. A by-hand Apply
   *  is still offered; only the unattended path is refused. */
  reversed?: string[];
  /** The token left the scene while the card was still open. Kept on the card
   *  rather than deleted: a Curator who sees a target simply vanish from a
   *  23-row list has no way to tell that from a row they mis-counted. */
  removed?: boolean;
  /** The round was still waiting on this target when the round advanced. See
   *  `lapsePendingTargets` for what that does and — far more importantly —
   *  what it refuses to do. */
  lapsedRound?: number;
}

/**
 * Whether an area ability's damage is one roll or one roll per target.
 *
 * The corpus writes BOTH, in so many words, so neither can be the only thing
 * the card supports:
 *
 *  - per-target — the Gluttony's MASS DEVOUR (rules/Anima__Gluttony.md): "All
 *    creatures within 30ft make DEF Check (DC 13) or take 3d10 damage each."
 *    Chainquake (rules/Archetypes.md) states it as a rule: "Roll a separate d8
 *    for each target."
 *  - shared — RECURRING CHAOS (rules/Archetype_List.md), whose d10 result 2 is
 *    "All enemies within a 45-foot radius take half the damage inflicted": the
 *    d20 was rolled once and the whole radius reads off it.
 *
 * `per-target` is the default because it is the reading a table can always
 * narrow. A Curator who wanted one roll can roll once and say so; a card that
 * assumed one roll and was wrong has already told 23 tokens the same wrong
 * number, and the dice cannot be un-rolled.
 */
export type DamageRollMode = "per-target" | "shared";

export interface PendingOutcome {
  id: string;
  /** Permanent ability id when the source carries one; the positional id otherwise. */
  sourceAbilityId: string;
  sourceAbilityName: string;
  casterCharacterId?: string;
  /** Everyone this ability is resolving against. Never empty; length 1 is the
   *  single-target card the app has shipped since P0. */
  targets: OutcomeTarget[];
  /** The DV every target's roll must meet. Shared on purpose — one ability
   *  poses one DV, and a per-target DV would be a different ability. */
  dc?: number;
  rollLabel: string;
  /** The card was read off the page's `## Actions` block rather than off its
   *  prose. Recorded here rather than re-derived from `consequences`, because a
   *  block that declares only a Cost and a Save produces no consequences at all
   *  — and a card that inferred its source from an empty list would tell the
   *  Curator the PROSE named nothing, sending them off to read a page whose
   *  block had already superseded it. */
  fromBlock: boolean;
  /**
   * NOTHING WAS ROLLED FOR THIS CARD, and nothing will be.
   *
   * Every card until now existed because a die was thrown: a save went out, a
   * verdict came back, and the consequences hung off it. A track crossing its
   * threshold is not that. The event already HAPPENED — Blight reached 8 — and
   * the card exists only to route what the page declared past a human before it
   * touches a token.
   *
   * So an unrolled card's `always` consequences are armed with no verdict at
   * all (see `armedConsequences`), it is never marked lapsed by a passing round
   * (there is no answer it is waiting for), and it does not expire on the roll
   * TTL. Branch-armed rows still need a verdict, and the Curator's declare
   * buttons still supply one — a page may write `At 8: Fail: …` and mean it.
   */
  unrolled?: boolean;
  consequences: OutcomeConsequence[];
  /** One roll for everyone, or one each. Derived from the page and then the
   *  Curator's to change — the card shows which is in force. */
  damageRoll: DamageRollMode;
  /** The table, not the deriver, chose the mode above. The card says so, because
   *  "the page told me" and "you told me" are different claims. */
  damageRollByHand?: boolean;
  createdAt: number;
  expiresAt: number;
}

/**
 * Conditions the corpus actually writes, as a closed alternation.
 *
 * Closed on purpose, exactly like `DAMAGE_TYPE_WORDS`: a scanner that accepts
 * any capitalised word downstream of "is" would tag half the prose.
 *
 * It is a SCANNER, not the definition of what conditions exist. That lives on
 * the Conditions pages (game/conditions.ts + rules/Condition_*.md), where a
 * table can add "Blighted" — or delete Charmed — without touching this parser.
 * A page set may therefore be larger than this list; what it must not be is
 * smaller, or the ledger would tag prose with a condition nothing can resolve.
 * conditions.test.ts holds that direction.
 */
export const CONDITION_WORDS = [
  "Incapacitated", "Unconscious", "Paralyzed", "Petrified", "Restrained", "Grappled",
  "Stunned", "Blinded", "Deafened", "Silenced", "Slowed", "Prone", "Frightened",
  "Charmed", "Disoriented", "Exhausted", "Anchored", "Burning", "Bleeding",
  "Poisoned", "Frozen", "Suppressed", "Weakened", "Invisible", "Stinous",
] as const;

const CONDITION_RE = new RegExp(
  `\\b(?:becomes?|is|are|be|left|knocked|rendered|gains?(?: the)?(?: condition)?)\\s+` +
    `(${CONDITION_WORDS.join("|")})\\b([^.;]{0,48})`,
  "gi"
);

// "for 2 rounds", "for 1 round", "for the next 3 rounds".
const ROUNDS_RE = /\bfor(?:\s+the\s+next)?\s+(\d{1,2})\s+rounds?\b/i;

// A success clause that still costs something: "or half as much on a success",
// "taking half damage on a successful save".
const HALF_RE = /\bhalf\b[^.;]{0,40}\b(?:success|successful|save|saves)\b|\b(?:success|successful|save)\b[^.;]{0,40}\bhalf\b/i;

function conditionsFrom(effect: string): OutcomeConsequence[] {
  const out: OutcomeConsequence[] = [];
  const seen = new Set<string>();
  CONDITION_RE.lastIndex = 0;
  for (let m = CONDITION_RE.exec(effect); m; m = CONDITION_RE.exec(effect)) {
    const word = m[1];
    // Conditions are proper nouns in this corpus — "are Stunned", "is Slowed",
    // "is Restrained" — while the same words appear lowercase as ordinary
    // description. The Stygian innate Locked in Time says "their Action Priority
    // is suppressed", which is prose about a stat, not the Suppressed condition,
    // and a case-blind scanner put a real chip on it.
    if (word[0] !== word[0].toUpperCase()) continue;
    const key = word.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const rounds = ROUNDS_RE.exec(m[2] ?? "")?.[1];
    const n = rounds ? Number(rounds) : undefined;
    out.push({
      id: `cond-${key}`,
      kind: "condition",
      label: n ? `${word} · ${n} round${n === 1 ? "" : "s"}` : word,
      on: "fail",
      condition: word,
      rounds: n,
    });
  }
  return out;
}

/**
 * What an ability costs its target, derived from the prose it already ships.
 *
 * Damage comes from the same parse the ability panel arms buttons with, so the
 * card can never offer dice the panel disagrees with. Everything the parser
 * cannot type — the transformations, the tampering, the Curator-adjudicated
 * payloads — yields NOTHING here. A silent card is honest; a `ruling` invented
 * from prose the deriver did not understand is the engine claiming authority it
 * does not have. The `ruling` kind exists for a Curator to attach by hand.
 */
export function consequencesFor(effect: string | null | undefined): OutcomeConsequence[] {
  const prose = effect || "";
  if (!prose.trim()) return [];
  const half = HALF_RE.test(prose);
  // The card speaks for the TARGET, so the caster's own price is not on it.
  // Psychic Scream deals 2d8 and costs the Inquisitor 1d4 backlash in the same
  // sentence; applying both to the target would charge them for being attacked.
  const damage = parseAbilityActions(prose)
    .filter((action) => action.kind === "damage" && action.expr && !action.self)
    .map((action, i) =>
      action.restorative
        ? {
            id: `heal-${i}`,
            kind: "heal" as const,
            label: action.label,
            on: "always" as const,
            expr: action.expr,
          }
        : {
            id: `dmg-${i}`,
            kind: "damage" as const,
            label: action.label,
            on: "fail" as const,
            expr: action.expr,
            damageType: action.damageType,
            half,
          }
    );
  return [...damage, ...conditionsFrom(prose)];
}

/**
 * What a DECLARED ability costs its target.
 *
 * The prose deriver above guesses from sentences; this reads what the page
 * actually said, so the branch a consequence hangs on is authored rather than
 * assumed — the whole reason the `## Actions` block exists. A `Ruling` finally
 * has a real source too: the deriver never invents one, but an author may write
 * one, and the card quotes it for the Curator to decide.
 *
 * Steps that resolve rather than land — Cost, Roll, Save — are not consequences
 * and contribute nothing here; the card is about what happens TO the target.
 *
 * `atThreshold` says these steps ARE a threshold's payload rather than a page's
 * top level, which flips two rules. Normally an `At 8:` step is skipped, because
 * a threshold fires when a track reaches 8 and not when the ability that moves
 * the track resolves — deriving it here would have made "At 8: Damage: 1d100"
 * land on the very first point of Blight. Inside a threshold's own payload the
 * opposite holds: those steps are exactly what is being derived, and they carry
 * no further thresholds of their own so the recursion is one level deep and
 * cannot be talked into a loop by a page.
 */
export function consequencesFromSteps(
  steps: readonly EffectStep[],
  atThreshold = false
): OutcomeConsequence[] {
  const out: OutcomeConsequence[] = [];
  steps.forEach((step, i) => {
    const on: ConsequenceTrigger = step.branch === "always" ? "always" : step.branch === "success" ? "pass" : "fail";
    if ((step.cadence === "at-threshold") !== atThreshold) return;
    // Min and tie are resolution nuances no phase executes yet. Treating them as
    // failures would apply damage the page never promised, so they are skipped
    // and stay visible in the ability's own step list.
    if (step.branch === "min" || step.branch === "tie") return;
    // The card speaks for the TARGET, so the caster's own price is not on it.
    // PSYCHIC SCREAM declares `Damage (self): 1d4 Psychic` — the Inquisitor's
    // backlash — one bullet below the 2d8 it deals, and a card bound to Kira
    // that offered both would charge her for being screamed at. `consequencesFor`
    // has dropped the caster's dice from prose since P0; the declared path has
    // to agree, or declaring a block would reintroduce the bug it replaced.
    if (step.who === "self") return;
    if (step.verb === "damage") {
      out.push({
        id: `dmg-${i}`,
        kind: "damage",
        label: effectStepLabel(step),
        on,
        expr: step.expr,
        damageType: step.damageType,
        half: step.half,
        declared: true,
      });
      return;
    }
    if (step.verb === "heal") {
      out.push({ id: `heal-${i}`, kind: "heal", label: effectStepLabel(step), on, expr: step.expr, declared: true });
      return;
    }
    if (step.verb === "condition" && step.condition) {
      out.push({
        id: `cond-${i}`,
        kind: "condition",
        label: effectStepLabel(step),
        on,
        condition: step.condition,
        rounds: step.duration?.kind === "rounds" ? step.duration.count : undefined,
        declared: true,
      });
      return;
    }
    if (step.verb === "modify" && step.ref) {
      // A roll penalty IS a condition as far as a table is concerned: it wants a
      // visible pip saying which route is hobbled and for how long.
      out.push({
        id: `mod-${i}`,
        kind: "condition",
        label: effectStepLabel(step),
        on,
        condition: `${step.modify === "disadvantage" ? "Disadv" : "Adv"}: ${rollRefLabel(step.ref)}`,
        rounds: step.duration?.kind === "rounds" ? step.duration.count : undefined,
        declared: true,
      });
      return;
    }
    if (step.verb === "counter" && step.counter && step.delta) {
      // The `At N` marks travel WITH the move, because the move is what will
      // cross them and the card is the last thing still holding the page.
      const thresholds: CounterThreshold[] = atThreshold
        ? []
        : counterThresholds(steps, step.counter)
            .map((at) => ({
              at,
              consequences: consequencesFromSteps(stepsAtThreshold(steps, step.counter as string, at), true),
            }))
            // A mark that owes nothing is not a mark. `At 8: Ruling: …` still
            // counts — a question for the Curator is a consequence — but an
            // `At 8:` line the deriver could not read must not leave an empty
            // threshold that fires a card with no rows on it.
            .filter((threshold) => threshold.consequences.length > 0);
      out.push({
        id: `ctr-${i}`,
        kind: "counter",
        label: effectStepLabel(step),
        on,
        counter: step.counter,
        delta: step.delta,
        ...(step.cap != null ? { cap: step.cap } : {}),
        ...(thresholds.length ? { thresholds } : {}),
        declared: true,
      });
      return;
    }
    if (step.verb === "ruling" && step.prompt) {
      out.push({ id: `rule-${i}`, kind: "ruling", label: step.prompt, on, declared: true });
    }
  });
  return out;
}

/**
 * The phrases that mean one number for everybody.
 *
 * Closed and small on purpose, like `CONDITION_WORDS` and `DAMAGE_TYPE_WORDS`
 * above it. `per-target` is the default, so this list only has to recognise the
 * exception — a phrase it misses costs a Curator one click on the card's own
 * toggle, while a phrase it over-reads rolls once for a page that said "each"
 * and hands 23 tokens a number that was never theirs.
 *
 * Every clause names a plural recipient for exactly that reason. A bare "the
 * same damage" was the first draft and the corpus refused it: Null's Reflect
 * says the redirected ability keeps "the same damage, Check or Save, Roll Path",
 * which is about one bounced attack and not about sharing a roll between bodies
 * — and Simulation's SIMULATED EJECT reads the same way. Both were tagged
 * `shared`, on abilities that hit one target. The test file holds that line
 * against the whole shipped corpus.
 *
 * Deliberately NOT readable from an `## Actions` block: the grammar has no word
 * for it, and inventing one here would put a rule in the engine that no page
 * could see or fork. When the block learns to say it, this deriver becomes the
 * fallback for the pages that never will.
 */
const SHARED_DAMAGE_RE =
  /\bhalf the damage inflicted\b|\b(?:the same|that) damage to (?:all|each|every|both)\b|\bdamage (?:is |gets )?(?:split|divided|shared) (?:evenly )?(?:among|between|across)\b|\b(?:one|a single)(?: damage)? roll for (?:all|every|everyone|the whole)\b/i;

/**
 * Which damage model an ability's own words describe.
 *
 * Answers `per-target` for silence, which is the whole point: an ability that
 * never says is resolved the way the corpus's explicit majority says, and the
 * card shows the answer so a table that disagrees can see what to change.
 */
export function damageRollModeFor(prose: string | null | undefined): DamageRollMode {
  return SHARED_DAMAGE_RE.test(prose || "") ? "shared" : "per-target";
}

/** A target as a caller names it, before the ledger gives it a row. */
export interface OutcomeTargetInput {
  tokenId?: string;
  name: string;
  requestId?: string;
  /** An id for a target with no token behind it. Ignored when `tokenId` is
   *  set — the token id is the better key, because it is the one a duplicate
   *  wire result arrives carrying. */
  id?: string;
}

export interface OpenOutcomeInput {
  id: string;
  sourceAbilityId: string;
  sourceAbilityName: string;
  effect?: string | null;
  casterCharacterId?: string;
  /** Everyone the ability is resolving against, in the order the card lists
   *  them. One entry is the single-target case; an area ability passes the
   *  bodies its template enclosed. */
  targets: readonly OutcomeTargetInput[];
  dc?: number;
  rollLabel: string;
  now: number;
  /** The ability's declared `## Actions` steps. When present these SUPERSEDE the
   *  prose deriver: an author who wrote the block said what happens, and guessing
   *  alongside them would put two answers on one card. */
  steps?: readonly EffectStep[] | null;
  /** How long an unsettled outcome stays on the card. Matches the roll-request
   *  window, so a card cannot outlive the request that would settle it. */
  ttlMs?: number;
}

export function openOutcome(input: OpenOutcomeInput): PendingOutcome {
  const seen = new Set<string>();
  const targets: OutcomeTarget[] = [];
  input.targets.forEach((target, i) => {
    // One row per token, even when a caller enumerates the same body twice. A
    // template that overlaps a token's squares, or a Curator who adds a target
    // already in the list, must not produce two rows that both offer to apply
    // the same 3d10 to the same creature.
    const id = target.tokenId || target.id || `t-${i}`;
    if (seen.has(id)) return;
    seen.add(id);
    targets.push({
      id,
      tokenId: target.tokenId,
      name: target.name,
      requestId: target.requestId,
      verdict: "pending",
      applied: [],
    });
  });
  return {
    id: input.id,
    sourceAbilityId: input.sourceAbilityId,
    sourceAbilityName: input.sourceAbilityName,
    casterCharacterId: input.casterCharacterId,
    targets,
    dc: input.dc,
    rollLabel: input.rollLabel,
    fromBlock: !!input.steps?.length,
    consequences: input.steps?.length ? consequencesFromSteps(input.steps) : consequencesFor(input.effect),
    // Read off the prose either way. A declared block has no word for the
    // distinction yet, and guessing it from the steps would be the engine
    // inventing a rule the page cannot state.
    damageRoll: damageRollModeFor(input.effect),
    createdAt: input.now,
    expiresAt: input.now + (input.ttlMs ?? 5 * 60_000),
  };
}

export function targetOf(outcome: PendingOutcome, targetId: string): OutcomeTarget | null {
  return outcome.targets.find((target) => target.id === targetId) ?? null;
}

function patchTarget(
  outcome: PendingOutcome,
  targetId: string,
  patch: (target: OutcomeTarget) => OutcomeTarget
): PendingOutcome {
  const found = outcome.targets.find((target) => target.id === targetId);
  if (!found) return outcome;
  const next = patch(found);
  if (next === found) return outcome;
  return { ...outcome, targets: outcome.targets.map((target) => (target.id === targetId ? next : target)) };
}

/**
 * Settle one target against the roll that answered for it.
 *
 * Meeting the DV is a success — the same `>=` the save chips print, so the card
 * and the chip can never disagree about what 18-vs-18 means. With no DV there is
 * nothing to compare, and the verdict stays the Curator's to declare.
 *
 * FIRST RESULT WINS. Rolls for a 23-target zone arrive over the wire from 23
 * machines, and a retried message, a reconnect replaying its queue, or a player
 * pressing Roll twice all deliver a second total for a target already settled.
 * Letting the later one through would move a verdict the Curator may already
 * have applied damage on — the `applied` marks would still be there, now
 * attached to a verdict that no longer produced them, and the card would read as
 * "passed · applied 27 damage". A human overriding is a different act with a
 * different door: `declareTargetVerdict`.
 */
export function settleTarget(outcome: PendingOutcome, targetId: string, rollTotal: number): PendingOutcome {
  return patchTarget(outcome, targetId, (target) => {
    if (target.rollTotal != null) return target;
    // A late roll answers the lapse it was late for. The card stops calling this
    // target outstanding because it no longer is.
    const settled: OutcomeTarget = { ...target, rollTotal, lapsedRound: undefined };
    if (outcome.dc == null) return settled;
    return { ...settled, verdict: rollTotal >= outcome.dc ? "pass" : "fail" };
  });
}

/** Force one target's verdict by hand — for the rulings, for the target the
 *  Curator rules immune, and for a table that simply overrides. */
export function declareTargetVerdict(
  outcome: PendingOutcome,
  targetId: string,
  verdict: OutcomeVerdict
): PendingOutcome {
  return patchTarget(outcome, targetId, (target) => ({ ...target, verdict, lapsedRound: undefined }));
}

/**
 * The target's token is no longer on the scene.
 *
 * Not a deletion. A row that disappeared from a 23-row list is indistinguishable
 * from a mis-count, and the Curator needs to know that the reason nothing landed
 * on Ghost is that Ghost left — not that the card forgot about it. The row stays,
 * says so, and drops out of every count and every batch plan.
 */
export function markTargetRemoved(outcome: PendingOutcome, targetId: string): PendingOutcome {
  return patchTarget(outcome, targetId, (target) => (target.removed ? target : { ...target, removed: true }));
}

/**
 * The target's token is on the scene after all.
 *
 * `removed` has to be reversible, because the two things that set it are not
 * both permanent. A token deleted by hand is gone; a token that is missing
 * because the Curator is LOOKING AT ANOTHER SCENE is not, and the reaper cannot
 * tell them apart — a card is scoped to the campaign and the room, while the
 * only token list anyone can reconcile against is the scene currently open. A
 * one-way mark meant that flipping to the world map for one glance killed every
 * open card in the session: every row said the body had left, `batchPlan` and
 * `autoApplicable` refused all of them, and coming back changed nothing. The
 * undo stack is the same case — a token restored by Ctrl+Z stayed dead on the
 * card that was waiting for it.
 */
export function markTargetPresent(outcome: PendingOutcome, targetId: string): PendingOutcome {
  return patchTarget(outcome, targetId, (target) => {
    if (!target.removed) return target;
    const back = { ...target };
    delete back.removed;
    return back;
  });
}

/**
 * THE PARTIAL RESOLUTION POLICY: the round advanced and some targets never rolled.
 *
 * Two answers were available and both are wrong. Expiring the unrolled targets
 * silently drops an ability that really happened — the zone went off, and the
 * three players who were slow to answer simply never took it. Applying them
 * silently is worse: it is the engine deciding, on no evidence, that three
 * absent players failed a save, and then writing HP off that decision.
 *
 * So neither. The round advancing is INFORMATION, not authority: it tells the
 * table that these targets did not answer in time, and it tells the engine
 * nothing whatsoever about what happened to them. A lapsed target therefore:
 *
 *   - keeps its row, marked with the round it was still waiting in, so the card
 *     can say "3 never rolled — carried from round 4" instead of going quiet;
 *   - is refused by `autoApplicable` even where the table opted in, because
 *     auto-apply commits verdicts the dice decided and a lapse has no verdict;
 *   - is refused by `batchPlan`, so the one-click act cannot sweep it up;
 *   - stays fully live — a late roll settles it and clears the lapse, and the
 *     Curator can declare it by hand at any point.
 *
 * The card outlives its TTL while a lapse is open, on purpose. The alternative
 * is a card that vanishes carrying the only record that three saves were never
 * answered, which is exactly the silence this policy exists to prevent.
 */
export function lapsePendingTargets(outcome: PendingOutcome, round: number): PendingOutcome {
  // A lapse means "the round moved on and nobody answered". An unrolled card
  // asked nobody anything, so every round would have marked it lapsed, and the
  // marks are load-bearing: `autoApplicable` and `batchPlan` both refuse a
  // lapsed target, so a threshold card would have gone dead one round after the
  // track crossed — and told the Curator it "never rolled" for a roll that was
  // never owed.
  if (outcome.unrolled) return outcome;
  let changed = false;
  const targets = outcome.targets.map((target) => {
    if (target.removed) return target;
    if (target.verdict !== "pending" || target.rollTotal != null) return target;
    // Re-lapsing on every later round would keep rewriting the round a target
    // has been outstanding SINCE, which is the number the Curator is reading.
    if (target.lapsedRound != null) return target;
    changed = true;
    return { ...target, lapsedRound: round };
  });
  return changed ? { ...outcome, targets } : outcome;
}

/** The Curator says which damage model is in force, overriding what the prose
 *  was read to mean. Recorded as by-hand so the card can stop claiming the page
 *  said it. */
export function setDamageRollMode(outcome: PendingOutcome, mode: DamageRollMode): PendingOutcome {
  if (outcome.damageRoll === mode && outcome.damageRollByHand) return outcome;
  return { ...outcome, damageRoll: mode, damageRollByHand: true };
}

/** The consequences this target's verdict actually triggers. A passed save still
 *  lists a half-damage rider, because that is what the prose promised. */
export function armedConsequences(outcome: PendingOutcome, target: OutcomeTarget): OutcomeConsequence[] {
  if (target.verdict === "pending") {
    // A card with no roll behind it has nothing to wait for, so an unbranched
    // consequence on it is armed the moment the card opens. Branch-armed rows
    // are not: `At 8: Fail: …` is asking about a verdict this card does not
    // have, and arming it would answer a question the page asked of the dice.
    return outcome.unrolled ? outcome.consequences.filter((consequence) => consequence.on === "always") : [];
  }
  return outcome.consequences.filter((consequence) => {
    if (consequence.on === "always") return true;
    if (consequence.on === target.verdict) return true;
    return target.verdict === "pass" && consequence.on === "fail" && consequence.half === true;
  });
}

/**
 * The armed consequences a table has said may commit without a click.
 *
 * Three gates, and all three have to hold:
 *
 *  - the table opted in. Confirm-each is the published behaviour and the
 *    default; nothing here happens to a table that never asked for it.
 *  - the consequence was DECLARED. The prose deriver reads sentences and is
 *    right most of the time, which is exactly the wrong standard for a write
 *    that lands on a token unattended. A guess still gets a button.
 *  - it is not a `ruling`. A ruling has no number by definition — it is the
 *    page asking a human a question, and answering it automatically would be
 *    the engine ruling on the Curator's behalf.
 *
 * Already-applied ids drop out here rather than at the call site, so a caller
 * that re-runs on every render cannot commit the same hit twice. So do ids an
 * undo took back, which a caller cannot see at all once its own fired-once ref
 * has gone with an unmount.
 */
export function autoApplicable(
  outcome: PendingOutcome,
  target: OutcomeTarget,
  rules: { autoApplyDeclared: boolean }
): OutcomeConsequence[] {
  if (!rules.autoApplyDeclared) return [];
  // A target the round left behind, or one whose token is gone, has no verdict
  // the dice produced — see `lapsePendingTargets`. Auto-apply exists to commit
  // what a roll decided, so it has nothing to say about either.
  if (target.removed || target.lapsedRound != null) return [];
  return armedConsequences(outcome, target).filter(
    (consequence) =>
      consequence.declared === true &&
      consequence.kind !== "ruling" &&
      !target.applied.includes(consequence.id) &&
      // Undo beats opt-in. A consequence the Curator took back is theirs to
      // re-apply by hand or leave off; committing it again unattended would
      // make Ctrl+Z last exactly until the panel remounted.
      !target.reversed?.includes(consequence.id)
  );
}

/** Half rounds DOWN — a rule the table can see rather than a float in a tooltip. */
export function damageAfterVerdict(
  target: OutcomeTarget,
  consequence: OutcomeConsequence,
  rolled: number
): number {
  if (target.verdict === "pass" && consequence.half) return Math.floor(rolled / 2);
  return rolled;
}

/**
 * The shape of a partly-resolved batch, in the counts the card puts on one line.
 *
 * Computed here rather than in the card because the same counts decide what the
 * one-click act will touch, and a summary that said "18 failed" while the button
 * committed a different 18 would be the card lying about what it is about to do.
 */
export interface OutcomeTally {
  /** Targets still in play — removed ones are not among them. */
  live: number;
  removed: number;
  failed: number;
  passed: number;
  /** Rolled, but the card has no DV to judge it against: the Curator's call. */
  undecided: number;
  /** No roll yet, and the round has not moved past them. */
  waiting: number;
  /** No roll, and the round moved on. `waiting` and `lapsed` are disjoint. */
  lapsed: number;
}

export function outcomeTally(outcome: PendingOutcome): OutcomeTally {
  const tally: OutcomeTally = { live: 0, removed: 0, failed: 0, passed: 0, undecided: 0, waiting: 0, lapsed: 0 };
  for (const target of outcome.targets) {
    if (target.removed) {
      tally.removed += 1;
      continue;
    }
    tally.live += 1;
    if (target.verdict === "fail") tally.failed += 1;
    else if (target.verdict === "pass") tally.passed += 1;
    else if (target.rollTotal != null) tally.undecided += 1;
    else if (target.lapsedRound != null) tally.lapsed += 1;
    // "Still to roll" is a count of outstanding answers. An unrolled card is
    // owed none, and a header reading "1 still to roll" over a threshold that
    // has already fired would send a Curator hunting for a die nobody threw.
    else if (!outcome.unrolled) tally.waiting += 1;
  }
  return tally;
}

/** One target and the consequences a batch act would commit against it. */
export interface BatchStep {
  target: OutcomeTarget;
  consequences: OutcomeConsequence[];
}

/**
 * Exactly what "apply to all 18 that failed" will do, enumerated before it does it.
 *
 * The single most dangerous button in the app, so its contents are a value the
 * card can render, a test can assert, and a Curator can read — not a loop hidden
 * inside a click handler.
 *
 * Four exclusions, each of which is a target the batch has no business speaking
 * for:
 *
 *  - a removed target: its token is gone and the write would be refused anyway.
 *  - a LAPSED target: no roll ever came, and the batch must not decide for it.
 *  - a `ruling`: the page asked a human a question. Answering 18 of them with
 *    one click is precisely the collapse this whole design is avoiding, so
 *    rulings stay on their own rows and the card says how many are waiting.
 *  - anything already in that target's `applied` list, so pressing the button
 *    twice cannot send a hit twice.
 */
export function batchPlan(outcome: PendingOutcome, verdict: "fail" | "pass"): BatchStep[] {
  const plan: BatchStep[] = [];
  for (const target of outcome.targets) {
    if (target.removed || target.lapsedRound != null) continue;
    if (target.verdict !== verdict) continue;
    const consequences = armedConsequences(outcome, target).filter(
      (consequence) => consequence.kind !== "ruling" && !target.applied.includes(consequence.id)
    );
    if (consequences.length) plan.push({ target, consequences });
  }
  return plan;
}

/** Rulings a batch act cannot answer, so the card can say how many rows still
 *  need a human after the one click lands. */
export function pendingRulings(outcome: PendingOutcome): BatchStep[] {
  const out: BatchStep[] = [];
  for (const target of outcome.targets) {
    if (target.removed) continue;
    const rulings = armedConsequences(outcome, target).filter((consequence) => consequence.kind === "ruling");
    if (rulings.length) out.push({ target, consequences: rulings });
  }
  return out;
}

/**
 * Where a token's HP lands after a consequence. `amount` is signed the way the
 * card sends it: positive damage, negative healing.
 *
 * Clamped at both ends. Healing past a maximum invents hit points the sheet
 * never granted, and negative HP is a state nothing else in the VTT — bars,
 * encounter rows, the down-at-zero rules — has a meaning for.
 */
export function hpAfterConsequence(current: number, max: number | undefined, amount: number): number {
  return Math.max(0, Math.min(max ?? Number.MAX_SAFE_INTEGER, current - amount));
}

export function markTargetApplied(
  outcome: PendingOutcome,
  targetId: string,
  consequenceId: string
): PendingOutcome {
  return patchTarget(outcome, targetId, (target) => {
    if (target.applied.includes(consequenceId)) return target;
    // Applying again lifts the auto-apply veto an undo left behind: the hit is
    // on the body once more, so there is nothing for the veto to protect.
    const reversed = target.reversed?.filter((id) => id !== consequenceId);
    const next = { ...target, applied: [...target.applied, consequenceId] };
    if (reversed?.length) next.reversed = reversed;
    else delete next.reversed;
    return next;
  });
}

/**
 * Take one consequence back off a target's applied list.
 *
 * The applied list is what stands between a committed hit and a second one, so
 * this is not a general "unapply": it exists for an undo that has ALREADY put
 * the body back through the authorised writer. Without it, undoing damage left
 * the row reading "Applied" forever — the HP restored and no way to rule on it
 * again except by hand-editing the token.
 */
export function unmarkTargetApplied(
  outcome: PendingOutcome,
  targetId: string,
  consequenceId: string
): PendingOutcome {
  return patchTarget(outcome, targetId, (target) =>
    target.applied.includes(consequenceId)
      ? {
          ...target,
          applied: target.applied.filter((id) => id !== consequenceId),
          reversed: [...(target.reversed ?? []), consequenceId],
        }
      : target
  );
}

/** A condition tag carries its own duration so the pip means something to a
 *  reader. Durations become real clocks when the round tick lands; until then
 *  the tag is honest about what it is — a note the table can see. */
export function conditionTag(consequence: OutcomeConsequence): string {
  if (!consequence.condition) return "";
  return consequence.rounds ? `${consequence.condition} (${consequence.rounds})` : consequence.condition;
}

// ── The store ──────────────────────────────────────────────────────────────
// Module-level and scope-keyed, mirroring `rollSession`: the card lives in a
// panel that unmounts when the Curator switches tools, and an outcome that
// vanished because a panel closed would be worse than no card at all.

const LEDGERS = new Map<string, PendingOutcome[]>();
const LISTENERS = new Map<string, Set<() => void>>();
const MAX_OPEN = 24;

function emit(scope: string): void {
  for (const listener of LISTENERS.get(scope) ?? []) listener();
}

export function subscribeOutcomes(scope: string, listener: () => void): () => void {
  const set = LISTENERS.get(scope) ?? new Set<() => void>();
  set.add(listener);
  LISTENERS.set(scope, set);
  return () => {
    set.delete(listener);
    // Drop the bucket with its last listener: a scope is campaign+room, so a
    // long session that reconnects a few times would otherwise keep one empty
    // Set per room it ever joined.
    if (set.size === 0 && LISTENERS.get(scope) === set) LISTENERS.delete(scope);
  };
}

// Shared empty result so listOutcomes returns a STABLE reference for a scope
// with no cards — required by useSyncExternalStore's getSnapshot, which compares
// by identity and re-renders forever against a reader that allocates per call.
// Frozen because every unknown scope is handed this same array.
const NO_OUTCOMES = Object.freeze([]) as unknown as PendingOutcome[];

/** A roll reached this card, even where the verdict is still the Curator's to
 *  declare. A DV-less outcome keeps `pending` until they rule on it, and expiry
 *  must not take that decision away from them by clearing the card first. */
function answered(outcome: PendingOutcome): boolean {
  // Nothing is outstanding on a card with no roll behind it, so the window that
  // exists to reap cards whose roll never came has nothing to measure. Expiring
  // one would delete the only record that a track crossed its threshold — an
  // event that really happened, with consequences a page declared.
  if (outcome.unrolled) return true;
  return outcome.targets.some(
    // A lapse holds the card open too. It is the only surviving record that some
    // targets never answered a save the table watched go off, and letting the
    // TTL delete that record is the silent expiry the policy above refuses.
    (target) => target.verdict !== "pending" || target.rollTotal != null || target.lapsedRound != null
  );
}

export function listOutcomes(scope: string, now?: number): PendingOutcome[] {
  const all = LEDGERS.get(scope) ?? NO_OUTCOMES;
  if (now == null) return all;
  const live = all.filter((outcome) => outcome.expiresAt > now || answered(outcome));
  return live.length === all.length ? all : live;
}

export function pushOutcome(scope: string, outcome: PendingOutcome): void {
  const all = LEDGERS.get(scope) ?? [];
  // Newest first: the card the Curator is waiting on is the one they just caused.
  LEDGERS.set(scope, [outcome, ...all.filter((prior) => prior.id !== outcome.id)].slice(0, MAX_OPEN));
  emit(scope);
}

/**
 * Mark a consequence committed against the ledger's CURRENT card.
 *
 * `markApplied` folds an id into whatever snapshot it is handed, which is fine
 * where the caller re-reads between writes — a Curator clicking Apply twice
 * re-renders in between and holds a fresh card each time. Auto-apply does not:
 * it commits every applicable consequence of one card in a single pass, holding
 * one snapshot for all of them, so a second `replaceOutcome(markApplied(that
 * snapshot, …))` would put back a card that had forgotten the first. Hail Rain
 * declares damage AND a condition; the damage mark vanished, its row came back
 * armed with the roll still on screen, and one click sent the hit twice.
 */
export function markOutcomeApplied(
  scope: string,
  outcomeId: string,
  targetId: string,
  consequenceId: string
): void {
  const all = LEDGERS.get(scope) ?? [];
  const found = all.find((outcome) => outcome.id === outcomeId);
  if (!found) return;
  const marked = markTargetApplied(found, targetId, consequenceId);
  if (marked === found) return;
  LEDGERS.set(scope, all.map((outcome) => (outcome.id === outcomeId ? marked : outcome)));
  emit(scope);
}

/** The stored card's counterpart to `markOutcomeApplied`, for an undo whose
 *  write already landed. Local like the mark itself: the ledger never rode the
 *  wire, so there is nothing to tell a peer here. */
export function unmarkOutcomeApplied(
  scope: string,
  outcomeId: string,
  targetId: string,
  consequenceId: string
): void {
  const all = LEDGERS.get(scope) ?? [];
  const found = all.find((outcome) => outcome.id === outcomeId);
  if (!found) return;
  const cleared = unmarkTargetApplied(found, targetId, consequenceId);
  if (cleared === found) return;
  LEDGERS.set(scope, all.map((outcome) => (outcome.id === outcomeId ? cleared : outcome)));
  emit(scope);
}

/**
 * Apply a change to the ledger's CURRENT card, never to the caller's copy of it.
 *
 * The same hazard `markOutcomeApplied` was written for, and a batch makes it a
 * live race rather than a corner. A card is handed to React as a snapshot; while
 * the Curator reads it, wire results for the other 22 targets are settling rows
 * on the stored card. Writing back `declareTargetVerdict(thatSnapshot, …)` would
 * put the whole snapshot back — every roll that landed in between erased, the
 * counts reset, and the only evidence being that the header quietly went from
 * "18 of 23 failed" to "4 of 23 failed".
 */
function mutateOutcome(
  scope: string,
  outcomeId: string,
  patch: (outcome: PendingOutcome) => PendingOutcome
): void {
  const all = LEDGERS.get(scope) ?? [];
  const found = all.find((outcome) => outcome.id === outcomeId);
  if (!found) return;
  const next = patch(found);
  if (next === found) return;
  LEDGERS.set(scope, all.map((outcome) => (outcome.id === outcomeId ? next : outcome)));
  emit(scope);
}

/** The Curator rules on one row — for a target they judge immune, and to
 *  override a roll — without disturbing the rows still arriving beside it. */
export function declareOutcomeVerdict(
  scope: string,
  outcomeId: string,
  targetId: string,
  verdict: OutcomeVerdict
): void {
  mutateOutcome(scope, outcomeId, (outcome) => declareTargetVerdict(outcome, targetId, verdict));
}

/** The Curator says whether the damage is one roll or one each. */
export function setOutcomeDamageRoll(scope: string, outcomeId: string, mode: DamageRollMode): void {
  mutateOutcome(scope, outcomeId, (outcome) => setDamageRollMode(outcome, mode));
}

export function replaceOutcome(scope: string, outcome: PendingOutcome): void {
  const all = LEDGERS.get(scope) ?? [];
  if (!all.some((prior) => prior.id === outcome.id)) return;
  LEDGERS.set(scope, all.map((prior) => (prior.id === outcome.id ? outcome : prior)));
  emit(scope);
}

/**
 * Settle by request id — the wire correlation the host already maintains.
 *
 * Searches TARGETS, not cards: an area ability issues one request per target, so
 * the id that comes back off the wire identifies a row inside a card rather than
 * the card itself. Which is also why arrival order does not matter here — each
 * result finds its own row, and the other 22 are untouched by it.
 */
export function settleByRequest(
  scope: string,
  requestId: string,
  rollTotal: number
): { outcome: PendingOutcome; target: OutcomeTarget } | null {
  const all = LEDGERS.get(scope) ?? [];
  for (const outcome of all) {
    const target = outcome.targets.find((row) => row.requestId === requestId);
    if (!target) continue;
    const settled = settleTarget(outcome, target.id, rollTotal);
    // A duplicate result changes nothing — `settleTarget` keeps the first — so
    // it must not emit either, or every retried wire message would re-render
    // every card in the scope for no change at all.
    if (settled === outcome) return { outcome, target };
    LEDGERS.set(scope, all.map((prior) => (prior.id === settled.id ? settled : prior)));
    emit(scope);
    return { outcome: settled, target: targetOf(settled, target.id) as OutcomeTarget };
  }
  return null;
}

/**
 * The round advanced: every target still outstanding is marked, not resolved.
 *
 * Idempotent, because the round tick is Curator-only and fires on a CHANGE, but
 * the ledger cannot see that guarantee from here and a card that re-stamped its
 * lapse round every render would keep resetting the number a Curator is reading.
 */
export function lapseOutcomes(scope: string, round: number): void {
  const all = LEDGERS.get(scope) ?? [];
  const next = all.map((outcome) => lapsePendingTargets(outcome, round));
  if (next.every((outcome, i) => outcome === all[i])) return;
  LEDGERS.set(scope, next);
  emit(scope);
}

/**
 * Reconcile open cards against the tokens actually on the scene.
 *
 * A target can die, be deleted, or be dragged to another scene between the save
 * request and the Curator's click. Without this the card would keep offering
 * "Apply −27 HP" for a body that is not there; VttScreen would refuse the write
 * and toast, which is correct but tells the Curator only after they committed to
 * the act. Marking the row instead moves that information to before the click.
 *
 * Targets with no token behind them are never reaped — a card opened against a
 * name rather than a body has nothing on the scene to compare against.
 *
 * SYMMETRIC, and that is the whole of the correctness argument: this reconciles
 * against whatever scene is open, while a card belongs to the campaign and the
 * room. A body absent from the scene the Curator happens to be looking at has
 * not necessarily left the fight, so the mark it earns has to come off again the
 * moment the body is back in front of us. See `markTargetPresent`.
 */
export function syncOutcomeTargets(scope: string, liveTokenIds: ReadonlySet<string>): void {
  const all = LEDGERS.get(scope) ?? [];
  let changed = false;
  const next = all.map((outcome) => {
    let patched = outcome;
    for (const target of outcome.targets) {
      if (!target.tokenId) continue;
      patched = liveTokenIds.has(target.tokenId)
        ? markTargetPresent(patched, target.id)
        : markTargetRemoved(patched, target.id);
    }
    if (patched !== outcome) changed = true;
    return patched;
  });
  if (!changed) return;
  LEDGERS.set(scope, next);
  emit(scope);
}

export function dismissOutcome(scope: string, id: string): void {
  const all = LEDGERS.get(scope) ?? [];
  const next = all.filter((outcome) => outcome.id !== id);
  if (next.length === all.length) return;
  LEDGERS.set(scope, next);
  emit(scope);
}

/**
 * Forget a scope entirely, the way `clearSessionRolls` forgets its rolls.
 *
 * A settled card never expires on its own, so without this a Curator who left a
 * campaign and came back would be handed the previous session's cards — still
 * offering "Apply −27 HP" against a token whose HP has moved on since. The
 * numbers would be stale; the write would be perfectly real.
 */
export function clearOutcomes(scope: string): void {
  if (!LEDGERS.delete(scope)) return;
  emit(scope);
}

/** Drop cards whose roll never came. An expired card is silence, not a wrong
 *  answer — the Curator resolves it at the table as they always have. */
export function pruneOutcomes(scope: string, now: number): void {
  const all = LEDGERS.get(scope) ?? [];
  const next = all.filter((outcome) => answered(outcome) || outcome.expiresAt > now);
  if (next.length === all.length) return;
  LEDGERS.set(scope, next);
  emit(scope);
}

export function __resetOutcomeLedger(): void {
  LEDGERS.clear();
  LISTENERS.clear();
}
