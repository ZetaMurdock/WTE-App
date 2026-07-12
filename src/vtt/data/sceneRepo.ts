// Scene persistence — typed VttScene docs in the v1 `scenes` table (JSON data column).
// Desktop-only; callers keep state locally and persist best-effort outside Tauri.
import { getDb, sqlAvailable } from "../../lib/db";
import { defaultSceneData, type VttScene, type VttSceneData } from "../types/scene";

interface Row {
  id: string;
  campaign_id: string | null;
  name: string;
  active: number;
  data: string | null;
  created_at: number;
  updated_at: number;
}

function parse(r: Row): VttScene {
  let data: VttSceneData = defaultSceneData();
  try {
    if (r.data) data = { ...defaultSceneData(), ...(JSON.parse(r.data) as VttSceneData) };
  } catch {
    /* fall back to defaults */
  }
  return {
    id: r.id,
    campaignId: r.campaign_id || "",
    name: r.name,
    active: !!r.active,
    data,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export async function listScenes(campaignId: string): Promise<VttScene[]> {
  if (!sqlAvailable()) return [];
  const db = await getDb();
  const rows = await db.select<Row[]>("SELECT * FROM scenes WHERE campaign_id = $1 ORDER BY updated_at DESC", [campaignId]);
  return rows.map(parse);
}

export async function getScene(sceneId: string): Promise<VttScene | null> {
  if (!sqlAvailable()) return null;
  const db = await getDb();
  const rows = await db.select<Row[]>("SELECT * FROM scenes WHERE id = $1", [sceneId]);
  return rows.length ? parse(rows[0]) : null;
}

export async function saveScene(scene: VttScene): Promise<void> {
  if (!sqlAvailable()) return;
  const db = await getDb();
  await db.execute(
    "INSERT OR REPLACE INTO scenes (id, campaign_id, name, active, data, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7)",
    [scene.id, scene.campaignId, scene.name, scene.active ? 1 : 0, JSON.stringify(scene.data), scene.createdAt, Date.now()]
  );
}

export async function setActiveScene(campaignId: string, sceneId: string): Promise<void> {
  if (!sqlAvailable()) return;
  const db = await getDb();
  await db.execute("UPDATE scenes SET active = 0 WHERE campaign_id = $1", [campaignId]);
  await db.execute("UPDATE scenes SET active = 1 WHERE id = $1", [sceneId]);
}

export async function deleteScene(sceneId: string): Promise<void> {
  if (!sqlAvailable()) return;
  const db = await getDb();
  await db.execute("DELETE FROM scenes WHERE id = $1", [sceneId]);
}
