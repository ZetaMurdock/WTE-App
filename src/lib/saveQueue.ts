// One registry for every debounced save in the app.
//
// Two problems this exists to solve:
//
// 1. NOTHING flushed on close. The character sheet debounces 400ms and the VTT
//    scene 500ms, and there was no beforeunload handler anywhere — so the last
//    attribute bump, spent SS, Focus purchase, rank change, token move or fog
//    reveal was simply dropped whenever the app was quit, with no prompt and no
//    indication anything was pending.
//
// 2. There was no way to know whether a save was in flight, so no save-status
//    indicator could exist. Anything registered here is observable.
//
// A component with a debounced write registers its flush function and reports when
// it has work outstanding. Closing the app, or navigating somewhere destructive,
// calls flushAll() first.

export type SaveState = "idle" | "pending" | "saving" | "failed";

interface Entry {
  /** Persist immediately whatever is outstanding. Must be safe to call when clean. */
  flush: () => Promise<void> | void;
  /** A human name for the thing being saved, used in the indicator. */
  label: string;
  pending: boolean;
}

const entries = new Map<symbol, Entry>();
const subs = new Set<() => void>();
let lastError: string | null = null;
let inFlight = 0;

function emit(): void {
  for (const cb of subs) cb();
}

/** Register a debounced writer. Call the returned function on unmount. */
export function registerSaver(label: string, flush: () => Promise<void> | void): {
  markPending: () => void;
  markSaved: () => void;
  markFailed: (message: string) => void;
  unregister: () => void;
} {
  const key = Symbol(label);
  entries.set(key, { flush, label, pending: false });
  emit();
  return {
    markPending: () => {
      const e = entries.get(key);
      if (e && !e.pending) {
        e.pending = true;
        emit();
      }
    },
    markSaved: () => {
      const e = entries.get(key);
      if (e && e.pending) {
        e.pending = false;
        emit();
      }
      if (lastError) {
        lastError = null;
        emit();
      }
    },
    markFailed: (message: string) => {
      const e = entries.get(key);
      if (e) e.pending = false;
      lastError = message;
      emit();
    },
    unregister: () => {
      entries.delete(key);
      emit();
    },
  };
}

/** Anything outstanding right now. */
export function hasPendingSaves(): boolean {
  for (const e of entries.values()) if (e.pending) return true;
  return false;
}

/** What the indicator should show. */
export function saveState(): SaveState {
  if (lastError) return "failed";
  if (inFlight > 0) return "saving";
  return hasPendingSaves() ? "pending" : "idle";
}

export function saveErrorMessage(): string | null {
  return lastError;
}

/** Labels of everything currently outstanding, for the indicator's tooltip. */
export function pendingLabels(): string[] {
  return [...entries.values()].filter((e) => e.pending).map((e) => e.label);
}

export function subscribeSaveState(cb: () => void): () => void {
  subs.add(cb);
  return () => subs.delete(cb);
}

/** Persist everything outstanding. Never rejects — a failing saver must not stop
 *  the others from getting their chance to write. */
export async function flushAll(): Promise<void> {
  const all = [...entries.values()];
  if (all.length === 0) return;
  inFlight++;
  emit();
  try {
    await Promise.all(
      all.map(async (e) => {
        try {
          await e.flush();
        } catch (err) {
          lastError = `Couldn't save ${e.label}: ${err instanceof Error ? err.message : String(err)}`;
        }
      })
    );
  } finally {
    inFlight--;
    emit();
  }
}

let installed = false;
/** Kept so the test seam can genuinely detach them; see __resetSaveQueue. */
let onBeforeUnload: (() => void) | null = null;
let onVisibility: (() => void) | null = null;

/** Wire the close paths to flushAll. Safe to call more than once. */
export function installSaveGuards(): void {
  if (installed) return;
  installed = true;

  // Fires on webview teardown in both the browser and the Tauri window. The
  // handler must be synchronous, so this kicks the writes off and relies on the
  // SQL plugin's in-flight request completing; it is strictly better than dropping
  // the debounce timer on the floor, which is what happened before.
  onBeforeUnload = () => {
    if (hasPendingSaves()) void flushAll();
  };
  window.addEventListener("beforeunload", onBeforeUnload);

  // Tauri's own close request, which fires BEFORE teardown and can be awaited —
  // this is the one that actually guarantees the write lands. Wired defensively
  // because the API shape differs across Tauri versions and the legacy HTML pages
  // do not have it at all.
  try {
    const w = window as unknown as {
      __TAURI__?: {
        window?: {
          getCurrentWindow?: () => { onCloseRequested?: (cb: () => Promise<void> | void) => Promise<unknown> };
        };
      };
    };
    const getWin = w.__TAURI__?.window?.getCurrentWindow;
    if (typeof getWin === "function") {
      const win = getWin();
      if (win && typeof win.onCloseRequested === "function") {
        void win.onCloseRequested(async () => {
          await flushAll();
        });
      }
    }
  } catch {
    /* beforeunload above is the fallback */
  }

  // Also flush when the window loses focus or is hidden — covers alt-tabbing away
  // and never coming back, and a machine going to sleep.
  onVisibility = () => {
    if (document.visibilityState === "hidden" && hasPendingSaves()) void flushAll();
  };
  window.addEventListener("visibilitychange", onVisibility);
}

/** Test seam. Detaches the real listeners as well as clearing the flag — leaving
 *  them attached made the guards look non-idempotent across tests. */
export function __resetSaveQueue(): void {
  entries.clear();
  subs.clear();
  lastError = null;
  inFlight = 0;
  installed = false;
  if (onBeforeUnload) window.removeEventListener("beforeunload", onBeforeUnload);
  if (onVisibility) window.removeEventListener("visibilitychange", onVisibility);
  onBeforeUnload = null;
  onVisibility = null;
}
