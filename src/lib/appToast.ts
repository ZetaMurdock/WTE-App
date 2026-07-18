// A tiny app-wide toast channel for things the user MUST notice — above all,
// failed saves. Persistence used to fail silently (`.catch(() => {})`), so a
// player could edit a sheet, get no signal, and lose the work. Anything that
// writes to disk should report through here instead of swallowing the error.

export interface AppToast {
  id: number;
  kind: "error" | "info";
  text: string;
}

let seq = 1;
let toasts: AppToast[] = [];
const subs = new Set<() => void>();

function emit(): void {
  for (const cb of subs) cb();
}

export function getToasts(): AppToast[] {
  return toasts;
}

export function subscribeToasts(cb: () => void): () => void {
  subs.add(cb);
  return () => {
    subs.delete(cb);
  };
}

export function dismissToast(id: number): void {
  toasts = toasts.filter((t) => t.id !== id);
  emit();
}

export function pushToast(text: string, kind: AppToast["kind"] = "error", ttlMs = 7000): void {
  // collapse repeats so a failing autosave can't spam the screen
  if (toasts.some((t) => t.text === text)) return;
  const id = seq++;
  toasts = [{ id, kind, text }, ...toasts].slice(0, 3);
  emit();
  if (ttlMs > 0) setTimeout(() => dismissToast(id), ttlMs);
}

/** Await a persistence promise, surfacing (not swallowing) any failure. */
export async function reportSaveFailure<T>(p: Promise<T>, what: string): Promise<T | undefined> {
  try {
    return await p;
  } catch (e) {
    pushToast(`Couldn't save ${what} — ${e instanceof Error ? e.message : String(e)}`);
    return undefined;
  }
}
