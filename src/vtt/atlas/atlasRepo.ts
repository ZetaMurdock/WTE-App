// Atlas persistence: one document per campaign, in campaign_kv scope "atlas".
//
// The scoped store was added in schema v5 exactly so a new campaign-scoped blob
// like this needs no migration — and because it is campaign_kv, the Atlas
// automatically travels with campaign export/import and the pre-upgrade backup,
// with no new code in either.
import { kvGet, kvSet } from "../../lib/campaignStore";
import { emptyAtlas, parseAtlas, type AtlasDoc } from "./atlasModel";

const KEY = "map";

/**
 * Load a campaign's Atlas.
 *
 * Absent and unreadable are different answers: absent means a fresh empty
 * Atlas; a document from a NEWER build refuses to load rather than silently
 * dropping whatever the newer shape carried, and the caller shows that.
 */
export async function loadAtlas(campaignId: string): Promise<{ doc: AtlasDoc; refused: boolean }> {
  try {
    const raw = await kvGet<unknown>(campaignId, "atlas", KEY);
    if (raw === null || raw === undefined) return { doc: emptyAtlas(), refused: false };
    const doc = parseAtlas(raw);
    if (!doc) return { doc: emptyAtlas(), refused: true };
    return { doc, refused: false };
  } catch {
    // A transient read failure must not present as "you have no Atlas" with an
    // editable empty document that would then SAVE over the real one. Refused
    // documents are read-only in the UI.
    return { doc: emptyAtlas(), refused: true };
  }
}

export async function saveAtlas(campaignId: string, doc: AtlasDoc): Promise<void> {
  await kvSet(campaignId, "atlas", KEY, doc);
}
