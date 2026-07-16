// Scene persistence — typed VttScene docs in the v1 `scenes` table (JSON data column).
// Desktop-only; callers keep state locally and persist best-effort outside Tauri.
// Large inline images are DE-INLINED to blob rows on save and re-inlined on load
// (see sceneBlobs.ts) so the 500ms autosave stops re-serializing megabytes.
import { getDb, sqlAvailable } from "../../lib/db";
import { defaultSceneData, type VttScene, type VttSceneData } from "../types/scene";
import { collectBlobRefs, deflateSceneData, inflateSceneData, loadBlobs, saveBlobs } from "./sceneBlobs";

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

/** Re-inline any blob refs across the given scenes (one batched blob fetch). */
async function inflateAll(scenes: VttScene[]): Promise<VttScene[]> {
  const ids = scenes.flatMap((s) => collectBlobRefs(s.data));
  if (ids.length === 0) return scenes;
  const blobs = await loadBlobs(ids).catch(() => new Map<string, string>());
  for (const s of scenes) inflateSceneData(s.data, (id) => blobs.get(id));
  return scenes;
}

export async function listScenes(campaignId: string): Promise<VttScene[]> {
  if (!sqlAvailable()) return [];
  const db = await getDb();
  const rows = await db.select<Row[]>("SELECT * FROM scenes WHERE campaign_id = $1 ORDER BY updated_at DESC", [campaignId]);
  return inflateAll(rows.map(parse));
}

export async function getScene(sceneId: string): Promise<VttScene | null> {
  if (!sqlAvailable()) return null;
  const db = await getDb();
  const rows = await db.select<Row[]>("SELECT * FROM scenes WHERE id = $1", [sceneId]);
  if (!rows.length) return null;
  const [scene] = await inflateAll([parse(rows[0])]);
  return scene;
}

export async function saveScene(scene: VttScene): Promise<void> {
  if (!sqlAvailable()) return;
  const db = await getDb();
  // De-inline big images: deflate works on a copy (the LIVE scene keeps its full
  // data URLs for rendering + netplay snapshots), blobs are content-addressed.
  const blobs = new Map<string, string>();
  const slim = deflateSceneData(scene.data, (id, uri) => blobs.set(id, uri));
  await saveBlobs(scene.campaignId || null, blobs).catch(() => {});
  await db.execute(
    "INSERT OR REPLACE INTO scenes (id, campaign_id, name, active, data, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7)",
    [scene.id, scene.campaignId, scene.name, scene.active ? 1 : 0, JSON.stringify(slim), scene.createdAt, Date.now()]
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
