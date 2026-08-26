// Undo for the writes that reach a body.
//
// The VTT registered nothing with the app-wide undo service, so switching to
// the table handed you an empty stack: damage, conditions and zone statuses —
// everything this arc taught the engine to apply — were permanent the instant
// they landed, on the one surface that writes to a player's character.
//
// Three properties this module exists to hold:
//
// 1. The inverse is a REAL write back through `adjudicateTokenVitals`, never a
//    reach-in assignment. A restore that mutated the token directly would skip
//    the ownership adjudication AND skip `onOp`, so the Curator's screen would
//    show the HP restored while every player kept looking at the damage — a
//    desync with no symptom on the machine that caused it.
// 2. An inverse fires only while the value it wrote is still the value on the
//    token. HP and statuses also move through paths that register nothing (a
//    recurring tick on the round advance calls the writer directly, as does a
//    peer's snapshot), so an entry can go stale underneath you. Replaying a
//    stale `before` would silently revert whatever landed in between — undo
//    becoming a new way to lose a ruling. A stale entry refuses out loud.
// 3. A refusal is visible. `undoOnce` swallows a throwing inverse and drops the
//    action, which on its own looks exactly like a key that did nothing, so
//    every refusal reports through `onRefused` before it throws.
//
// What is deliberately NOT undoable is stated in `docs/undo-boundary.md`.

import { pushUndo } from "../../lib/undoRedo";
import type { VttConditionClock, VttToken } from "../types/scene";
import { sanitizeTokenVitalsPatch } from "../sync/patches";

/** The slice of the engine an undoable adjudication needs. `PixiVttApp`
 *  satisfies it structurally, so this module and its tests never construct a
 *  renderer. */
export interface VitalsUndoEngine {
  readonly scene: { data: { tokens: VttToken[]; conditionClocks?: VttConditionClock[] } } | null;
  adjudicateTokenVitals(id: string, patch: Partial<VttToken>): boolean;
  applyTokenCondition(input: { tokenId: string; status: string; rounds?: number; potency?: number }): boolean;
  setConditionClocks(clocks: VttConditionClock[]): boolean;
}

export type VitalsField = "hp" | "statuses";

export interface UndoableVitalsOptions {
  /** Undo-button label, e.g. `damage to Vex`. */
  label: string;
  /** Told why an inverse could not run — wire this to a toast. */
  onRefused?: (reason: string) => void;
  /** Name for the refusal message; the token may be gone by the time it fires. */
  subject?: string;
  /**
   * Local bookkeeping to swap alongside the write — the resolution card's
   * "applied" mark, most of all. Runs only AFTER the body actually came back,
   * so a refused inverse can never leave a row armed over damage still standing.
   */
  restore?: (phase: "undo" | "redo") => void;
}

interface VitalsSnapshot {
  hp?: number;
  /** Always materialised: see `readVitals` on why `undefined` is not kept. */
  statuses?: string[];
}

const STATUS_ONLY: readonly VitalsField[] = ["statuses"];

function tokenOf(engine: VitalsUndoEngine, id: string): VttToken | null {
  return engine.scene?.data.tokens.find((token) => token.id === id) ?? null;
}

/**
 * The fields a patch will actually write, decided by the same sanitizer the
 * writer uses. Re-deriving the vitals allowlist here would let the two drift,
 * and an inverse over a field the writer silently dropped restores a value
 * that never changed.
 */
function fieldsOf(patch: Partial<VttToken>): VitalsField[] {
  return Object.keys(sanitizeTokenVitalsPatch(patch)) as VitalsField[];
}

/**
 * Current value of each field.
 *
 * `statuses` is normalised to a real array because a patch of
 * `{ statuses: undefined }` survives locally but JSON-serialises to `{}` on the
 * wire: the Curator would see the pips cleared and no peer would ever hear
 * about it. `[]` renders identically and travels.
 */
