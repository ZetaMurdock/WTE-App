// `Tamper:` — one ability acting on another ability's effect.
//
// Pure, like every other planner in this arc: it reads the scene, works out what
// the verb WOULD do, and hands back a proposal in the Curator's words. Nothing
// here writes. `undo/tamperUndo.ts` commits, through the authorised paths, and
// only after a human has read the lines below.
//
// ── THE CASCADE ────────────────────────────────────────────────────────────
//
// Ending a placed effect is the dangerous half of this verb, because a field on
// this map is not one record. It is a template, a status pip on everybody
// standing in it, a countdown per pip, and — sometimes — a currency somebody has
// been accruing. Remove only the template and the rest is STRANDED, and stranded
// in the worst possible way: `SimulationSystem` revokes a status only while some
// live effect still claims it, so the moment the last zone granting "Burning"
// disappears, every pip reading "Burning" stops being zone-owned and becomes a
// manual tag nothing will ever take off again. A negate that looked like it
// worked would leave the whole corridor Burning for the rest of the campaign.
//
// So `end` / `negate` is defined as exactly four steps, in this order:
//
//   1. THE TEMPLATE goes.
//   2. ITS STATUS comes off every body carrying it that no SURVIVING effect
//      still grants it to. That is `SimulationSystem.tick`'s own rule, evaluated
//      one moment before the removal makes it unevaluable — not a new rule. Two
//      zones granting Burning and one ending leaves the survivor's occupancy to
//      decide, exactly as it would have.
//   3. THE CLOCKS watching those pips go with them. A countdown whose tag is no
//      longer on the body has nothing left to count; `ConditionClockSystem.prune`
//      would collect it on the next scene adopt, and leaving it until then means
//      the next application of that condition stacks against a ghost.
//   4. THE COUNTER TRACKS STAY, and the proposal SAYS SO. This is the one gap
//      the model cannot close: `VttCounterTrack` records a token, a name and a
//      value, and nothing anywhere records which ability moved it. A cascade
//      that guessed — "this zone's caster also declared a Blight step, so the
//      Blight must be his" — would delete a currency the table earned somewhere
//      else. Reporting the gap is the correct answer; filling it silently is not.
//      Giving a track provenance is a Curator's decision about what a track IS,
//      and belongs on a page, not in this planner.
//
// Summoned bodies are also untouched, and also reported. A summon carries
// `sourceAbilityId` too, so the same ability's minions are findable — but the
// corpus says minions "persist until dismissed, slain, or separated", so they
// outlive the field that arrived with them. Dismissal already has its own door.
//
// ── WHAT EACH MODE IS ──────────────────────────────────────────────────────
//
//   end / negate  — the cascade above. Also the DISPEL path: a heal that clears
//                   Burning is `end` on that condition clock; a "save ends" the
//                   target initiates is the same act with the target's dice in
//                   front of it.
//   reflect       — the effect turns back on its SOURCE, which is
//                   `casterCharacterId`. A clock and a track record no source at
//                   all, so reflect against either is REFUSED by name rather
//                   than guessing a victim out of the room.
//   delay         — suspension. For an effect that is a stored wake-round (see
//                   engine/systems/effectSuspension.ts); for a condition it is
//                   the countdown pausing, expressed as pushing `bornRound`
//                   forward, which is the only way a clock can hold still.
//   redirect/copy — A RULING, deliberately. Neither can be done truthfully here:
//                   see `RULINGS` below.
import type {
  VttConditionClock,
  VttCounterTrack,
  VttEffect,
  VttSceneData,
  VttToken,
} from "../types/scene";
import type { EffectStep, TamperMode } from "../../game/abilityEffects";
import { parseAbilityEffects } from "../../game/abilityEffects";
import { tokenInEffect } from "../engine/systems/effectOccupants";
import { effectSuspended, suspensionRemaining } from "../engine/systems/effectSuspension";
import { counterKey, isCounterTagFor } from "../../game/counterTracks";
import { effectTitle, type TamperTarget } from "./tamperTargets";
import { openOutcome, type PendingOutcome } from "./outcomeLedger";

