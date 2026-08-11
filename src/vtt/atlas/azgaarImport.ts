// Azgaar Fantasy Map Generator import.
//
// The Curator designs a whole world in Azgaar, exports the full JSON, and the
// Atlas assimilates it: BURGS (settlements) become nodes, MARKERS become
// landmarks, and each STATE's territory becomes a zone — traced from the cell
// mesh by walking the edges where a state's cells meet someone else's. The
// Curator is left with exactly the work that is theirs: deciding what each
// territory IS on the instrument — visible, surveyed, null-locked, curator's.
//
// Azgaar's export format has drifted across versions (cells as an array of
// objects vs an object of parallel arrays), so everything here reads through
// normalizing accessors and treats the file as untrusted input: a malformed
// entry costs that entry, never the import. Output coordinates are NORMALIZED
// (0..1 across the map) — the caller scales them into miles, because only it
// knows whether the document adopts Azgaar's real-world size.

export interface AzgaarPoint {
  u: number;
  v: number;
}

export interface AzgaarNode extends AzgaarPoint {
  name: string;
  kind: "settlement" | "landmark";
  capital: boolean;
  /** Importance tier, for zoom-gating: capitals read from orbit, major towns
   *  from a regional view, the rest only up close. */
  tier: "capital" | "major" | "minor";
}

export interface AzgaarZone {
  name: string;
  polygon: AzgaarPoint[];
}

export interface AzgaarImportResult {
  mapName?: string;
  /** Azgaar's real-world size, when the file carries a distance scale. */
  suggestedWidthMi?: number;
  suggestedHeightMi?: number;
  nodes: AzgaarNode[];
  zones: AzgaarZone[];
  /** The map's rendered SVG (native .map saves only) — the caller can
   *  rasterize it into the Atlas's base image. */
  svgText?: string;
  /** Honest accounting for the summary toast. */
  dropped: string[];
}

/** How many settlements count as "major" (regional-zoom reveal); capitals are
 *  always their own tier above this. */
const MAJOR_BURGS = 25;

const MAX_BURGS = 150;
const MAX_MARKERS = 50;
const MAX_RINGS_PER_STATE = 2;
const MIN_RING_VERTICES = 4; // a one-cell statelet is still a territory

type Rec = Record<string, unknown>;
const rec = (v: unknown): Rec | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Rec) : null);
const arr = (v: unknown): unknown[] | null => (Array.isArray(v) ? v : null);
const fin = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

// ── normalized views over the two cell/vertex shapes ─────────────────────────

interface CellsView {
  count: number;
  ring(i: number): number[] | null;
  state(i: number): number;
}

function cellsOf(pack: Rec): CellsView | null {
  const cells = pack.cells;
  const asArr = arr(cells);
  if (asArr) {
    // array of per-cell objects: { v: number[], state: number }
    return {
      count: asArr.length,
      ring: (i) => {
        const c = rec(asArr[i]);
        const v = c && arr(c.v);
        return v ? v.filter((x): x is number => fin(x) !== null) : null;
      },
      state: (i) => {
        const c = rec(asArr[i]);
        return (c && fin(c.state)) ?? 0;
      },
    };
  }
  const o = rec(cells);
  if (o) {
    // object of parallel arrays: { v: number[][], state: number[] }
    const v = arr(o.v);
    const state = arr(o.state);
    if (!v) return null;
    return {
      count: v.length,
      ring: (i) => {
        const r = arr(v[i]);
        return r ? r.filter((x): x is number => fin(x) !== null) : null;
      },
      state: (i) => (state && fin(state[i])) ?? 0,
    };
  }
  return null;
}

interface VerticesView {
  point(i: number): [number, number] | null;
  cells(i: number): number[];
}

function verticesOf(pack: Rec): VerticesView | null {
  const vertices = pack.vertices;
  const asArr = arr(vertices);
  if (asArr) {
    return {
      point: (i) => {
        const v = rec(asArr[i]);
        const p = v && arr(v.p);
        const x = p && fin(p[0]);
        const y = p && fin(p[1]);
        return x !== null && y !== null ? [x, y] : null;
      },
      cells: (i) => {
        const v = rec(asArr[i]);
        const c = v && arr(v.c);
        return c ? c.filter((x): x is number => fin(x) !== null) : [];
      },
    };
  }
  const o = rec(vertices);
  if (o) {
    const p = arr(o.p);
    const c = arr(o.c);
    if (!p) return null;
    return {
      point: (i) => {
        const pt = arr(p[i]);
        const x = pt && fin(pt[0]);
        const y = pt && fin(pt[1]);
        return x !== null && y !== null ? [x, y] : null;
      },
      cells: (i) => {
        const cc = c && arr(c[i]);
        return cc ? cc.filter((x): x is number => fin(x) !== null) : [];
      },
    };
  }
  return null;
}

