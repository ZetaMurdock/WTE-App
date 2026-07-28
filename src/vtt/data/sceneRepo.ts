// Scene persistence — typed VttScene docs in the v1 `scenes` table (JSON data column).
// Desktop-only; callers keep state locally and persist best-effort outside Tauri.
// Large inline images are DE-INLINED to blob rows on save and re-inlined on load
// (see sceneBlobs.ts) so the 500ms autosave stops re-serializing megabytes.
import { getDb, sqlAvailable } from "../../lib/db";
import { pushToast } from "../../lib/appToast";
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

/** Thrown when a write would replace a scene whose stored data cannot be read. */
export class CorruptSceneError extends Error {
  constructor(public readonly id: string) {
    super("Refusing to save over a scene whose stored data could not be read.");
    this.name = "CorruptSceneError";
  }
}

/** Read a stored scene blob, distinguishing "no data yet" from "damaged".
 *
 *  The old version fell back to defaultSceneData() on any failure. Because the
 *  scene NAME is its own column and survives, a damaged row rendered as a blank
 *  grid with the right name — reading exactly as "my map was reset" — and the very
 *  first pan or token nudge scheduled the 500ms autosave that overwrote the
 *  original. Everything in VttSceneData went with it: background, every token and
 *  its position, walls, lights, zones, fog reveals, emitters, FX, drawings, camera,
 *  grid.
 *
 *  The three shapes sheetCodec learned to catch apply here too: an empty string is
 *  an interrupted write, and valid JSON that is not an object is not a scene. */
export function parseSceneData(raw: string | null): {
  data: VttSceneData;
  corrupt: boolean;
  raw?: string;
  error?: string;
} {
  if (raw === null || raw === undefined) return { data: defaultSceneData(), corrupt: false };
  if (raw === "") {
    return { data: defaultSceneData(), corrupt: true, raw, error: "the stored scene was empty (an interrupted write)" };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    return { data: defaultSceneData(), corrupt: true, raw, error: e instanceof Error ? e.message : String(e) };
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return {
      data: defaultSceneData(),
      corrupt: true,
      raw,
      error: `the stored scene was ${Array.isArray(parsed) ? "an array" : typeof parsed}, not a scene`,
    };
  }
  return { data: { ...defaultSceneData(), ...(parsed as VttSceneData) }, corrupt: false };
}

function parse(r: Row): VttScene {
  const p = parseSceneData(r.data);
  return {
    id: r.id,
    campaignId: r.campaign_id || "",
    name: r.name,
    active: !!r.active,
    data: p.data,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    ...(p.corrupt ? { corrupt: true as const, rawData: p.raw, corruptError: p.error } : {}),
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
  // STABLE creation order. This used to be updated_at DESC — but every autosave
  // and switch bumps updated_at, so the scene rail RESHUFFLED on every save (the
  // scene you just left jumped to the top) and clicks/wheel-steps landed on a
  // list that kept reordering underneath the pointer.
  const rows = await db.select<Row[]>("SELECT * FROM scenes WHERE campaign_id = $1 ORDER BY created_at ASC", [campaignId]);
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

  // Never write over a row we could not read. Same reasoning as characters: the
  // in-memory scene here may be the blank placeholder the reader substituted.
  if (scene.corrupt) throw new CorruptSceneError(scene.id);
  const existing = await db.select<{ data: string | null }[]>("SELECT data FROM scenes WHERE id = $1", [scene.id]);
  if (existing.length > 0 && parseSceneData(existing[0].data).corrupt) throw new CorruptSceneError(scene.id);

  // De-inline big images: deflate works on a copy (the LIVE scene keeps its full
  // data URLs for rendering + netplay snapshots), blobs are content-addressed.
  const blobs = new Map<string, string>();
  const slim = deflateSceneData(scene.data, (id, uri) => blobs.set(id, uri));

  // The blob write MUST be confirmed before the row that points at it is
  // committed. This used to be `.catch(() => {})` followed immediately by the
  // INSERT, so a single transient failure — a locked DB from a second instance, a
  // full disk, an antivirus handle — committed a row full of `wte-blob:<id>`
  // pointers to asset rows that were never written. On the next load loadBlobs
  // found nothing, inflateSceneData left the bare ref as the src, and the map and
  // every token's art were gone for good. And because saveScene still RESOLVED,
  // reportSaveFailure told the user it had saved.
  //
  // On failure we fall back to storing the scene with its images still INLINE.
  // That row is much larger, but the bytes survive, which is the only thing that
  // cannot be undone later.
  let payload = slim;
  let inlineFallback = false;
  if (blobs.size > 0) {
    try {
      await saveBlobs(scene.campaignId || null, blobs);
    } catch {
      payload = scene.data;
      inlineFallback = true;
    }
  }

  await db.execute(
    "INSERT OR REPLACE INTO scenes (id, campaign_id, name, active, data, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7)",
    [scene.id, scene.campaignId, scene.name, scene.active ? 1 : 0, JSON.stringify(payload), scene.createdAt, Date.now()]
  );

  // Reported AFTER the row lands, so the user knows the save succeeded but the
  // art could not be de-inlined — a real condition worth surfacing, not an error.
  if (inlineFallback) {
    pushToast(
      "Couldn't store this scene's images separately, so they were saved inside the scene instead. Nothing was lost, but the scene file is larger than usual.",
      "info",
      12000
    );
  }
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