/** One `Tamper:` bullet, as the page declared it. */
export interface DeclaredTamper {
  /** Stable within its block, so a prompt can key a row without inventing one. */
  id: string;
  mode: TamperMode;
  /** `delay` — how long, when the page said. */
  rounds?: number;
  /** Which verdict arms it, matching `OutcomeConsequence.on`. */
  on: "always" | "fail" | "pass";
}

/**
 * The `Tamper:` bullets of a declared block.
 *
 * `min` and `tie` are dropped for the reason `consequencesFromSteps` and
 * `declaredSummons` drop them: no phase of the engine executes those branches,
 * and treating them as failures would negate an effect the page never promised
 * to touch. `at-threshold` is dropped for the reason it is everywhere else — a
 * step armed by a track reaching 8 does not fire when the ability that moves the
 * track resolves.
 */
function declaredTampers(steps: readonly EffectStep[]): DeclaredTamper[] {
  const out: DeclaredTamper[] = [];
  steps.forEach((step, i) => {
    if (step.verb !== "tamper" || !step.tamper) return;
    if (step.branch === "min" || step.branch === "tie") return;
    if (step.cadence === "at-threshold") return;
    out.push({
      id: `tm-${i}`,
      mode: step.tamper,
      ...(step.duration?.kind === "rounds" ? { rounds: step.duration.count } : {}),
      on: step.branch === "always" ? "always" : step.branch === "success" ? "pass" : "fail",
    });
  });
  return out;
}

export function pageTampers(actions: string | null | undefined): DeclaredTamper[] {
  if (!actions) return [];
  return declaredTampers(parseAbilityEffects(actions).steps);
}

/**
 * Every write one tamper makes, enumerated before any of it happens.
 *
 * A value the prompt can render, a test can assert and an undo can invert —
 * never a loop inside a click handler. The clock and track halves are SCOPED TO
 * THE TOKENS THEY TOUCH rather than being the scene's whole list, which is the
 * same correctness argument `vitalsUndo.restoreClocksFor` makes: a condition
 * that landed on somebody else while the entry sat on the undo stack has to
 * survive the press that takes this one back.
 */
export interface TamperWrite {
  /** Per-token status lists, for the authorised vitals write. */
  statuses: { tokenId: string; tokenName: string; statuses: string[] }[];
  /** Effects that must be gone afterwards. */
  removeEffects: string[];
  /** Effects that must be present afterwards exactly as given — a replacement
   *  for an id still on the scene, or a re-add of one that was removed. */
  putEffects: VttEffect[];
  /** Bodies whose countdowns this write rewrites, and what they become. */
  clockTokens: string[];
  clocks: VttConditionClock[];
  /** Bodies whose currencies this write rewrites, and what they become. */
  trackTokens: string[];
  tracks: VttCounterTrack[];
}

export type TamperVerdict = "commit" | "ruling" | "refused";

export interface TamperProposal {
  mode: TamperMode;
  target: TamperTarget;
  verdict: TamperVerdict;
  /** What will happen, said in full before it does. */
  lines: string[];
  /** What this act does NOT reach, and why. Never silent — a cascade that
   *  quietly leaves state behind is the failure this module exists to prevent. */
  caveats: string[];
  /** The writes. Null for a ruling and for a refusal. */
  write: TamperWrite | null;
  /** Set when the mode cannot resolve against this target: the reason, in the
   *  Curator's words. */
  refusal?: string;
  /** Set when this is the Curator's to adjudicate: what is being asked. */
  ruling?: string;
  /** The undo-button label — "Absolute Zero negated". */
  label: string;
}