function readVitals(token: VttToken, fields: readonly VitalsField[]): VitalsSnapshot {
  const snapshot: VitalsSnapshot = {};
  for (const field of fields) {
    if (field === "hp") snapshot.hp = token.hp;
    else snapshot.statuses = [...(token.statuses ?? [])];
  }
  return snapshot;
}

function sameStatuses(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((status, index) => status === b[index]);
}

/** Whether the token still carries exactly what this snapshot recorded. */
function stillHolds(token: VttToken, snapshot: VitalsSnapshot, fields: readonly VitalsField[]): boolean {
  for (const field of fields) {
    if (field === "hp" && token.hp !== snapshot.hp) return false;
    if (field === "statuses" && !sameStatuses(token.statuses ?? [], snapshot.statuses ?? [])) return false;
  }
  return true;
}

function patchOf(snapshot: VitalsSnapshot, fields: readonly VitalsField[]): Partial<VttToken> {
  const patch: Partial<VttToken> = {};
  for (const field of fields) {
    if (field === "hp") patch.hp = snapshot.hp;
    // A fresh array per write: the snapshot is the undo entry's own record and
    // must not become the live token's array, or the next application would
    // edit the thing undo intends to restore.
    else patch.statuses = [...(snapshot.statuses ?? [])];
  }
  return patch;
}

function refuse(opts: UndoableVitalsOptions, reason: string): never {
  opts.onRefused?.(reason);
  // Thrown, not returned: `undoOnce` drops an action whose inverse throws, and
  // keeping a step that cannot apply would leave the rest of the trail resting
  // on state that never came back.
  throw new Error(reason);
}

function invert(
  engine: VitalsUndoEngine,
  id: string,
  fields: readonly VitalsField[],
  expected: VitalsSnapshot,
  target: VitalsSnapshot,
  opts: UndoableVitalsOptions,
  restore?: () => void
): void {
  const who = opts.subject ?? "That token";
  const token = tokenOf(engine, id);
  if (!token) refuse(opts, `${who} is no longer on this scene, so "${opts.label}" could not be reversed.`);
  if (!stillHolds(token, expected, fields)) {
    refuse(opts, `${who} has changed since "${opts.label}" — reversing it now would undo the later change instead.`);
  }
  if (!engine.adjudicateTokenVitals(id, patchOf(target, fields))) {
    refuse(opts, `"${opts.label}" could not be reversed — that token could not be written to.`);
  }
  restore?.();
}

/** Nothing to put back when the write moved nothing. */
function unchanged(before: VitalsSnapshot, after: VitalsSnapshot, fields: readonly VitalsField[]): boolean {
  return fields.every((field) =>
    field === "hp" ? before.hp === after.hp : sameStatuses(before.statuses ?? [], after.statuses ?? [])
  );
}

function register(
  engine: VitalsUndoEngine,
  id: string,
  fields: readonly VitalsField[],
  before: VitalsSnapshot,
  after: VitalsSnapshot,
  opts: UndoableVitalsOptions,
  restore?: (phase: "undo" | "redo") => void,
  /**
   * Something OUTSIDE the vitals fields moved as well, so the write is not the
   * no-op the pips make it look like. A `refresh`/`extend`/`highest` condition
   * landing on a body that already carries the tag leaves `statuses` byte-equal
   * and moves only the clock: without this, that application registered nothing,
   * the extended duration could not be taken back, and the next Ctrl+Z reached
   * PAST it to the first application and pulled the condition off the token
   * entirely — under a tooltip naming the wrong act.
   */
  alsoMoved = false
): void {
  // A token that tracked no HP at all cannot be restored to "no HP": there is
  // no wire value for absent, and `{ hp: undefined }` reaches peers as `{}`.
  // Rather than ship an inverse that only works on the Curator's screen, this
  // write stays outside the trail.
  if (fields.includes("hp") && before.hp === undefined) return;
  if (!alsoMoved && unchanged(before, after, fields)) return;
  pushUndo({
    label: opts.label,
    undo: () => invert(engine, id, fields, after, before, opts, restore && (() => restore("undo"))),
    redo: () => invert(engine, id, fields, before, after, opts, restore && (() => restore("redo"))),
  });
}

