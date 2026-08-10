// The Curator Atlas data model.
//
// The Atlas is a WORLD map over the VTT, distinct from the tactical battle map:
// the battle map says where you physically are, the Atlas says where you are in
// the world. See docs/curator-atlas.md for the full design.
//
// Everything here is a plain serializable document stored per-campaign in
// campaign_kv (scope "atlas") — the general scoped store that exists precisely
// so a new campaign-scoped blob needs no schema migration. Positions are in
// MILES in map space: the uploaded map image spans [0, widthMi] × [0, heightMi],
// and every node and zone vertex lives in that space, so real-world distance is
// arithmetic rather than a calibration afterthought.

/** Who may see a zone, and how much of it. Ordered from open to closed. */
export const ZONE_STATES = ["visible", "surveyed", "unconfirmed", "null-locked", "curator-only"] as const;
export type ZoneState = (typeof ZONE_STATES)[number];

export const NODE_KINDS = [
  "settlement",
  "landmark",
  "character",
  "objective",
  "hazard",
  "transport",
  "portal",
  "anomaly",
  "faction",
  "unit",
  "other",
] as const;
export type NodeKind = (typeof NODE_KINDS)[number];

export interface AtlasPoint {
  /** Miles from the map's west edge. */
  x: number;
  /** Miles from the map's north edge. */
  y: number;
}

export interface AtlasNode extends AtlasPoint {
  id: string;
  name: string;
  kind: NodeKind;
  /** Markdown-ish free text shown on the node card. */
  note?: string;
  /** Status lines rendered in the card's technical readout. */
  status?: string[];
  /** "player" shows to everyone; "curator" exists only on the Curator's Atlas. */
  visibility: "player" | "curator";
  /** Zoom gates, in px-per-mile. Outside [minZoom, maxZoom] the node hides, so
   *  a planetary view shows the Space Elevator and the Tree while street-level
   *  detail waits for street-level zoom. Either bound may be absent. */
  minZoom?: number;
  maxZoom?: number;
}

export interface AtlasZone {
  id: string;
  name?: string;
  state: ZoneState;
  /** Closed polygon; the last vertex connects back to the first. */
  polygon: AtlasPoint[];
}

export type AtlasUnits = "imperial" | "metric" | "both";

export interface AtlasDoc {
  /** Bumped when the shape changes; parse refuses newer documents. */
  version: 1;
  name: string;
  /** The map image, as a data URL (re-encoded on upload, same as scene art). */
  image?: string;
  /** Real-world width of the image, in miles. Height derives from the image's
   *  aspect ratio; keeping one authoritative dimension avoids the two drifting. */
  widthMi: number;
  heightMi: number;
  units: AtlasUnits;
  nodes: AtlasNode[];
  zones: AtlasZone[];
}

export const ATLAS_VERSION = 1;

export function emptyAtlas(name = "Atlas"): AtlasDoc {
  return { version: ATLAS_VERSION, name, widthMi: 500, heightMi: 300, units: "imperial", nodes: [], zones: [] };
}

const num = (v: unknown, fallback: number): number => (typeof v === "number" && Number.isFinite(v) ? v : fallback);
const str = (v: unknown, fallback: string): string => (typeof v === "string" ? v : fallback);

function parsePoint(v: unknown): AtlasPoint | null {
  if (!v || typeof v !== "object") return null;
  const p = v as Record<string, unknown>;
  if (typeof p.x !== "number" || typeof p.y !== "number") return null;
  if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return null;
  return { x: p.x, y: p.y };
}

/**
 * Parse a stored (or imported) Atlas document.
 *
 * A stored blob is untrusted input like any other: a malformed node costs that
 * node, never the map. Returns null only when the document is not an Atlas at
 * all or comes from a newer build — refusing beats silently dropping whatever
 * the newer shape carried.
 */
export function parseAtlas(raw: unknown): AtlasDoc | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.version !== "number" || o.version > ATLAS_VERSION) return null;

  const widthMi = Math.max(1, num(o.widthMi, 500));
  const doc: AtlasDoc = {
    version: ATLAS_VERSION,
    name: str(o.name, "Atlas"),
    image: typeof o.image === "string" && o.image.startsWith("data:image/") ? o.image : undefined,
    widthMi,
    heightMi: Math.max(1, num(o.heightMi, widthMi * 0.6)),
    units: o.units === "metric" || o.units === "both" ? o.units : "imperial",
    nodes: [],
    zones: [],
  };

  if (Array.isArray(o.nodes)) {
    for (const n of o.nodes) {
      if (!n || typeof n !== "object") continue;
      const r = n as Record<string, unknown>;
      const pt = parsePoint(r);
      if (!pt || typeof r.id !== "string" || !r.id) continue;
      doc.nodes.push({
        ...pt,
        id: r.id,
        name: str(r.name, "Unnamed"),
        kind: NODE_KINDS.includes(r.kind as NodeKind) ? (r.kind as NodeKind) : "other",
        note: typeof r.note === "string" ? r.note : undefined,
        status: Array.isArray(r.status) ? r.status.filter((s): s is string => typeof s === "string") : undefined,
        visibility: r.visibility === "curator" ? "curator" : "player",
        minZoom: typeof r.minZoom === "number" && Number.isFinite(r.minZoom) ? r.minZoom : undefined,
        maxZoom: typeof r.maxZoom === "number" && Number.isFinite(r.maxZoom) ? r.maxZoom : undefined,
      });
    }
  }

  if (Array.isArray(o.zones)) {
    for (const z of o.zones) {
      if (!z || typeof z !== "object") continue;
      const r = z as Record<string, unknown>;
      if (typeof r.id !== "string" || !r.id) continue;
      const polygon = Array.isArray(r.polygon)
        ? r.polygon.map(parsePoint).filter((p): p is AtlasPoint => p !== null)
        : [];
      // Fewer than three vertices is not an area.
      if (polygon.length < 3) continue;
      doc.zones.push({
        id: r.id,
        name: typeof r.name === "string" ? r.name : undefined,
        state: ZONE_STATES.includes(r.state as ZoneState) ? (r.state as ZoneState) : "null-locked",
        polygon,
      });
    }
  }

  return doc;
}

/** What a given viewer is allowed to receive AT ALL.
 *
 *  Filtered before anything reaches a player's renderer — a curator-only node
 *  must not exist in their document, not merely be skipped while drawing. */
export function atlasForRole(doc: AtlasDoc, role: "player" | "curator"): AtlasDoc {
  if (role === "curator") return doc;
  return {
    ...doc,
    nodes: doc.nodes.filter((n) => n.visibility !== "curator"),
    zones: doc.zones.filter((z) => z.state !== "curator-only"),
  };
}