// ── border tracing ───────────────────────────────────────────────────────────

/** Shoelace area of a vertex-id ring, for picking a state's main landmass. */
function ringArea(ring: number[], vx: VerticesView): number {
  let a = 0;
  for (let i = 0; i < ring.length; i++) {
    const p = vx.point(ring[i]);
    const q = vx.point(ring[(i + 1) % ring.length]);
    if (!p || !q) return 0;
    a += p[0] * q[1] - q[0] * p[1];
  }
  return Math.abs(a / 2);
}

/**
 * The border of one state: every cell-ring edge whose far side belongs to a
 * different state (or to nothing — the sea), chained into closed loops.
 */
function traceState(stateId: number, cells: CellsView, vx: VerticesView): number[][] {
  // border edges as vertex pairs, deduplicated
  const edges = new Map<string, [number, number]>();
  for (let i = 0; i < cells.count; i++) {
    if (cells.state(i) !== stateId) continue;
    const ring = cells.ring(i);
    if (!ring || ring.length < 3) continue;
    for (let k = 0; k < ring.length; k++) {
      const a = ring[k];
      const b = ring[(k + 1) % ring.length];
      // the cell across edge (a,b) is adjacent to both vertices and isn't me
      const across = vx.cells(a).find((c) => c !== i && vx.cells(b).includes(c));
      if (across === undefined || cells.state(across) !== stateId) {
        const key = a < b ? `${a}|${b}` : `${b}|${a}`;
        if (!edges.has(key)) edges.set(key, [a, b]);
      }
    }
  }
  // chain edges into loops
  const adj = new Map<number, number[]>();
  for (const [a, b] of edges.values()) {
    (adj.get(a) ?? adj.set(a, []).get(a)!).push(b);
    (adj.get(b) ?? adj.set(b, []).get(b)!).push(a);
  }
  const usedEdge = new Set<string>();
  const loops: number[][] = [];
  for (const [start] of adj) {
    let cur = start;
    const loop: number[] = [];
    for (;;) {
      const next = (adj.get(cur) ?? []).find((n) => {
        const key = cur < n ? `${cur}|${n}` : `${n}|${cur}`;
        return edges.has(key) && !usedEdge.has(key);
      });
      if (next === undefined) break;
      const key = cur < next ? `${cur}|${next}` : `${next}|${cur}`;
      usedEdge.add(key);
      loop.push(next);
      cur = next;
      if (cur === start) break;
    }
    if (loop.length >= MIN_RING_VERTICES && cur === start) loops.push(loop);
  }
  return loops.sort((a, b) => ringArea(b, vx) - ringArea(a, vx));
}

// ── the import ───────────────────────────────────────────────────────────────

export interface AzgaarImportOpts {
  /** Pre-traced state territories (px coords), keyed by state id — used by the
   *  .map path, whose files carry no cell mesh but DO carry the rendered
   *  borders. When present, cell tracing is skipped entirely. */
  statePolygons?: Map<number, [number, number][][]>;
}