export interface TamperInput {
  data: VttSceneData;
  target: TamperTarget;
  mode: TamperMode;
  /** `delay` — rounds, as the page declared them. */
  rounds?: number;
  /** `reflect` — the source's token, which only the caller can resolve: the
   *  effect records a CHARACTER id and the scene holds tokens. Absent means the
   *  caller looked and did not find one. */
  sourceTokenId?: string;
  /** `reflect` — the source's name, for the line and the refusal. */
  sourceName?: string;
}

const emptyWrite = (): TamperWrite => ({
  statuses: [],
  removeEffects: [],
  putEffects: [],
  clockTokens: [],
  clocks: [],
  trackTokens: [],
  tracks: [],
});

function rounds(n: number): string {
  return `${n} round${n === 1 ? "" : "s"}`;
}

function nameOf(token: VttToken | undefined): string {
  return token?.name?.trim() || "an unnamed body";
}

function refused(input: TamperInput, reason: string): TamperProposal {
  return {
    mode: input.mode,
    target: input.target,
    verdict: "refused",
    lines: [],
    caveats: [],
    write: null,
    refusal: reason,
    label: `${input.target.label} — ${input.mode}`,
  };
}

/**
 * WHY `redirect` AND `copy` ARE RULINGS.
 *
 * Both are real corpus verbs and neither can be executed truthfully with what
 * this engine holds, so they get a card that states the question instead of a
 * mechanic that fakes an answer.
 *
 * REDIRECT means the ability resolves against somebody else — Null's Reflect
 * keeps "the same damage, Check or Save, Roll Path" and simply poses it at a new
 * body. A placed effect is not aimed at anybody: it is a shape on a map, and
 * moving the shape is not redirecting the ability, it is redecorating. Re-posing
 * a resolved save at a new target means running the ability again, which is
 * `Invoke`'s territory and not this verb's, and nothing in the engine can re-ask
 * a save the dice have already answered.
 *
 * COPY means the tamperer now HAS it — Genetic Stealer, Quick Hack. What a copy
 * costs, how long it is held and whether it can be used again are rules that
 * belong on the copier's own page, and no page can state them yet. Duplicating
 * the TEMPLATE would be easy and would be a lie: it would put a second field on
 * the map with the original caster still stamped on it, which is not a copy of
 * anything, and it says nothing at all about copying a condition or a track.
 *
 * Both are reported to the Curator with the ability, the target and the source
 * named, which is every fact the engine actually has.
 */
const RULINGS: Readonly<Record<string, (target: TamperTarget) => string>> = {
  redirect: (target) =>
    `Redirect ${target.label} — the engine cannot re-pose a resolved roll at a new target, ` +
    `so who it lands on now, and on what terms, is yours to rule.`,
  copy: (target) =>
    `Copy ${target.label} — nothing on any page yet says what holding a copied effect costs ` +
    `or how long it is held, so what the copier gains is yours to rule.`,
};

// ── The cascade ────────────────────────────────────────────────────────────

/** Is `status` still granted to this body by an effect that survives? */
function stillGranted(
  data: VttSceneData,
  token: VttToken,
  status: string,
  gone: ReadonlySet<string>,
  round: number
): boolean {
  const grid = data.grid;
  return data.effects.some(
    (effect) =>
      !gone.has(effect.id) &&
      effect.data.status === status &&
      !effectSuspended(effect, round) &&
      tokenInEffect(effect, grid, token)
  );
}

/**
 * The pips an ending effect's status leaves behind, per body.
 *
 * Deliberately walks EVERY token carrying the status rather than only the ones
 * standing in the ending effect. That is what `SimulationSystem.tick` does — it
 * reconciles the whole scene against the whole zone list every round — so
 * matching it here means a negate and a round tick can never disagree about who
 * is Burning. Restricting to occupants would have left the pip on a body the sim
 * was about to strip anyway, under a card that claimed the field was gone.
 */
