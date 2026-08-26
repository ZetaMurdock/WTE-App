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

/** How a resolution landed. `pending` means the roll has not arrived yet. */
export type OutcomeVerdict = "pass" | "fail" | "pending";

/** Which verdict arms a consequence. Most ability prose describes the failure
 *  branch only, so `fail` is the default the deriver assigns. */
export type ConsequenceTrigger = "fail" | "pass" | "always";

export type ConsequenceKind = "damage" | "heal" | "condition" | "ruling";

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
}

export interface PendingOutcome {
  id: string;
  /** Ties this outcome to the roll request that will settle it. */
  requestId?: string;
  /** Permanent ability id when the source carries one; the positional id otherwise. */
  sourceAbilityId: string;
  sourceAbilityName: string;
  casterCharacterId?: string;
  targetTokenId?: string;
  targetName: string;
  /** The DV the roll must meet. Absent for rulings with no numeric gate. */
  dc?: number;
  rollLabel: string;
  rollTotal?: number;
  verdict: OutcomeVerdict;
  consequences: OutcomeConsequence[];
  /** Consequence ids already committed, so re-applying takes a deliberate act. */
  applied: string[];
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

export interface OpenOutcomeInput {
  id: string;
  requestId?: string;
  sourceAbilityId: string;
  sourceAbilityName: string;
  effect?: string | null;
  casterCharacterId?: string;
  targetTokenId?: string;
  targetName: string;
  dc?: number;
  rollLabel: string;
  now: number;
  /** How long an unsettled outcome stays on the card. Matches the roll-request
   *  window, so a card cannot outlive the request that would settle it. */
  ttlMs?: number;
}

export function openOutcome(input: OpenOutcomeInput): PendingOutcome {
  return {
    id: input.id,
    requestId: input.requestId,
    sourceAbilityId: input.sourceAbilityId,
    sourceAbilityName: input.sourceAbilityName,
    casterCharacterId: input.casterCharacterId,
    targetTokenId: input.targetTokenId,
    targetName: input.targetName,
    dc: input.dc,
    rollLabel: input.rollLabel,
    verdict: "pending",
    consequences: consequencesFor(input.effect),
    applied: [],
    createdAt: input.now,
    expiresAt: input.now + (input.ttlMs ?? 5 * 60_000),
  };
}

/**
 * Settle an outcome against the roll that answered it.
 *
 * Meeting the DV is a success — the same `>=` the save chips print, so the card
 * and the chip can never disagree about what 18-vs-18 means. With no DV there is
 * nothing to compare, and the verdict stays the Curator's to declare.
 */
export function settleOutcome(outcome: PendingOutcome, rollTotal: number): PendingOutcome {
  if (outcome.dc == null) return { ...outcome, rollTotal };
  return { ...outcome, rollTotal, verdict: rollTotal >= outcome.dc ? "pass" : "fail" };
}

/** Force a verdict by hand — for the rulings, and for a table that overrides. */
export function declareVerdict(outcome: PendingOutcome, verdict: OutcomeVerdict): PendingOutcome {
  return { ...outcome, verdict };
}

/** The consequences this verdict actually triggers. A passed save still lists a
 *  half-damage rider, because that is what the prose promised. */
export function armedConsequences(outcome: PendingOutcome): OutcomeConsequence[] {
  if (outcome.verdict === "pending") return [];
  return outcome.consequences.filter((consequence) => {
    if (consequence.on === "always") return true;
    if (consequence.on === outcome.verdict) return true;
    return outcome.verdict === "pass" && consequence.on === "fail" && consequence.half === true;
  });
}

/** Half rounds DOWN — a rule the table can see rather than a float in a tooltip. */
export function damageAfterVerdict(
  outcome: PendingOutcome,
  consequence: OutcomeConsequence,
  rolled: number
): number {
  if (outcome.verdict === "pass" && consequence.half) return Math.floor(rolled / 2);
  return rolled;
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

export function markApplied(outcome: PendingOutcome, consequenceId: string): PendingOutcome {
  if (outcome.applied.includes(consequenceId)) return outcome;
  return { ...outcome, applied: [...outcome.applied, consequenceId] };
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
  return outcome.verdict !== "pending" || outcome.rollTotal != null;
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

export function replaceOutcome(scope: string, outcome: PendingOutcome): void {
  const all = LEDGERS.get(scope) ?? [];
  if (!all.some((prior) => prior.id === outcome.id)) return;
  LEDGERS.set(scope, all.map((prior) => (prior.id === outcome.id ? outcome : prior)));
  emit(scope);
}

/** Settle by request id — the wire correlation the host already maintains. */
export function settleByRequest(scope: string, requestId: string, rollTotal: number): PendingOutcome | null {
  const all = LEDGERS.get(scope) ?? [];
  const found = all.find((outcome) => outcome.requestId === requestId);
  if (!found) return null;
  const settled = settleOutcome(found, rollTotal);
  LEDGERS.set(scope, all.map((outcome) => (outcome.id === settled.id ? settled : outcome)));
  emit(scope);
  return settled;
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