export function importAzgaar(raw: unknown, opts?: AzgaarImportOpts): AzgaarImportResult | null {
  const root = rec(raw);
  if (!root) return null;
  const pack = rec(root.pack);
  const info = rec(root.info);
  const settings = rec(root.settings);
  if (!pack) return null;

  const graphW = (info && fin(info.width)) ?? (settings && fin(settings.mapWidth)) ?? null;
  const graphH = (info && fin(info.height)) ?? (settings && fin(settings.mapHeight)) ?? null;
  if (!graphW || !graphH || graphW <= 0 || graphH <= 0) return null;
  const norm = (x: number, y: number): AzgaarPoint => ({ u: x / graphW, v: y / graphH });

  const dropped: string[] = [];
  const out: AzgaarImportResult = { nodes: [], zones: [], dropped };

  const mapName = (info && typeof info.mapName === "string" && info.mapName) || (settings && typeof settings.mapName === "string" && settings.mapName) || "";
  if (mapName) out.mapName = mapName;

  // real-world size, when the file says how big a pixel is
  const scaleRaw = settings ? settings.distanceScale : null;
  const scale = fin(scaleRaw) ?? (typeof scaleRaw === "string" ? fin(parseFloat(scaleRaw)) : null);
  const unit = settings && typeof settings.distanceUnit === "string" ? settings.distanceUnit.toLowerCase() : "mi";
  if (scale && scale > 0) {
    const toMi = unit.startsWith("km") ? 0.621371 : 1;
    out.suggestedWidthMi = +(graphW * scale * toMi).toFixed(1);
    out.suggestedHeightMi = +(graphH * scale * toMi).toFixed(1);
  }

  // ── burgs → settlement nodes ────────────────────────────────────────────────
  const burgs = arr(pack.burgs) ?? [];
  const live = burgs
    .map((b) => rec(b))
    .filter((b): b is Rec => !!b && typeof b.name === "string" && !!b.name && fin(b.x) !== null && fin(b.y) !== null && b.removed !== true);
  const byImportance = live.sort((a, b) => (fin(b.capital) ?? 0) - (fin(a.capital) ?? 0) || (fin(b.population) ?? 0) - (fin(a.population) ?? 0));
  if (byImportance.length > MAX_BURGS) dropped.push(`${byImportance.length - MAX_BURGS} smaller settlements past the ${MAX_BURGS} cap`);
  byImportance.slice(0, MAX_BURGS).forEach((b, rank) => {
    const capital = fin(b.capital) === 1 || b.capital === true;
    out.nodes.push({
      ...norm(fin(b.x)!, fin(b.y)!),
      name: String(b.name),
      kind: "settlement",
      capital,
      tier: capital ? "capital" : rank < MAJOR_BURGS ? "major" : "minor",
    });
  });

  // ── markers → landmark nodes (names live in the notes legend) ───────────────
  const notes = arr(root.notes) ?? [];
  const noteName = (id: string): string | null => {
    for (const n of notes) {
      const nn = rec(n);
      if (nn && nn.id === id && typeof nn.name === "string" && nn.name) return nn.name;
    }
    return null;
  };
  const markers = arr(pack.markers) ?? [];
  let markerCount = 0;
  for (const m of markers) {
    const mm = rec(m);
    if (!mm || fin(mm.x) === null || fin(mm.y) === null) continue;
    if (markerCount >= MAX_MARKERS) {
      dropped.push(`markers past the ${MAX_MARKERS} cap`);
      break;
    }
    const id = fin(mm.i);
    const name = (id !== null && noteName(`marker${id}`)) || (typeof mm.type === "string" && mm.type) || "Marker";
    out.nodes.push({ ...norm(fin(mm.x)!, fin(mm.y)!), name, kind: "landmark", capital: false, tier: "minor" });
    markerCount++;
  }

  // ── states → territory zones ────────────────────────────────────────────────
  const states = arr(pack.states) ?? [];
  if (opts?.statePolygons) {
    // borders arrive pre-traced (from the .map file's rendered SVG)
    for (const st of states) {
      const ss = rec(st);
      const id = ss && fin(ss.i);
      if (!ss || id === null || id === 0 || ss.removed === true) continue;
      const rings = opts.statePolygons.get(id);
      if (!rings || rings.length === 0) continue;
      const name = typeof ss.name === "string" && ss.name ? ss.name : `State ${id}`;
      if (rings.length > MAX_RINGS_PER_STATE) dropped.push(`${rings.length - MAX_RINGS_PER_STATE} small exclaves of ${name}`);
      rings.slice(0, MAX_RINGS_PER_STATE).forEach((ring, li) => {
        const polygon = ring.map(([x, y]) => norm(x, y));
        if (polygon.length >= 3) out.zones.push({ name: li === 0 ? name : `${name} (exclave)`, polygon });
      });
    }
    if (out.nodes.length === 0 && out.zones.length === 0) return null;
    return out;
  }
  const cells = cellsOf(pack);
  const vx = cells ? verticesOf(pack) : null;
  if (!cells || !vx) {
    if (states.length > 1) dropped.push("territories (the file has no readable cell mesh)");
  } else {
    for (const s of states) {
      const ss = rec(s);
      const id = ss && fin(ss.i);
      if (!ss || id === null || id === 0 || ss.removed === true) continue; // 0 = the unclaimed Neutrals
      const name = typeof ss.name === "string" && ss.name ? ss.name : `State ${id}`;
      const loops = traceState(id, cells, vx);
      if (loops.length === 0) continue;
      if (loops.length > MAX_RINGS_PER_STATE) dropped.push(`${loops.length - MAX_RINGS_PER_STATE} small exclaves of ${name}`);
      loops.slice(0, MAX_RINGS_PER_STATE).forEach((loop, li) => {
        const polygon: AzgaarPoint[] = [];
        for (const vid of loop) {
          const p = vx.point(vid);
          if (p) polygon.push(norm(p[0], p[1]));
        }
        if (polygon.length >= 3) out.zones.push({ name: li === 0 ? name : `${name} (exclave)`, polygon });
      });
    }
  }

  if (out.nodes.length === 0 && out.zones.length === 0) return null;
  return out;
}

