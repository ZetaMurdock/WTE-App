// Undo for the writes that take state AWAY.
//
// `vitalsUndo` covers the writes that put something on a body. Tamper is the
// other direction — it removes a field, strips the pips that field granted, and
// drops the countdowns watching them — and that makes it the write most in need
// of an inverse in the whole arc: a mis-clicked negate destroys four kinds of
// record at once, and before this module there was no way back from any of them.
// `docs/undo-boundary.md` listed "placement and removal of zones, auras and
// effects" as a gap; for the tamper verb, this closes it.
//
// The three properties `vitalsUndo` holds, held here too and for the same
// reasons:
//
// 1. THE INVERSE IS A REAL WRITE through the authorised paths — pips through
//    `adjudicateTokenVitals`, effects through ops that reach peers. Putting a
//    removed effect back by pushing it onto `scene.data.effects` would restore it
//    on the Curator's screen and on nobody else's.
// 2. AN INVERSE FIRES ONLY WHILE WHAT IT WROTE IS STILL WHAT IS THERE. Effects
//    also move through paths that register nothing — the round tick expires
//    them, an aura's owner leaving drops it, a peer's snapshot replaces the lot
//    — so an entry goes stale underneath you. Replaying a stale `before` would
//    resurrect a field the encounter had legitimately ended.
// 3. A REFUSAL IS VISIBLE. `undoOnce` swallows a throwing inverse, which looks
//    exactly like a key that did nothing, so every refusal reports through
//    `onRefused` before it throws.
//
// PARTIAL WRITES ARE ROLLED BACK, which vitals never had to worry about: one
// tamper can write pips to a dozen bodies, and `adjudicateTokenVitals` refuses a
// player-owned token. Stopping halfway would leave the field gone and half the
// corridor still Burning, with one undo entry that could not describe either
// half. So the pips are written first, and the first refusal puts back the ones
// already written before anything touches an effect.
import { pushUndo } from "../../lib/undoRedo";
import type { VttConditionClock, VttCounterTrack, VttEffect, VttSceneData } from "../types/scene";
import type { TamperWrite } from "../data/tamperPlan";

/** The slice of the engine a tamper needs. `PixiVttApp` satisfies it
 *  structurally, so this module and its tests never construct a renderer. */
export interface TamperUndoEngine {
  readonly scene: { data: VttSceneData } | null;
  adjudicateTokenVitals(id: string, patch: { statuses: string[] }): boolean;
  setConditionClocks(clocks: VttConditionClock[]): boolean;
  setCounterTracks(tracks: VttCounterTrack[]): boolean;
  /** Put effects on the scene exactly as given, replacing any with the same id. */
  putEffects(effects: readonly VttEffect[]): boolean;
  /** Take effects off the scene by id. Returns how many went. */
  removeEffects(ids: readonly string[]): number;
}

export interface TamperUndoOptions {
  /** Undo-button label, e.g. `Absolute Zero negated`. */
  label: string;
  /** Told why a write, or its inverse, could not run — wire this to a toast. */
  onRefused?: (reason: string) => void;
}

function dataOf(engine: TamperUndoEngine): VttSceneData | null {
  return engine.scene?.data ?? null;
}

function sameList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((entry, i) => entry === b[i]);
}

/** A whole effect as one comparable string. Deep rather than by id, because the
 *  writes this module inverts change an effect's POSITION and its data keys, and
 *  an entry that only checked "is fx-3 still here?" would happily undo a reflect
 *  the Curator had since moved by hand. */
function effectKey(effect: VttEffect): string {
  return JSON.stringify([effect.id, effect.kind, effect.x, effect.y, effect.data]);
}

function effectOf(data: VttSceneData, id: string): VttEffect | null {
  return data.effects.find((candidate) => candidate.id === id) ?? null;
}

function clocksFor(data: VttSceneData, tokenIds: readonly string[]): VttConditionClock[] {
  const ids = new Set(tokenIds);
  return (data.conditionClocks ?? []).filter((clock) => ids.has(clock.tokenId)).map((clock) => ({ ...clock }));
}

function tracksFor(data: VttSceneData, tokenIds: readonly string[]): VttCounterTrack[] {
  const ids = new Set(tokenIds);
  return (data.counterTracks ?? []).filter((track) => ids.has(track.tokenId)).map((track) => ({ ...track }));
}

/**
 * The state one write is about to replace, in the same shape as the write
 * itself — so the inverse of a tamper is just another tamper.
 *
 * Scoped to the tokens and the effects the forward write names, never to the
 * scene's whole clock or track list. Restoring everything would delete a
 * condition that landed on somebody else while this entry sat on the stack; see
 * `vitalsUndo.restoreClocksFor` for the same argument in the vitals half.
 */
function snapshotBefore(data: VttSceneData, write: TamperWrite): TamperWrite {
  const before: TamperWrite = {
    statuses: write.statuses.map((entry) => {
      const token = data.tokens.find((candidate) => candidate.id === entry.tokenId);
      return { tokenId: entry.tokenId, tokenName: entry.tokenName, statuses: [...(token?.statuses ?? [])] };
    }),
    removeEffects: [],
    putEffects: [],
    clockTokens: [...write.clockTokens],
    clocks: clocksFor(data, write.clockTokens),
    trackTokens: [...write.trackTokens],
    tracks: tracksFor(data, write.trackTokens),
  };
  // Every id the forward write touches, in either direction. One that is on the
  // scene now is restored as it stands; one that is NOT — a `putEffects` that
  // adds something new — is removed again by the inverse.
  const touched = [...write.removeEffects, ...write.putEffects.map((effect) => effect.id)];
  for (const id of touched) {
    const live = effectOf(data, id);
    if (live) before.putEffects.push(structuredClone(live));
    else before.removeEffects.push(id);
  }
  return before;
}

