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

/** Import one published page into the local Codex: save the markdown, keep its
 *  section label, mark it PULLED (it feeds the sheet/VTT catalogs), and record
 *  the publish timestamp so the picker can tell NEW / UPDATED / CURRENT. */
export async function importPublishedPage(p: PublishedPage): Promise<string> {
  const stem = await invoke<string>("wte_save_page", { name: p.title || p.stem, content: p.content });
  setPageMeta(stem, { label: p.label ?? undefined, pulled: true });
  markPulled(p.stem, p.at);
  if (stem !== p.stem) markPulled(stem, p.at); // stems normally match; belt for renames
  return stem;
}

/** Boot-time silent refresh: any library page we ALREADY pulled whose published
 *  copy moved gets re-imported, so the owner's edits reach every install on the
 *  next launch. Returns how many pages were refreshed. */
export async function autoRefreshPulledPages(): Promise<number> {
  if (!isTauri()) return 0;
  const pages = await fetchPublishedPages();
  const stale = stalePulled(pages, getPulledMap());
  for (const p of stale) await importPublishedPage(p).catch(() => {});
  return stale.length;
}