// ── the .map file (Azgaar's native save) ─────────────────────────────────────
//
// A .map is not the JSON export: it is a CRLF-joined list of sections whose
// ORDER has drifted across versions, and it carries no cell mesh at all (the
// generator rebuilds the voronoi on load). So sections are identified by what
// they CONTAIN, and territories come from the one part of the file that
// really does know the borders: the rendered SVG's statesBody paths.

/** Shoelace area of a pixel ring, for keeping each state's main landmass. */
function pxRingArea(ring: [number, number][]): number {
  let a = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[(i + 1) % ring.length];
    a += x1 * y2 - x2 * y1;
  }
  return Math.abs(a / 2);
}

/** "M x,y L x y x y ... Z M ... Z" into rings. Azgaar draws state bodies with
 *  straight segments, so only M/L/Z appear; anything else ends a ring safely. */
function pathToRings(d: string): [number, number][][] {
  const rings: [number, number][][] = [];
  let ring: [number, number][] = [];
  const tokens = d.match(/[A-Za-z]|-?\d*\.?\d+(?:e-?\d+)?/g) ?? [];
  let i = 0;
  const flush = () => {
    if (ring.length >= 3) rings.push(ring);
    ring = [];
  };
  while (i < tokens.length) {
    const t = tokens[i];
    if (t === "M" || t === "L") {
      i++;
      while (i + 1 < tokens.length && !/[A-Za-z]/.test(tokens[i])) {
        const x = parseFloat(tokens[i]);
        const y = parseFloat(tokens[i + 1]);
        if (Number.isFinite(x) && Number.isFinite(y)) ring.push([x, y]);
        i += 2;
      }
      continue;
    }
    if (t === "Z" || t === "z") flush();
    i++;
  }
  flush();
  return rings.sort((a, b) => pxRingArea(b) - pxRingArea(a));
}

/** The statesBody layer of the map's SVG: state id → its border rings. */
function statePolygonsFromSvg(svg: string): Map<number, [number, number][][]> {
  const out = new Map<number, [number, number][][]>();
  const start = svg.indexOf('<g id="statesBody"');
  if (start < 0) return out;
  const end = svg.indexOf("</g>", start);
  const block = svg.slice(start, end < 0 ? undefined : end);
  for (const m of block.matchAll(/<path\s+d="([^"]+)"[^>]*?\bid="state(\d+)"/g)) {
    const id = parseInt(m[2], 10);
    if (!Number.isFinite(id)) continue;
    const rings = pathToRings(m[1]);
    if (rings.length > 0) out.set(id, rings);
  }
  return out;
}

/** Azgaar layers that are ANNOTATION, not geography: names, icons, borders,
 *  markers, military, chrome. The Atlas renders all of that itself, live —
 *  the artwork should carry only terrain and the regions' colors. */
const SVG_ANNOTATION_IDS = [
  "labels",
  "burgLabels",
  "burgIcons",
  "icons",
  "anchors",
  "markers",
  "armies",
  "regiments",
  "borders",
  "routes",
  "searoutes",
  "emblems",
  "ruler",
  "rulers",
  "scaleBar",
  "legend",
  "compass",
  "coordinates",
  "zones",
  "population",
];

/**
 * Strip a map SVG down to geography before it becomes the base image. Group
 * removal is balance-aware — Azgaar nests <g> heavily, so the closing tag of
 * a layer is found by counting, not by the next </g>.
 */
export function stripSvgToGeography(svg: string): string {
  let out = svg;
  for (const id of SVG_ANNOTATION_IDS) out = removeSvgGroup(out, id);
  return out;
}

