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

/** Thrown when a write would replace an encounter that could not be read. */
export class CorruptEncounterError extends Error {
  constructor(public readonly id: string) {
    super("Refusing to save over an encounter whose stored data could not be read.");
    this.name = "CorruptEncounterError";
  }
}

/** The same three corruption shapes as scenes and sheets. The `name` column
 *  survives a damaged blob, so a wiped encounter looked like a freshly created one
 *  — and the 400ms autosave then destroyed the initiative order, every combatant's
 *  HP and conditions, and the round counter, mid-fight. */
export function parseEncounterData(raw: string | null): {
  data: VttEncounterData;
  corrupt: boolean;
  raw?: string;
  error?: string;
} {
  if (raw === null || raw === undefined) return { data: defaultEncounterData(), corrupt: false };
  if (raw === "") {
    return {
      data: defaultEncounterData(),
      corrupt: true,
      raw,
      error: "the stored encounter was empty (an interrupted write)",
    };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    return { data: defaultEncounterData(), corrupt: true, raw, error: e instanceof Error ? e.message : String(e) };
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return {
      data: defaultEncounterData(),
      corrupt: true,
      raw,
      error: `the stored encounter was ${Array.isArray(parsed) ? "an array" : typeof parsed}, not an encounter`,
    };
  }
  return { data: { ...defaultEncounterData(), ...(parsed as VttEncounterData) }, corrupt: false };
}

function parse(r: Row): VttEncounter {
  const p = parseEncounterData(r.data);
  return {
    id: r.id,
    campaignId: r.campaign_id || "",
    name: r.name,
    sceneId: r.scene_id,
    data: p.data,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    ...(p.corrupt ? { corrupt: true as const, rawData: p.raw, corruptError: p.error } : {}),
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
  if (enc.corrupt) throw new CorruptEncounterError(enc.id);
  const existing = await db.select<{ data: string | null }[]>("SELECT data FROM encounters WHERE id = $1", [enc.id]);
  if (existing.length > 0 && parseEncounterData(existing[0].data).corrupt) throw new CorruptEncounterError(enc.id);
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
