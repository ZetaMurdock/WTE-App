// Asset library persistence — the v1 `assets` table (id/campaign_id/kind/name/
// uri/created_at), campaign-scoped. Assets are image URIs (http(s):, data:, or a
// Tauri asset: url) reused across scenes as map backgrounds / token art.
import { getDb, sqlAvailable } from "../../lib/db";
import { newId } from "../types/scene";

/** "blob" rows are internal scene-image storage (see sceneBlobs.ts) — content-
 *  addressed, hidden from the asset browser. "prop" = PNG map decorations
 *  placed on the scene (the 3D "model" kind is retired with the vaulted 3D view;
 *  legacy model rows are dropped from lists). */
export type AssetKind = "background" | "token" | "prop" | "sound" | "blob";

export interface VttAsset {
  id: string;
  campaignId: string | null;
  kind: AssetKind;
  name: string;
  uri: string;
  createdAt: number;
}

interface Row {
  id: string;
  campaign_id: string | null;
  kind: string;
  name: string;
  uri: string;
  created_at: number;
}

function parse(r: Row): VttAsset {
  return {
    id: r.id,
    campaignId: r.campaign_id,
    kind: (r.kind === "token" ? "token" : r.kind === "prop" ? "prop" : r.kind === "sound" ? "sound" : r.kind === "blob" ? "blob" : "background") as AssetKind,
    name: r.name,
    uri: r.uri,
    createdAt: r.created_at,
  };
}

export async function listAssets(campaignId: string): Promise<VttAsset[]> {
  if (!sqlAvailable()) return [];
  const db = await getDb();
  const rows = await db.select<Row[]>("SELECT * FROM assets WHERE campaign_id = $1 ORDER BY created_at DESC", [campaignId]);
  // Legacy GLB rows from the vaulted 3D view have nothing to render — drop them.
  return rows.filter((r) => r.kind !== "model").map(parse);
}

export async function addAsset(campaignId: string, kind: AssetKind, name: string, uri: string): Promise<VttAsset> {
  const asset: VttAsset = { id: newId("as"), campaignId, kind, name: name.trim() || "Asset", uri: uri.trim(), createdAt: Date.now() };
  if (sqlAvailable()) {
    const db = await getDb();
    await db.execute("INSERT INTO assets (id, campaign_id, kind, name, uri, created_at) VALUES ($1,$2,$3,$4,$5,$6)", [
      asset.id,
      asset.campaignId,
      asset.kind,
      asset.name,
      asset.uri,
      asset.createdAt,
    ]);
  }
  return asset;
}

export async function deleteAsset(id: string): Promise<void> {
  if (!sqlAvailable()) return;
  const db = await getDb();
  await db.execute("DELETE FROM assets WHERE id = $1", [id]);
}