function removeSvgGroup(svg: string, id: string): string {
  for (;;) {
    const start = svg.indexOf(`<g id="${id}"`);
    if (start < 0) return svg;
    let i = start;
    let depth = 0;
    let end = -1;
    while (i < svg.length) {
      // next group OPEN ("<g" followed by a delimiter — "<glyph" is not a group)
      let open = -1;
      for (let j = svg.indexOf("<g", i); j >= 0; j = svg.indexOf("<g", j + 2)) {
        const c = svg[j + 2];
        if (c === " " || c === ">" || c === "\t" || c === "\n" || c === "\r") {
          open = j;
          break;
        }
      }
      const close = svg.indexOf("</g>", i);
      if (close < 0) return svg; // malformed: better the labels than a broken image
      if (open >= 0 && open < close) {
        depth++;
        i = open + 2;
      } else {
        depth--;
        i = close + 4;
        if (depth === 0) {
          end = close + 4;
          break;
        }
      }
    }
    if (end < 0) return svg;
    svg = svg.slice(0, start) + svg.slice(end);
  }
}

/**
 * Import Azgaar's native .map save. Returns the same shape as the JSON path —
 * burgs and markers as nodes, states as zones, real-world size from the
 * distance scale — or null when the text is not a readable .map.
 */
export function importAzgaarMapFile(text: string): AzgaarImportResult | null {
  const parts = text.split("\r\n");
  if (parts.length < 5) return null;

  // line 0: version|credits|date|seed|width|height|id — positionally stable
  const params = parts[0].split("|");
  const width = fin(parseFloat(params[4]));
  const height = fin(parseFloat(params[5]));
  if (!width || !height || width <= 0 || height <= 0) return null;

  // line 1: distanceUnit|distanceScale|…|{options JSON}|mapName|… — the two
  // leading fields are stable; the map name sits right after the options JSON
  const settingsFields = parts[1]?.split("|") ?? [];
  const distanceUnit = settingsFields[0] || "mi";
  const distanceScale = fin(parseFloat(settingsFields[1] ?? ""));
  let mapName = "";
  const optEnd = parts[1]?.lastIndexOf("}");
  if (optEnd !== undefined && optEnd >= 0) {
    mapName = parts[1].slice(optEnd + 1).split("|").filter(Boolean)[0] ?? "";
  }

  // Everything else is found by what it PARSES to — section order has drifted
  // across versions, and string sniffing misleads (states mention "cell" and
  // "capital" too). Each candidate array is parsed once and probed by the
  // keys its object entries actually carry.
  const sections: unknown[][] = [];
  for (const p of parts) {
    if (!p.startsWith("[")) continue;
    try {
      const v = JSON.parse(p);
      if (Array.isArray(v)) sections.push(v);
    } catch {
      // a section that looks like an array but doesn't parse is not data
    }
  }
  const objs = (v: unknown[]): Rec[] => v.map((e) => rec(e)).filter((e): e is Rec => e !== null);
  const pick = (test: (entries: Rec[]) => boolean): unknown[] | null =>
    sections.find((v) => {
      const entries = objs(v);
      return entries.length > 0 && test(entries);
    }) ?? null;

  const states = pick((e) => e.some((x) => "formName" in x) && e.some((x) => "diplomacy" in x || "neighbors" in x));
  const burgs = pick((e) => e.slice(0, 5).some((x) => "cell" in x && "x" in x && "y" in x && "name" in x && !("icon" in x)));
  const markers = pick((e) => e.slice(0, 5).some((x) => "icon" in x && "cell" in x && "x" in x && !("name" in x)));
  const notes = pick((e) => e.slice(0, 5).some((x) => "legend" in x && "id" in x));
  const svg = parts.find((p) => p.startsWith("<svg"));

  const raw = {
    info: { width, height, mapName },
    settings: distanceScale ? { distanceScale, distanceUnit } : {},
    notes: notes ?? [],
    pack: {
      burgs: burgs ?? [],
      markers: markers ?? [],
      states: states ?? [],
    },
  };
  const statePolygons = svg ? statePolygonsFromSvg(svg) : new Map<number, [number, number][][]>();
  const result = importAzgaar(raw, { statePolygons });
  if (result && svg) result.svgText = svg;
  if (result && statePolygons.size === 0 && (states?.length ?? 0) > 1) {
    result.dropped.push("territories (the map's SVG carries no state borders — enable the States layer in Azgaar before saving)");
  }
  return result;
}