function stripStatus(
  data: VttSceneData,
  status: string,
  gone: ReadonlySet<string>,
  round: number
): { tokenId: string; tokenName: string; statuses: string[] }[] {
  const out: { tokenId: string; tokenName: string; statuses: string[] }[] = [];
  for (const token of data.tokens) {
    const held = token.statuses ?? [];
    if (!held.includes(status)) continue;
    if (stillGranted(data, token, status, gone, round)) continue;
    out.push({ tokenId: token.id, tokenName: nameOf(token), statuses: held.filter((entry) => entry !== status) });
  }
  return out;
}

/**
 * The countdowns left with nothing to count, once these bodies' pips have moved.
 *
 * `ConditionClockSystem.prune`'s rule — a clock survives while an occurrence of
 * its tag is still on its token — scoped to the bodies this write touches, so a
 * clock on anybody else is passed through untouched.
 */
function reconcileClocks(
  data: VttSceneData,
  next: readonly { tokenId: string; statuses: string[] }[]
): { tokens: string[]; clocks: VttConditionClock[] } {
  const byToken = new Map(next.map((entry) => [entry.tokenId, entry.statuses]));
  const tokens = [...byToken.keys()];
  const left = new Map<string, number>();
  const clocks = (data.conditionClocks ?? []).filter((clock) => {
    const statuses = byToken.get(clock.tokenId);
    if (!statuses) return true;
    const key = `${clock.tokenId} ${clock.status}`;
    const remaining = left.get(key) ?? statuses.filter((status) => status === clock.status).length;
    if (remaining <= 0) return false;
    left.set(key, remaining - 1);
    return true;
  });
  return { tokens, clocks: clocks.filter((clock) => byToken.has(clock.tokenId)) };
}

/** Every track carried by a body this act touches — the currencies the cascade
 *  provably cannot reach, named so the Curator can rule on them by hand. */
function strandedTracks(data: VttSceneData, tokenIds: readonly string[]): string[] {
  const ids = new Set(tokenIds);
  const out: string[] = [];
  for (const track of data.counterTracks ?? []) {
    if (!ids.has(track.tokenId)) continue;
    const token = data.tokens.find((candidate) => candidate.id === track.tokenId);
    if (!token) continue;
    if (!(token.statuses ?? []).some((status) => isCounterTagFor(status, track.name))) continue;
    const reading = track.cap != null ? `${track.value}/${track.cap}` : String(track.value);
    out.push(`${nameOf(token)}'s ${track.name} ${reading}`);
  }
  return out;
}

/** Bodies this ability summoned that are still standing. */
function liveSummons(data: VttSceneData, sourceAbilityId: string | undefined, sourceAbilityName: string | undefined): number {
  if (!sourceAbilityId && !sourceAbilityName) return 0;
  return data.tokens.filter((token) => {
    const origin = token.meta?.summon;
    if (!origin) return false;
    return sourceAbilityId
      ? origin.sourceAbilityId === sourceAbilityId
      : origin.sourceAbilityName === sourceAbilityName;
  }).length;
}

