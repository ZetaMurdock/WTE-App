// Sequence persistence — JSON docs in the codex_sequences table (migration v3).
// Desktop-only; returns empty outside Tauri.
import { getDb, sqlAvailable } from "./db";
import type { Sequence } from "../models/sequence";

interface Row {
  id: string;
  campaign_id: string | null;
  data: string;
  updated_at: number;
}

function parse(r: Row): Sequence | null {
  try {
    const s = JSON.parse(r.data) as Sequence;
    s.id = r.id;
    s.campaignId = r.campaign_id;
    s.updatedAt = r.updated_at;
    return s;
  } catch {
    return null;
  }
}

export async function listSequences(): Promise<Sequence[]> {
  if (!sqlAvailable()) return [];
  const db = await getDb();
  const rows = await db.select<Row[]>("SELECT * FROM codex_sequences ORDER BY updated_at DESC");
  return rows.map(parse).filter((s): s is Sequence => !!s);
}

export async function getSequence(id: string): Promise<Sequence | null> {
  if (!sqlAvailable()) return null;
  const db = await getDb();
  const rows = await db.select<Row[]>("SELECT * FROM codex_sequences WHERE id = $1", [id]);
  return rows.length ? parse(rows[0]) : null;
}

export async function saveSequence(seq: Sequence): Promise<void> {
  if (!sqlAvailable()) return;
  const db = await getDb();
  const now = Date.now();
  await db.execute(
    "INSERT OR REPLACE INTO codex_sequences (id, campaign_id, data, updated_at) VALUES ($1,$2,$3,$4)",
    [seq.id, seq.campaignId ?? null, JSON.stringify({ ...seq, updatedAt: now }), now]
  );
}

export async function deleteSequence(id: string): Promise<void> {
  if (!sqlAvailable()) return;
  const db = await getDb();
  await db.execute("DELETE FROM codex_sequences WHERE id = $1", [id]);
}
