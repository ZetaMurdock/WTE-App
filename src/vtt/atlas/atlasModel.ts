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

/** Ambient particle weather a zone can carry. Drawn statelessly each frame. */
export const ZONE_FX = ["embers", "motes", "snow", "fog"] as const;
export type ZoneFx = (typeof ZONE_FX)[number];

/** The world's shape. A circular world is a disc — the map visibly ENDS at the
 *  rim instead of fading into more rectangle. */
export const MAP_SHAPES = ["rect", "circle"] as const;
export type MapShape = (typeof MAP_SHAPES)[number];

/** The world clock. `hour` is 0–24; `auto` advances it at `speed` game-hours
 *  per real minute on the Curator's Atlas (persisted only occasionally). */
export interface AtlasClock {
  hour: number;
  auto: boolean;
  speed: number;
}

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
  /** Custom marker art (data URL; GIFs stay animated). Drawn instead of the dot. */
  sprite?: string;
}

export interface AtlasZone {
  id: string;
  name?: string;
  state: ZoneState;
  /** Closed polygon; the last vertex connects back to the first. */
  polygon: AtlasPoint[];
  /** Ambient particles drawn inside the zone. */
  fx?: ZoneFx;
  /** Custom art (data URL; GIFs stay animated) clipped to the zone's shape. */
  sprite?: string;
}

export type AtlasUnits = "imperial" | "metric" | "both";

export interface AtlasDoc {
  /** Bumped when the shape changes; parse refuses newer documents. */
  version: 1;
  name: string;
  /** The map image, as a data URL (re-encoded on upload, same as scene art). */
  image?: string;
  /** Real-world width of the image, in miles. Height derives from the image's
   *  aspect ratio; keeping one authoritative dimension avoids the two drifting.
   *  A circular world is a disc of diameter widthMi, so heightMi === widthMi. */
  widthMi: number;
  heightMi: number;
  units: AtlasUnits;
  shape: MapShape;
  clock: AtlasClock;
  nodes: AtlasNode[];
  zones: AtlasZone[];
}

export const ATLAS_VERSION = 1;

/** The filtered Atlas must fit the chunked transport with room to spare; past
 *  this the host keeps the map to itself and says so, instead of the transport
 *  silently dropping the message. */
export const MAX_ATLAS_WIRE_CHARS = 20 * 1024 * 1024;

export function emptyAtlas(name = "Atlas"): AtlasDoc {
  return {
    version: ATLAS_VERSION,
    name,
    widthMi: 500,
    heightMi: 300,
    units: "imperial",
    shape: "rect",
    clock: { hour: 12, auto: false, speed: 1 },
    nodes: [],
    zones: [],
  };
}

const num = (v: unknown, fallback: number): number => (typeof v === "number" && Number.isFinite(v) ? v : fallback);
const str = (v: unknown, fallback: string): string => (typeof v === "string" ? v : fallback);
/** Only image data URLs are allowed anywhere art is stored. */
const dataImage = (v: unknown): string | undefined =>
  typeof v === "string" && v.startsWith("data:image/") ? v : undefined;

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
  const shape: MapShape = o.shape === "circle" ? "circle" : "rect";
  const rawClock = (o.clock ?? {}) as Record<string, unknown>;
  const doc: AtlasDoc = {
    version: ATLAS_VERSION,
    name: str(o.name, "Atlas"),
    image: dataImage(o.image),
    widthMi,
    // A disc has one diameter; rectangles keep their aspect.
    heightMi: shape === "circle" ? widthMi : Math.max(1, num(o.heightMi, widthMi * 0.6)),
    units: o.units === "metric" || o.units === "both" ? o.units : "imperial",
    shape,
    clock: {
      hour: Math.min(24, Math.max(0, num(rawClock.hour, 12))),
      auto: rawClock.auto === true,
      speed: Math.min(120, Math.max(0.1, num(rawClock.speed, 1))),
    },
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
        sprite: dataImage(r.sprite),
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
        fx: ZONE_FX.includes(r.fx as ZoneFx) ? (r.fx as ZoneFx) : undefined,
        sprite: dataImage(r.sprite),
      });
    }
  }

  return doc;
}

/** What a given viewer is allowed to receive AT ALL.
 *
 *  Filtered before anything reaches a player's renderer — a curator-only node
 *  must not exist in their document, not merely be skipped while drawing.
 *  Null-locked regions REJECT observation, so a player's copy of one is bare
 *  geometry: no name, no weather, no art — and no nodes inside it either,
 *  because a marker on the void would betray what the void holds. */
export function atlasForRole(doc: AtlasDoc, role: "player" | "curator"): AtlasDoc {
  if (role === "curator") return doc;
  const voids = doc.zones.filter((z) => z.state === "null-locked");
  const inVoid = (p: AtlasPoint) => voids.some((z) => polygonContains(p, z.polygon));
  return {
    ...doc,
    nodes: doc.nodes.filter((n) => n.visibility !== "curator" && !inVoid(n)),
    zones: doc.zones
      .filter((z) => z.state !== "curator-only")
      .map((z) => (z.state === "null-locked" ? { id: z.id, state: z.state, polygon: z.polygon } : z)),
  };
}

// Ray-cast point-in-polygon, duplicated from atlasMath to keep the model free
// of runtime imports (atlasMath type-imports from here; a runtime cycle is a
// bootstrap hazard waiting for a bundler change).
function polygonContains(p: AtlasPoint, poly: AtlasPoint[]): boolean {
  if (poly.length < 3) return false;
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}
