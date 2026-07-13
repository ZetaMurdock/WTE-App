// Encounter persistence — typed VttEncounter docs in the v1 `encounters` table
// (JSON data column). Desktop-only; no-ops outside Tauri.
import { getDb, sqlAvailable } from "../../lib/db";
import { defaultEncounterData, type VttEncounter, type VttEncounterData } from "../types/encounter";

interface Row {
  id: string;
  campaign_id: string | null;
  name: string;
  scene_id: string | null;
  data: string | null;
  created_at: number;
  updated_at: number;
}

function parse(r: Row): VttEncounter {
  let data: VttEncounterData = defaultEncounterData();
  try {
    if (r.data) data = { ...defaultEncounterData(), ...(JSON.parse(r.data) as VttEncounterData) };
  } catch {
    /* defaults */
  }
  return {
    id: r.id,
    campaignId: r.campaign_id || "",
    name: r.name,
    sceneId: r.scene_id,
    data,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export async function listEncounters(campaignId: string): Promise<VttEncounter[]> {
  if (!sqlAvailable()) return [];
  const db = await getDb();
  const rows = await db.select<Row[]>("SELECT * FROM encounters WHERE campaign_id = $1 ORDER BY updated_at DESC", [campaignId]);
  return rows.map(parse);
}

export async function getEncounter(id: string): Promise<VttEncounter | null> {
  if (!sqlAvailable()) return null;
  const db = await getDb();
  const rows = await db.select<Row[]>("SELECT * FROM encounters WHERE id = $1", [id]);
  return rows.length ? parse(rows[0]) : null;
}

export async function saveEncounter(enc: VttEncounter): Promise<void> {
  if (!sqlAvailable()) return;
  const db = await getDb();
  await db.execute(
    "INSERT OR REPLACE INTO encounters (id, campaign_id, name, scene_id, data, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7)",
    [enc.id, enc.campaignId, enc.name, enc.sceneId, JSON.stringify(enc.data), enc.createdAt, Date.now()]
  );
}

export async function deleteEncounter(id: string): Promise<void> {
  if (!sqlAvailable()) return;
  const db = await getDb();
  await db.execute("DELETE FROM encounters WHERE id = $1", [id]);
}
