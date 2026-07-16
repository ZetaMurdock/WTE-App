// Scene-blob de-inlining. Backgrounds and token art are base64 data URLs; kept
// INSIDE scene.data they made every 500ms autosave re-serialize megabytes of
// JSON to SQLite. On SAVE we extract big data URLs into content-addressed rows
// in the `assets` table (kind "blob") and store tiny `wte-blob:<id>` refs; on
// LOAD we inflate the refs back. The IN-MEMORY scene (and therefore netplay
// snapshots to peers, who don't share our DB) always carries full data URLs.
//
// The transforms are pure (Map-driven) so they're unit-testable; the DB-facing
// wrappers live at the bottom.
import { getDb, sqlAvailable } from "../../lib/db";
import type { VttSceneData } from "../types/scene";

export const BLOB_PREFIX = "wte-blob:";
/** Only strings at least this long are worth a row round-trip. */
export const BLOB_MIN_CHARS = 2048;

/** FNV-1a over the string + its length — a stable content address. */
export function blobId(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return "bl-" + (h >>> 0).toString(36) + "-" + s.length.toString(36);
}

function isInline(v: unknown): v is string {
  return typeof v === "string" && v.startsWith("data:") && v.length >= BLOB_MIN_CHARS;
}

/** Replace large inline images with refs, reporting each blob via `put`.
 *  Returns a DEEP-enough copy — the input data is never mutated. */
export function deflateSceneData(data: VttSceneData, put: (id: string, uri: string) => void): VttSceneData {
  const out: VttSceneData = { ...data, background: { ...data.background }, tokens: data.tokens.map((t) => ({ ...t })) };
  if (isInline(out.background.src)) {
    const id = blobId(out.background.src);
    put(id, out.background.src);
    out.background.src = BLOB_PREFIX + id;
  }
  for (const t of out.tokens) {
    if (isInline(t.img)) {
      const id = blobId(t.img);
      put(id, t.img);
      t.img = BLOB_PREFIX + id;
    }
  }
  return out;
}

/** Collect the blob ids a stored scene references. */
export function collectBlobRefs(data: VttSceneData): string[] {
  const ids: string[] = [];
  const ref = (v?: string | null) => {
    if (typeof v === "string" && v.startsWith(BLOB_PREFIX)) ids.push(v.slice(BLOB_PREFIX.length));
  };
  ref(data.background.src);
  for (const t of data.tokens) ref(t.img);
  return ids;
}

/** Swap refs back to their stored URIs (in place — used on freshly-parsed data).
 *  Unknown refs are left as-is: the image fails to load but nothing crashes. */
export function inflateSceneData(data: VttSceneData, get: (id: string) => string | undefined): VttSceneData {
  const swap = (v?: string | null): string | undefined | null => {
    if (typeof v === "string" && v.startsWith(BLOB_PREFIX)) return get(v.slice(BLOB_PREFIX.length)) ?? v;
    return v;
  };
  data.background.src = swap(data.background.src) ?? undefined;
  for (const t of data.tokens) t.img = swap(t.img);
  return data;
}

// ── DB wrappers ──────────────────────────────────────────────────────────────

/** Persist collected blobs (content-addressed → INSERT OR IGNORE is enough). */
export async function saveBlobs(campaignId: string | null, blobs: Map<string, string>): Promise<void> {
  if (!sqlAvailable() || blobs.size === 0) return;
  const db = await getDb();
  for (const [id, uri] of blobs) {
    await db.execute("INSERT OR IGNORE INTO assets (id, campaign_id, kind, name, uri, created_at) VALUES ($1,$2,$3,$4,$5,$6)", [
      id,
      campaignId,
      "blob",
      "scene-blob",
      uri,
      Date.now(),
    ]);
  }
}

/** Fetch blob uris by id (chunked to stay under SQLite's parameter limit). */
export async function loadBlobs(ids: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (!sqlAvailable() || ids.length === 0) return map;
  const db = await getDb();
  const unique = [...new Set(ids)];
  for (let i = 0; i < unique.length; i += 200) {
    const chunk = unique.slice(i, i + 200);
    const marks = chunk.map((_, j) => "$" + (j + 1)).join(",");
    const rows = await db.select<{ id: string; uri: string }[]>(`SELECT id, uri FROM assets WHERE id IN (${marks})`, chunk);
    for (const r of rows) map.set(r.id, r.uri);
  }
  return map;
}
