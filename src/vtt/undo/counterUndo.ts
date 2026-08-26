// Undo for a custom currency counted against a body.
//
// `docs/undo-boundary.md` listed counter tracks as a GAP rather than a
// boundary: a mis-clicked `Counter: Blight +1` commits through the same
// authorised writer damage does, is as private a Curator act as any other, and
// could not be taken back. This closes it.
//
// The inverse is a MOVE, not a restore, and that is the whole design:
//
//   `applyTokenCounter` writes two things that have to agree — the pip on the
//   token (through `adjudicateTokenVitals`) and the scene's authoritative track
//   record (through `commitTokenCounter`). An inverse that put the recorded
//   `statuses` back would fix the pip and leave the record reading the new
//   number, so the very next `+1` would resume from the value undo had just
//   erased and stamp a pip nobody could explain. Re-entering through
//   `applyTokenCounter` with the opposite delta moves BOTH, through the writer
//   that already keeps them in step — and inherits its ownership adjudication,
//   its refusal on a player-owned token, and its `onOp` broadcast for free.
//
// Three properties carried over from `vitalsUndo.ts`, for the same reasons
// documented there: the inverse is a real write through the authorised path, a
// stale entry refuses out loud rather than guessing, and every refusal reports
// through `onRefused` before it throws so `undoOnce` dropping the action is not
// mistaken for a key that did nothing.
import { pushUndo } from "../../lib/undoRedo";
import { counterValue, type CounterTrack } from "../../game/counterTracks";
import type { TokenCounterApplication, TokenCounterPlan } from "../data/tokenCounters";

/** The slice of the engine an undoable counter move needs. `PixiVttApp`
 *  satisfies it structurally, so this module and its tests never construct a
 *  renderer. */
export interface CounterUndoEngine {
  applyTokenCounter(input: TokenCounterApplication): TokenCounterPlan | null;
  tokenCounters(tokenId: string): CounterTrack[];
}

export interface UndoableCounterOptions {
  /** Undo-button label, e.g. `Blight +1 on Vex`. */
  label: string;
  /** Told why an inverse could not run — wire this to a toast. */
  onRefused?: (reason: string) => void;
  /** Name for the refusal message; the token may be gone by the time it fires. */
  subject?: string;
  /**
   * Local bookkeeping to swap alongside the move — the resolution card's
   * "applied" mark, and the threshold card a crossing put in the Curator's
   * hand. Runs only AFTER the number actually moved back, so a refused inverse
   * can never leave a row armed over a count still standing.
   */
  restore?: (phase: "undo" | "redo") => void;
}

function refuse(opts: UndoableCounterOptions, reason: string): never {
  opts.onRefused?.(reason);
  // Thrown, not returned: `undoOnce` drops an action whose inverse throws, and
  // keeping a step that cannot apply would leave the rest of the trail resting
  // on state that never came back.
  throw new Error(reason);
}

/** What the body's track reads right now. Zero for a track it no longer carries
 *  — which is the same answer as a track that ran back down to zero, exactly as
 *  `counterValue` intends, because those two states are indistinguishable to a
 *  table and must not diverge here either. */
function reading(engine: CounterUndoEngine, tokenId: string, name: string): number {
  return counterValue(engine.tokenCounters(tokenId), name);
}

function move(
  engine: CounterUndoEngine,
  input: TokenCounterApplication & { tokenId: string },
  plan: TokenCounterPlan,
  from: number,
  to: number,
  opts: UndoableCounterOptions,
  phase: "undo" | "redo"
): void {
  const who = opts.subject ?? "That token";
  const now = reading(engine, input.tokenId, plan.name);
  if (now !== from) {
    refuse(
      opts,
      `${who}'s ${plan.name} has changed since "${opts.label}" — reversing it now would undo the later change instead.`
    );
  }
  // The step's own thresholds are deliberately NOT passed on.
  //
  // Downward, `crossedThresholds` returns nothing anyway. Upward — a redo — it
  // would report the same crossing a second time, and the card that crossing
  // already produced is the one `restore` is about to hand back. Re-deriving it
  // here would put two Resolution Cards on screen for one arrival at 8.
  const back = engine.applyTokenCounter({
    tokenId: input.tokenId,
    name: plan.name,
    delta: to - from,
    ...(plan.cap != null ? { cap: plan.cap } : {}),
  });
  if (!back) {
    refuse(opts, `"${opts.label}" could not be reversed — that token could not be written to.`);
  }
  // The writer clamps at the cap and floors at zero, so a move it accepted may
  // still not have arrived where the entry expects. Saying so beats a stack
  // whose later entries rest on a number that never came back.
  if (back.to !== to) {
    refuse(opts, `"${opts.label}" could not be reversed — ${plan.name} would not return to ${to}.`);
  }
  opts.restore?.(phase);
}

/**
 * A Curator's counter move that can be taken back.
 *
 * Returns exactly what `applyTokenCounter` returned, so a caller still never
 * announces a crossing it did not commit.
 */
export function applyUndoableCounter(
  engine: CounterUndoEngine,
  input: TokenCounterApplication & { tokenId: string },
  opts: UndoableCounterOptions
): TokenCounterPlan | null {
  const plan = engine.applyTokenCounter(input);
  if (!plan) return null;
  // A move the ceiling refused entirely — `+1` on a track already sitting at its
  // cap. The writer accepted it and the pip is byte-identical; there is nothing
  // to put back, and an entry here would spend the Curator's next Ctrl+Z on an
  // act that changed nothing while the real mistake sat one press deeper.
  if (plan.from === plan.to) return plan;
  const { from, to } = plan;
  pushUndo({
    label: opts.label,
    undo: () => move(engine, input, plan, to, from, opts, "undo"),
    redo: () => move(engine, input, plan, from, to, opts, "redo"),
  });
  return plan;
}