function endEffect(input: TamperInput, effect: VttEffect): TamperProposal {
  const { data, target } = input;
  const round = data.timeline?.round ?? 0;
  const title = effectTitle(effect);
  const write = emptyWrite();
  write.removeEffects.push(effect.id);

  const lines = [`${title} leaves the map.`];
  const caveats: string[] = [];

  if (effect.data.status) {
    write.statuses = stripStatus(data, effect.data.status, new Set([effect.id]), round);
    if (write.statuses.length) {
      lines.push(
        `${effect.data.status} comes off ${write.statuses.map((entry) => entry.tokenName).join(", ")}.`
      );
    } else {
      lines.push(`Nobody is carrying ${effect.data.status} from it.`);
    }
    const held = data.tokens.filter(
      (token) => (token.statuses ?? []).includes(effect.data.status as string)
    ).length;
    const kept = held - write.statuses.length;
    if (kept > 0) {
      caveats.push(
        `${kept} other ${kept === 1 ? "body keeps" : "bodies keep"} ${effect.data.status} — another field still grants it to ${kept === 1 ? "them" : "them"}.`
      );
    }
  }

  const reconciled = reconcileClocks(data, write.statuses);
  write.clockTokens = reconciled.tokens;
  write.clocks = reconciled.clocks;
  const dropped =
    (data.conditionClocks ?? []).filter((clock) => write.clockTokens.includes(clock.tokenId)).length -
    write.clocks.length;
  if (dropped > 0) lines.push(`${dropped} countdown${dropped === 1 ? "" : "s"} watching ${effect.data.status ?? "it"} go with it.`);

  const stranded = strandedTracks(data, write.statuses.map((entry) => entry.tokenId));
  if (stranded.length) {
    caveats.push(
      `${stranded.join(", ")} ${stranded.length === 1 ? "stays" : "stay"} where ${stranded.length === 1 ? "it is" : "they are"} — ` +
        `nothing records which ability moved a counter track, so ending a field cannot roll one back. Clear it by hand if the ruling is that it should go.`
    );
  }

  const minions = liveSummons(data, effect.data.sourceAbilityId, effect.data.sourceAbilityName);
  if (minions > 0) {
    caveats.push(
      `${minions} ${minions === 1 ? "body" : "bodies"} summoned by ${title} ${minions === 1 ? "stays" : "stay"} — a summon outlives the field it arrived with. Dismiss the batch from its own token if it should go too.`
    );
  }

  if (effect.data.ticks?.length) {
    lines.push(`Its ${effect.data.ticks.length} per-round line${effect.data.ticks.length === 1 ? "" : "s"} stop${effect.data.ticks.length === 1 ? "s" : ""} proposing.`);
  }

  return {
    mode: input.mode,
    target,
    verdict: "commit",
    lines,
    caveats,
    write,
    label: `${title} ${input.mode === "negate" ? "negated" : "ended"}`,
  };
}

function endClock(input: TamperInput): TamperProposal {
  const { data, target } = input;
  const round = data.timeline?.round ?? 0;
  const token = data.tokens.find((candidate) => candidate.id === target.tokenId);
  const status = target.status;
  if (!token || !status) return refused(input, "That countdown is no longer on this scene.");

  const held = token.statuses ?? [];
  const at = held.indexOf(status);
  if (at < 0) return refused(input, `${nameOf(token)} is not carrying ${status} any more.`);

  const write = emptyWrite();
  // ONE occurrence, not every one: a `stack` condition keeps its instances apart
  // and a cleanse that took all of them off would be a different, larger act
  // than the one the Curator picked a row for.
  const statuses = [...held.slice(0, at), ...held.slice(at + 1)];
  write.statuses = [{ tokenId: token.id, tokenName: nameOf(token), statuses }];
  const reconciled = reconcileClocks(data, write.statuses);
  write.clockTokens = reconciled.tokens;
  write.clocks = reconciled.clocks;

  const caveats: string[] = [];
  // The sim owns a status you are standing inside of, so a cleanse that does not
  // also end the field is a cleanse the next round undoes. Said before the
  // click, not discovered after it.
  const source = data.effects.find(
    (effect) =>
      effect.data.status === status && !effectSuspended(effect, round) && tokenInEffect(effect, data.grid, token)
  );
  if (source) {
    caveats.push(
      `${nameOf(token)} is still standing in ${effectTitle(source)}, which grants ${status} — the tag comes back on the next round unless that field ends too.`
    );
  }

  return {
    mode: input.mode,
    target,
    verdict: "commit",
    lines: [`${status} comes off ${nameOf(token)}, and its countdown with it.`],
    caveats,
    write,
    label: `${status} cleared from ${nameOf(token)}`,
  };
}