/** Whether a write would move anything at all. A tamper that changes nothing
 *  registers nothing, so Ctrl+Z does not have to be pressed twice to reach the
 *  act the Curator actually means. */
function moves(data: VttSceneData, write: TamperWrite): boolean {
  for (const entry of write.statuses) {
    const token = data.tokens.find((candidate) => candidate.id === entry.tokenId);
    if (!sameList(token?.statuses ?? [], entry.statuses)) return true;
  }
  if (write.removeEffects.some((id) => effectOf(data, id))) return true;
  for (const effect of write.putEffects) {
    const live = effectOf(data, effect.id);
    if (!live || effectKey(live) !== effectKey(effect)) return true;
  }
  if (write.clockTokens.length) {
    const now = clocksFor(data, write.clockTokens);
    if (JSON.stringify(now) !== JSON.stringify(write.clocks)) return true;
  }
  if (write.trackTokens.length) {
    const now = tracksFor(data, write.trackTokens);
    if (JSON.stringify(now) !== JSON.stringify(write.tracks)) return true;
  }
  return false;
}

/** Does the scene still say exactly what this write left behind? */
function stillHolds(data: VttSceneData, write: TamperWrite): boolean {
  return !moves(data, write);
}

function refuse(opts: TamperUndoOptions, reason: string): never {
  opts.onRefused?.(reason);
  // Thrown, not returned: `undoOnce` drops an action whose inverse throws, and
  // keeping a step that cannot apply would leave the rest of the trail resting
  // on state that never came back.
  throw new Error(reason);
}

/**
 * Commit one write. Returns the reason it could not, or null on success.
 *
 * The pips go first and alone, because they are the only half a token can refuse.
 * A refusal puts back everything this call had already written and reports which
 * body said no — an effect removed beside a body that kept its pip is precisely
 * the stranded state this whole verb exists to avoid.
 */
function applyWrite(engine: TamperUndoEngine, write: TamperWrite): string | null {
  const data = dataOf(engine);
  if (!data) return "There is no scene open to tamper with.";

  const undoPips: { tokenId: string; statuses: string[] }[] = [];
  for (const entry of write.statuses) {
    const token = data.tokens.find((candidate) => candidate.id === entry.tokenId);
    if (!token) {
      // Gone from the scene is not a refusal: there is no pip left to strip, and
      // the rest of the act is still exactly right.
      continue;
    }
    const priorStatuses = [...(token.statuses ?? [])];
    if (sameList(priorStatuses, entry.statuses)) continue;
    if (!engine.adjudicateTokenVitals(entry.tokenId, { statuses: [...entry.statuses] })) {
      for (const back of undoPips) engine.adjudicateTokenVitals(back.tokenId, { statuses: back.statuses });
      return `${entry.tokenName} could not be written to, so nothing was changed.`;
    }
    undoPips.push({ tokenId: entry.tokenId, statuses: priorStatuses });
  }

  if (write.removeEffects.length) engine.removeEffects(write.removeEffects);
  if (write.putEffects.length) engine.putEffects(write.putEffects.map((effect) => structuredClone(effect)));

  if (write.clockTokens.length) {
    const scoped = new Set(write.clockTokens);
    const others = (data.conditionClocks ?? []).filter((clock) => !scoped.has(clock.tokenId));
    engine.setConditionClocks([...others, ...write.clocks.map((clock) => ({ ...clock }))]);
  }
  if (write.trackTokens.length) {
    const scoped = new Set(write.trackTokens);
    const others = (data.counterTracks ?? []).filter((track) => !scoped.has(track.tokenId));
    engine.setCounterTracks([...others, ...write.tracks.map((track) => ({ ...track }))]);
  }
  return null;
}

function invert(
  engine: TamperUndoEngine,
  expected: TamperWrite,
  target: TamperWrite,
  opts: TamperUndoOptions
): void {
  const data = dataOf(engine);
  if (!data) refuse(opts, `There is no scene open, so "${opts.label}" could not be reversed.`);
  if (!stillHolds(data, expected)) {
    refuse(
      opts,
      `The scene has changed since "${opts.label}" — reversing it now would undo the later change instead.`
    );
  }
  const failed = applyWrite(engine, target);
  if (failed) refuse(opts, `"${opts.label}" could not be reversed — ${failed}`);
}

/**
 * A Curator's confirmed tamper, committed and reversible.
 *
 * Returns whether the write landed, so a caller never announces a field it did
 * not actually remove.
 */
export function commitUndoableTamper(
  engine: TamperUndoEngine,
  write: TamperWrite,
  opts: TamperUndoOptions
): boolean {
  const data = dataOf(engine);
  if (!data) {
    opts.onRefused?.("There is no scene open to tamper with.");
    return false;
  }
  if (!moves(data, write)) {
    // Nothing to do and nothing to take back. A second negate of the same field
    // lands here: the effect is already gone and the pips already off, so the
    // act is honestly reported as having changed nothing rather than pushing an
    // empty entry that swallows the next Ctrl+Z.
    opts.onRefused?.("Nothing changed — that effect has already been dealt with.");
    return false;
  }
  const before = snapshotBefore(data, write);
  const failed = applyWrite(engine, write);
  if (failed) {
    opts.onRefused?.(failed);
    return false;
  }
  // Read back what actually landed rather than trusting the plan: a token that
  // had left the scene is skipped by `applyWrite`, and an inverse built from the
  // plan would try to restore a pip to a body that is not there.
  const after = snapshotBefore(dataOf(engine) as VttSceneData, before);
  pushUndo({
    label: opts.label,
    undo: () => invert(engine, after, before, opts),
    redo: () => invert(engine, before, after, opts),
  });
  return true;
}
