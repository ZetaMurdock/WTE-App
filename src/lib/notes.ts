// Note persistence — the v1 notes table extended by migration v4. Desktop-only;
// callers keep state locally and persist best-effort (no-ops outside Tauri).
import { getDb, sqlAvailable } from "./db";
import type { CodexNote } from "../models/note";

interface Row {
  id: string;
  campaign_id: string | null;
  title: string | null;
  body: string | null;
  updated_at: number;
  attached_to: string | null;
  visibility: string | null;
  tags: string | null;
  quote: string | null;
}

function parse(r: Row): CodexNote {
  let tags: string[] = [];
  try {
    tags = r.tags ? (JSON.parse(r.tags) as string[]) : [];
  } catch {
    /* ignore */
  }
  return {
    id: r.id,
    title: r.title || "",
    body: r.body || "",
    attachedTo: r.attached_to,
    quote: r.quote,
    visibility: r.visibility === "gm" ? "gm" : "player",
    tags,
    campaignId: r.campaign_id,
    updatedAt: r.updated_at,
  };
}

export async function listNotes(): Promise<CodexNote[]> {
  if (!sqlAvailable()) return [];
  const db = await getDb();
  const rows = await db.select<Row[]>("SELECT * FROM notes ORDER BY updated_at DESC");
  return rows.map(parse);
}

export async function saveNote(n: CodexNote): Promise<void> {
  if (!sqlAvailable()) return;
  const db = await getDb();
  await db.execute(
    "INSERT OR REPLACE INTO notes (id, campaign_id, title, body, updated_at, attached_to, visibility, tags, quote) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)",
    [n.id, n.campaignId ?? null, n.title, n.body, Date.now(), n.attachedTo, n.visibility, JSON.stringify(n.tags), n.quote]
  );
}

export async function deleteNote(id: string): Promise<void> {
  if (!sqlAvailable()) return;
  const db = await getDb();
  await db.execute("DELETE FROM notes WHERE id = $1", [id]);
}