function endTrack(input: TamperInput): TamperProposal {
  const { data, target } = input;
  const token = data.tokens.find((candidate) => candidate.id === target.tokenId);
  const name = target.counterName;
  if (!token || !name) return refused(input, "That track is no longer on this scene.");

  const write = emptyWrite();
  write.statuses = [
    {
      tokenId: token.id,
      tokenName: nameOf(token),
      statuses: (token.statuses ?? []).filter((status) => !isCounterTagFor(status, name)),
    },
  ];
  write.trackTokens = [token.id];
  write.tracks = (data.counterTracks ?? []).filter(
    (track) => track.tokenId === token.id && counterKey(track.name) !== counterKey(name)
  );
  const reconciled = reconcileClocks(data, write.statuses);
  write.clockTokens = reconciled.tokens;
  write.clocks = reconciled.clocks;

  return {
    mode: input.mode,
    target,
    verdict: "commit",
    lines: [`${name} is wiped off ${nameOf(token)}, pip and record together.`],
    caveats: [],
    write,
    label: `${name} cleared from ${nameOf(token)}`,
  };
}

// ── Reflect ────────────────────────────────────────────────────────────────

/**
 * Where a template's anchor has to sit for its BODY to be centred on a token.
 *
 * `addEffectAt` already owns this convention and states it in one line: zones
 * anchor top-left at a cell corner, everything else anchors at its centre. Read
 * from there rather than restated as a rule of its own, because a reflect that
 * centred a rect zone the way it centres a circle would drop the field down and
 * right of the body it was supposedly turned back on.
 */
function anchorFor(effect: VttEffect, token: VttToken, cell: number): { x: number; y: number } {
  if (effect.kind !== "zone") return { x: token.x, y: token.y };
  return {
    x: token.x - ((effect.data.w ?? 4) * cell) / 2,
    y: token.y - ((effect.data.h ?? 4) * cell) / 2,
  };
}

function reflectEffect(input: TamperInput, effect: VttEffect): TamperProposal {
  const { data, target } = input;
  const title = effectTitle(effect);
  if (!effect.data.casterCharacterId) {
    return refused(
      input,
      `${title} was placed with no caster recorded, so there is nobody to turn it back on. Reflect needs a source; this effect has none.`
    );
  }
  const token = data.tokens.find((candidate) => candidate.id === input.sourceTokenId);
  if (!token) {
    const who = input.sourceName?.trim();
    return refused(
      input,
      who
        ? `${who} raised ${title}, but ${who} has no token on this scene — there is nowhere to turn it back to.`
        : `${title}'s caster is not on this scene, and the engine will not pick a victim for it.`
    );
  }

  const cell = data.grid?.size ?? 0;
  const anchor = anchorFor(effect, token, cell);
  const rides = !!effect.data.auraTokenId;
  const moved: VttEffect = {
    ...effect,
    x: anchor.x,
    y: anchor.y,
    data: { ...effect.data },
  };
  if (rides) {
    // An aura stays an aura, now riding its source. A fixed template stays fixed
    // — reflecting does not change WHAT an effect is, only who it is standing on.
    moved.data.auraTokenId = token.id;
    moved.data.auraDx = anchor.x - token.x;
    moved.data.auraDy = anchor.y - token.y;
  }

  const write = emptyWrite();
  write.putEffects.push(moved);

  return {
    mode: input.mode,
    target,
    verdict: "commit",
    lines: [
      rides
        ? `${title} now rides ${nameOf(token)}, who raised it.`
        : `${title} now stands on ${nameOf(token)}'s square, where it will stay.`,
      `Its shape, its remaining life, its per-round lines and the status it grants are unchanged.`,
    ],
    caveats: [
      `${title} still records ${nameOf(token)} as its caster — that is provenance, not ownership, so reflecting it a second time moves nothing.`,
      `Whoever is standing in it now takes the pip and the per-round lines on the next round, not this instant: the zone pass runs on the round tick.`,
    ],
    write,
    label: `${title} reflected onto ${nameOf(token)}`,
  };
}

