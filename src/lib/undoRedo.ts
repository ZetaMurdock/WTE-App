// App-wide undo/redo, scoped to the window you are working in.
//
// One press, one action. History belongs to a WORKSPACE, not to the dialog
// that happened to be open: closing the page editor while staying around
// Campaign Settings keeps the trail, because the mistake you want back out of
// usually surfaces a moment after the dialog is gone. Switching to an
// unrelated view (the Table, the VTT) drops the trail — undoing an edit you
// can no longer see is how "undo" becomes a new kind of bug.
//
// Actions are inverse PAIRS, not state diffing: each mutation site registers
// how to put the previous value back and how to re-apply its own change. The
// service never guesses at app state.

export interface UndoAction {
  /** Short human label, e.g. `Edit "Cognition"` — shown in button tooltips. */
  label: string;
  undo: () => void | Promise<void>;
  redo: () => void | Promise<void>;
}

const MAX_DEPTH = 100;

let scopeKey: string | null = null;
let undoStack: UndoAction[] = [];
let redoStack: UndoAction[] = [];
/** An inverse in flight; presses while it runs are ignored, not queued. */
let busy = false;

const listeners = new Set<() => void>();
function announce(): void {
  for (const listener of listeners) listener();
}

export function subscribeUndoRedo(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export interface UndoRedoState {
  canUndo: boolean;
  canRedo: boolean;
  undoLabel?: string;
  redoLabel?: string;
}

let snapshot: UndoRedoState = { canUndo: false, canRedo: false };
function refreshSnapshot(): void {
  const next: UndoRedoState = {
    canUndo: undoStack.length > 0 && !busy,
    canRedo: redoStack.length > 0 && !busy,
    undoLabel: undoStack[undoStack.length - 1]?.label,
    redoLabel: redoStack[redoStack.length - 1]?.label,
  };
  if (
    next.canUndo !== snapshot.canUndo || next.canRedo !== snapshot.canRedo ||
    next.undoLabel !== snapshot.undoLabel || next.redoLabel !== snapshot.redoLabel
  ) {
    snapshot = next;
    announce();
  }
}

/** Stable reference per change, for useSyncExternalStore. */
export function undoRedoState(): UndoRedoState {
  return snapshot;
}

/**
 * Enter a workspace. Same key = keep the trail; a different key clears both
 * stacks — history never follows you into a view where its edits are invisible.
 */
export function setUndoScope(key: string): void {
  if (key === scopeKey) return;
  scopeKey = key;
  undoStack = [];
  redoStack = [];
  refreshSnapshot();
}

export function undoScope(): string | null {
  return scopeKey;
}

/** Register a completed action. A new edit always clears the redo trail. */
export function pushUndo(action: UndoAction): void {
  undoStack.push(action);
  if (undoStack.length > MAX_DEPTH) undoStack.shift();
  redoStack = [];
  refreshSnapshot();
}

async function step(from: UndoAction[], to: UndoAction[], run: (a: UndoAction) => void | Promise<void>): Promise<boolean> {
  if (busy) return false;
  const action = from.pop();
  if (!action) return false;
  busy = true;
  refreshSnapshot();
  try {
    await run(action);
    to.push(action);
    return true;
  } catch {
    // The inverse failed (page gone, store rejected). Dropping the action is
    // safer than retry loops: the trail beyond it may no longer apply either.
    return false;
  } finally {
    busy = false;
    refreshSnapshot();
  }
}

/** Undo exactly one action. Resolves false when there was nothing to undo. */
export function undoOnce(): Promise<boolean> {
  return step(undoStack, redoStack, (action) => action.undo());
}

/** Redo exactly one action. */
export function redoOnce(): Promise<boolean> {
  return step(redoStack, undoStack, (action) => action.redo());
}

/** Test seam. */
export function __resetUndoRedo(): void {
  scopeKey = null;
  undoStack = [];
  redoStack = [];
  busy = false;
  refreshSnapshot();
}
