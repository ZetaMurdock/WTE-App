// Shared "official" Codex pages, published by Engineers to Firebase Realtime
// Database so every install can pull them. Node: /published_pages/<stem>.
// Requires the user's Firebase config (with databaseURL) + RTDB rules that allow
// authenticated writes and public reads on that node (see docs/PUBLISH-SETUP.md).
import { firebaseDb, firebaseUserName, isTauri } from "./tauri";
import { setPageMeta } from "./pageMeta";
import { getPulledMap, markPulled, stalePulled } from "./pulledLib";

export interface PublishedPage {
  stem: string;
  title: string;
  content: string;
  label?: string;
  by?: string;
  at: number;
}

export async function publishPage(p: { stem: string; title: string; content: string; label?: string }): Promise<void> {
  const db = await firebaseDb();
  await db.ref("published_pages/" + p.stem).set({
    stem: p.stem,
    title: p.title,
    content: p.content,
    label: p.label ?? null,
    by: firebaseUserName() ?? "anon",
    at: Date.now(),
  });
}

export async function unpublishPage(stem: string): Promise<void> {
  const db = await firebaseDb();
  await db.ref("published_pages/" + stem).remove();
}

export async function fetchPublishedPages(): Promise<PublishedPage[]> {
  const db = await firebaseDb();
  const snap = await db.ref("published_pages").once("value");
  const val = (snap.val() || {}) as Record<string, PublishedPage>;
  return Object.values(val).filter((p) => p && p.stem);
}

function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const w = window as unknown as { __TAURI__?: { core: { invoke: <R>(c: string, a?: Record<string, unknown>) => Promise<R> } } };
  if (!w.__TAURI__) return Promise.reject(new Error("desktop only"));
  return w.__TAURI__.core.invoke<T>(cmd, args);
}

/** A published page with empty content must never be applied. publishPage falls
 *  back to "" when the local page fails to load, and the old boot-time refresh
 *  would then propagate that blank over every install's local copy while
 *  reporting success to the publisher. */
export function isPublishableContent(content: unknown): content is string {
  return typeof content === "string" && content.trim().length > 0;
}

/** Import one published page into the local Codex: save the markdown, keep its
 *  section label, mark it PULLED (it feeds the sheet/VTT catalogs), and record
 *  the publish timestamp so the picker can tell NEW / UPDATED / CURRENT.
 *
 *  Refuses an empty page: replacing a real local page with "" is destruction,
 *  not an update. */
export async function importPublishedPage(p: PublishedPage): Promise<string> {
  if (!isPublishableContent(p.content)) {
    throw new Error(`"${p.title || p.stem}" was published with no content — refusing to overwrite your local copy.`);
  }
  const stem = await invoke<string>("wte_save_page", { name: p.title || p.stem, content: p.content });
  setPageMeta(stem, { label: p.label ?? undefined, pulled: true });
  markPulled(p.stem, p.at);
  if (stem !== p.stem) markPulled(stem, p.at); // stems normally match; belt for renames
  return stem;
}

/** Library pages this install already pulled whose published copy has moved.
 *
 *  READ ONLY — it deliberately writes nothing. This replaces
 *  autoRefreshPulledPages(), which ran unattended at every launch and called
 *  wte_save_page (a full fs::write) over the local file. Three things were wrong
 *  with that:
 *    - a Curator's own edits to a pulled page were destroyed with no prompt, no
 *      diff, no backup and no undo;
 *    - the `pulled: true` write silently re-enabled a page an Engineer had
 *      deliberately un-pulled;
 *    - it was the delivery mechanism that let a poisoned page reach every install
 *      and render before the user had seen or agreed to anything.
 *
 *  Callers surface these as a review list and apply on request. */
export async function pendingLibraryUpdates(): Promise<PublishedPage[]> {
  if (!isTauri()) return [];
  const pages = await fetchPublishedPages();
  return stalePulled(pages, getPulledMap()).filter((p) => isPublishableContent(p.content));
}

/** Apply the updates the user chose to accept. Reports failures rather than
 *  swallowing them, so a half-applied refresh is visible. */
export async function applyLibraryUpdates(
  updates: PublishedPage[]
): Promise<{ applied: string[]; failed: { stem: string; error: string }[] }> {
  const applied: string[] = [];
  const failed: { stem: string; error: string }[] = [];
  for (const p of updates) {
    try {
      applied.push(await importPublishedPage(p));
    } catch (e) {
      failed.push({ stem: p.stem, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return { applied, failed };
}
