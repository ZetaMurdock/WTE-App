// Shared "official" Codex pages, published by Engineers to Firebase Realtime
// Database so every install can pull them. Node: /published_pages/<stem>.
// Requires the user's Firebase config (with databaseURL) + RTDB rules that allow
// authenticated writes and public reads on that node.
import { firebaseDb, firebaseUserName } from "./tauri";

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