// ── Delay ──────────────────────────────────────────────────────────────────

function delayEffect(input: TamperInput, effect: VttEffect): TamperProposal {
  const { data, target } = input;
  const round = data.timeline?.round ?? 0;
  const span = Math.max(1, Math.trunc(input.rounds ?? 1));
  const title = effectTitle(effect);

  const write = emptyWrite();
  const asleep: VttEffect = {
    ...effect,
    data: {
      ...effect.data,
      // Extends an existing sleep rather than restarting it: `suspendedAt` is
      // the moment the FIRST delay landed, and resetting it would hand back only
      // the rounds since the second one — quietly shortening the effect by the
      // length of the first delay.
      suspendedAt: effect.data.suspendedAt ?? round,
      suspendedUntil: Math.max(effect.data.suspendedUntil ?? round, round) + span,
    },
  };
  write.putEffects.push(asleep);

  const lines = [
    `${title} stops for ${rounds(span)} and returns on round ${asleep.data.suspendedUntil}.`,
    `While it sleeps it grants no status, proposes no per-round lines, and does not age — the rounds it misses are handed back to its lifetime when it wakes.`,
  ];
  const caveats: string[] = [];

  // The pip has to come off NOW, not on the next round tick: a Curator who
  // delayed a fire and watched everyone standing in it stay Burning would
  // reasonably conclude the verb did nothing.
  if (effect.data.status) {
    // The effect itself is excluded rather than tested: it is about to be asleep,
    // and a sleeping field grants nothing. Every OTHER field is evaluated at the
    // round we are on, so a body standing in two fires keeps the pip.
    write.statuses = stripStatus(data, effect.data.status, new Set([effect.id]), round);
    if (write.statuses.length) {
      lines.push(`${effect.data.status} comes off ${write.statuses.map((entry) => entry.tokenName).join(", ")} until it returns.`);
    }
    const reconciled = reconcileClocks(data, write.statuses);
    write.clockTokens = reconciled.tokens;
    write.clocks = reconciled.clocks;
    caveats.push(
      `The countdowns those pips carried are cleared, not paused — a clock exists only while its tag is on the body, and there is nowhere to park one. When ${title} wakes, the zone pass grants the tag afresh.`
    );
  }
  if (effectSuspended(effect, round)) {
    caveats.push(`${title} was already suspended for another ${rounds(suspensionRemaining(effect, round))}; this adds to that.`);
  }

  return {
    mode: input.mode,
    target,
    verdict: "commit",
    lines,
    caveats,
    write,
    label: `${title} delayed ${rounds(span)}`,
  };
}

function delayClock(input: TamperInput): TamperProposal {
  const { data, target } = input;
  const span = Math.max(1, Math.trunc(input.rounds ?? 1));
  const token = data.tokens.find((candidate) => candidate.id === target.tokenId);
  const status = target.status;
  if (!token || !status) return refused(input, "That countdown is no longer on this scene.");

  // A clock stores an absolute expiry, so the only way it can HOLD STILL is to
  // move its start. Pushing `bornRound` forward by the delay leaves the pip
  // exactly where it is and the remaining rounds exactly what they were.
  let pushed = 0;
  const clocks = (data.conditionClocks ?? [])
    .filter((clock) => clock.tokenId === token.id)
    .map((clock) => {
      if (clock.status !== status || pushed >= 1) return clock;
      pushed += 1;
      return { ...clock, bornRound: clock.bornRound + span };
    });
  if (!pushed) return refused(input, `Nothing is counting ${status} down on ${nameOf(token)}.`);

  const write = emptyWrite();
  write.clockTokens = [token.id];
  write.clocks = clocks;

  return {
    mode: input.mode,
    target,
    verdict: "commit",
    lines: [
      `${status} stops counting down on ${nameOf(token)} for ${rounds(span)} — it stays on them ${rounds(span)} longer than it would have.`,
    ],
    caveats: [
      `The tag itself does not change, so nothing on the map looks different until the round it would have run out on.`,
    ],
    write,
    label: `${status} on ${nameOf(token)} delayed ${rounds(span)}`,
  };
}