/**
 * A Curator's adjudicated vitals write that can be taken back.
 *
 * Returns exactly what `adjudicateTokenVitals` returned, so a caller still
 * never announces HP it did not commit.
 */
export function adjudicateUndoableVitals(
  engine: VitalsUndoEngine,
  id: string,
  patch: Partial<VttToken>,
  opts: UndoableVitalsOptions
): boolean {
  const fields = fieldsOf(patch);
  const token = tokenOf(engine, id);
  if (!token || !fields.length) return engine.adjudicateTokenVitals(id, patch);
  const before = readVitals(token, fields);
  if (!engine.adjudicateTokenVitals(id, patch)) return false;
  // Read the landed value off the token rather than trusting the patch: the
  // writer sanitises, and an inverse built from a field it dropped would push
  // a value the table never saw.
  const after = readVitals(tokenOf(engine, id) ?? token, fields);
  register(engine, id, fields, before, after, opts, opts.restore);
  return true;
}

/** This token's countdowns, copied out of the scene so later edits cannot
 *  reach into the undo entry. */
function clocksFor(engine: VitalsUndoEngine, tokenId: string): VttConditionClock[] {
  return (engine.scene?.data.conditionClocks ?? [])
    .filter((clock) => clock.tokenId === tokenId)
    .map((clock) => ({ ...clock }));
}

/**
 * One clock's whole content, for comparing two readings of the same token's
 * countdowns. `tokenId` is left out because both sides are already filtered to
 * one token; sorting makes the comparison order-blind, because `plan` rebuilds
 * the scene list as `[...rest, winner]` and can hand back the same clocks in a
 * different order.
 */
function clockKey(clock: VttConditionClock): string {
  return `${clock.status}\u0000${clock.bornRound}\u0000${clock.rounds}\u0000${clock.potency ?? ""}`;
}

/** Whether two readings of a token's countdowns say the same thing. */
function sameClocks(a: readonly VttConditionClock[], b: readonly VttConditionClock[]): boolean {
  if (a.length !== b.length) return false;
  const left = a.map(clockKey).sort();
  const right = b.map(clockKey).sort();
  return left.every((key, index) => key === right[index]);
}

/**
 * Swap only this token's countdowns back. The clock list is scene-wide, so
 * restoring the whole recorded array would delete a condition that landed on
 * someone else while this entry sat on the stack.
 */
function restoreClocksFor(engine: VitalsUndoEngine, tokenId: string, clocks: VttConditionClock[]): void {
  const others = (engine.scene?.data.conditionClocks ?? []).filter((clock) => clock.tokenId !== tokenId);
  engine.setConditionClocks([...others, ...clocks.map((clock) => ({ ...clock }))]);
}

/**
 * A condition landing on a body, undoable together with its countdown.
 *
 * The clocks are recorded rather than re-planned on redo: re-running the
 * Stacking rule at redo time would anchor `bornRound` to whatever round it is
 * now, quietly handing the target a different duration than the one the table
 * watched land.
 */
export function applyUndoableCondition(
  engine: VitalsUndoEngine,
  input: { tokenId: string; status: string; rounds?: number; potency?: number },
  opts: UndoableVitalsOptions
): boolean {
  const token = tokenOf(engine, input.tokenId);
  if (!token) return engine.applyTokenCondition(input);
  const before = readVitals(token, STATUS_ONLY);
  const clocksBefore = clocksFor(engine, input.tokenId);
  if (!engine.applyTokenCondition(input)) return false;
  const after = readVitals(tokenOf(engine, input.tokenId) ?? token, STATUS_ONLY);
  const clocksAfter = clocksFor(engine, input.tokenId);
  register(
    engine,
    input.tokenId,
    STATUS_ONLY,
    before,
    after,
    opts,
    (phase) => {
      restoreClocksFor(engine, input.tokenId, phase === "undo" ? clocksBefore : clocksAfter);
      opts.restore?.(phase);
    },
    !sameClocks(clocksBefore, clocksAfter)
  );
  return true;
}