// ── The one entry point ────────────────────────────────────────────────────

/**
 * What this tamper would do, in full, before any of it happens.
 *
 * Always returns a proposal. A mode that cannot resolve against a target comes
 * back `refused` WITH A REASON rather than as null, because "reflect found no
 * caster" is information the Curator needs and a silent no-op is the one answer
 * that teaches them nothing.
 */
export function planTamper(input: TamperInput): TamperProposal {
  const { data, target, mode } = input;

  if (mode === "redirect" || mode === "copy") {
    return {
      mode,
      target,
      verdict: "ruling",
      lines: [],
      caveats: [],
      write: null,
      ruling: RULINGS[mode](target),
      label: `${target.label} — ${mode}`,
    };
  }

  const effect =
    target.kind === "effect"
      ? data.effects.find((candidate) => candidate.id === target.effectId) ?? null
      : null;
  if (target.kind === "effect" && !effect) {
    // The commonest race there is: a 2-round field expires on the round tick
    // while the prompt is open, and the row the Curator is looking at is a row
    // for something that is already over.
    return refused(input, `${target.label} is no longer on this scene — it ended before this could reach it.`);
  }

  if (mode === "end" || mode === "negate") {
    if (effect) return endEffect(input, effect);
    if (target.kind === "clock") return endClock(input);
    return endTrack(input);
  }

  if (mode === "reflect") {
    if (effect) return reflectEffect(input, effect);
    return refused(
      input,
      target.kind === "clock"
        ? `Nothing records who applied ${target.status ?? "that condition"} — a condition countdown carries no caster, so this reflect has no source to turn it back on.`
        : `Nothing records which ability moved ${target.counterName ?? "that track"} — a counter track carries no caster, so this reflect has no source to turn it back on.`
    );
  }

  // delay
  if (effect) return delayEffect(input, effect);
  if (target.kind === "clock") return delayClock(input);
  return refused(
    input,
    `A counter track has no clock to pause — nothing about ${target.counterName ?? "it"} advances on a round, so there is nothing for a delay to hold still.`
  );
}

/**
 * The card a `redirect` or a `copy` opens.
 *
 * An unrolled outcome with one `ruling` row, exactly like `outcomeFromCrossing`:
 * the event already happened, and the card exists only to put the question in
 * front of a human. It carries no consequences the engine can commit, and the
 * auto-apply gate refuses rulings outright, so a table that opted in still
 * answers this one by hand.
 */
export function tamperRulingCard(input: {
  proposal: TamperProposal;
  sourceAbilityId: string;
  sourceAbilityName: string;
  casterCharacterId?: string;
  now: number;
  ttlMs?: number;
}): PendingOutcome | null {
  const { proposal } = input;
  if (proposal.verdict !== "ruling" || !proposal.ruling) return null;
  const target = proposal.target;
  const base = openOutcome({
    id: `tm-${input.sourceAbilityId}-${target.id}-${proposal.mode}`,
    sourceAbilityId: input.sourceAbilityId,
    sourceAbilityName: input.sourceAbilityName,
    casterCharacterId: input.casterCharacterId,
    targets: [{ tokenId: target.tokenId, id: target.id, name: target.tokenName ?? target.label }],
    rollLabel: `${input.sourceAbilityName} tampers with ${target.label}`,
    now: input.now,
    ttlMs: input.ttlMs,
  });
  return {
    ...base,
    fromBlock: true,
    unrolled: true,
    consequences: [
      { id: `rule-${proposal.mode}`, kind: "ruling", label: proposal.ruling, on: "always", declared: true },
    ],
  };
}
