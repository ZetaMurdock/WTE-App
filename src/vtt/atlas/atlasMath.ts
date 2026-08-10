// The Atlas camera and cartography math, kept pure so it can be tested without
// a canvas.
//
// World space is MILES (see atlasModel.ts). The camera is a center point in
// world space plus a zoom in pixels-per-mile; the feel the design asks for —
// zoom that keeps the point under the cursor under the cursor, panning that
// glides after release — is all arithmetic on that triple, and getting it wrong
// is instantly perceptible in the hand even when no single frame looks wrong.
import type { AtlasPoint } from "./atlasModel";

export interface AtlasCamera {
  /** World point at the viewport center, in miles. */
  x: number;
  y: number;
  /** Pixels per mile. Bigger is closer. */
  zoom: number;
  /** Glide velocity in world miles per second, applied by stepInertia. */
  vx: number;
  vy: number;
}

export interface Viewport {
  width: number;
  height: number;
}

export const MI_PER_KM = 0.621371;
export const FT_PER_MI = 5280;

/** Zoom limits: far enough out to see a whole planet-scale map at a glance,
 *  close enough in that a 5 ft grid step is drawable. */
export const MIN_ZOOM = 0.02;
export const MAX_ZOOM = 4000;

export function makeCamera(x: number, y: number, zoom: number): AtlasCamera {
  return { x, y, zoom: clampZoom(zoom), vx: 0, vy: 0 };
}

export function clampZoom(zoom: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

export function worldToScreen(cam: AtlasCamera, view: Viewport, p: AtlasPoint): { x: number; y: number } {
  return {
    x: view.width / 2 + (p.x - cam.x) * cam.zoom,
    y: view.height / 2 + (p.y - cam.y) * cam.zoom,
  };
}

export function screenToWorld(cam: AtlasCamera, view: Viewport, s: { x: number; y: number }): AtlasPoint {
  return {
    x: cam.x + (s.x - view.width / 2) / cam.zoom,
    y: cam.y + (s.y - view.height / 2) / cam.zoom,
  };
}

/**
 * Zoom by `factor` keeping the world point under `cursor` stationary on screen.
 *
 * This is the whole difference between mapping software that feels expensive
 * and a JPG in a scroll container: put the cursor on Rivenbark, scroll, and
 * Rivenbark stays under the cursor while the world grows around it.
 */
export function zoomAt(cam: AtlasCamera, view: Viewport, cursor: { x: number; y: number }, factor: number): AtlasCamera {
  const zoom = clampZoom(cam.zoom * factor);
  if (zoom === cam.zoom) return cam;
  const before = screenToWorld(cam, view, cursor);
  // With the new zoom, where would that world point land? Move the center by
  // the difference so it lands back under the cursor.
  const next = { ...cam, zoom };
  const after = screenToWorld(next, view, cursor);
  return { ...next, x: cam.x + (before.x - after.x), y: cam.y + (before.y - after.y) };
}

/** Pan by a screen-space delta (drag), converting to world miles. */
export function panBy(cam: AtlasCamera, dx: number, dy: number): AtlasCamera {
  return { ...cam, x: cam.x - dx / cam.zoom, y: cam.y - dy / cam.zoom };
}

/** Exponential glide decay per second. ~0.002 leaves ~0.2% of the velocity
 *  after a second — a short, definite glide rather than an air-hockey table. */
const INERTIA_DECAY = 0.002;
/** Below this screen-speed (px/s) the glide snaps to rest. */
const REST_SPEED = 4;

/**
 * Advance the glide by `dtMs`. Returns the same object once at rest so a
 * render loop can use identity to know when to stop scheduling frames.
 */
export function stepInertia(cam: AtlasCamera, dtMs: number): AtlasCamera {
  if (cam.vx === 0 && cam.vy === 0) return cam;
  const dt = Math.min(dtMs, 100) / 1000; // a hitch must not teleport the map
  const keep = Math.pow(INERTIA_DECAY, dt);
  const vx = cam.vx * keep;
  const vy = cam.vy * keep;
  if (Math.hypot(vx, vy) * cam.zoom < REST_SPEED) {
    return { ...cam, vx: 0, vy: 0 };
  }
  return { ...cam, x: cam.x + vx * dt, y: cam.y + vy * dt, vx, vy };
}

/** Keep the camera near the map: the center may not leave the map rectangle by
 *  more than half a viewport, so you can overshoot the edge but never lose the
 *  map entirely. */
export function clampToMap(cam: AtlasCamera, view: Viewport, widthMi: number, heightMi: number): AtlasCamera {
  const slackX = view.width / 2 / cam.zoom;
  const slackY = view.height / 2 / cam.zoom;
  const x = Math.min(widthMi + slackX, Math.max(-slackX, cam.x));
  const y = Math.min(heightMi + slackY, Math.max(-slackY, cam.y));
  if (x === cam.x && y === cam.y) return cam;
  return { ...cam, x, y };
}

// ── Scale bar ────────────────────────────────────────────────────────────────

/** Candidate steps, in miles. Feet first (as fractions of a mile), then miles —
 *  the ladder the scale bar climbs as you zoom out. */
const IMPERIAL_STEPS_MI: { mi: number; label: string }[] = [
  { mi: 5 / FT_PER_MI, label: "5 ft" },
  { mi: 10 / FT_PER_MI, label: "10 ft" },
  { mi: 25 / FT_PER_MI, label: "25 ft" },
  { mi: 50 / FT_PER_MI, label: "50 ft" },
  { mi: 100 / FT_PER_MI, label: "100 ft" },
  { mi: 250 / FT_PER_MI, label: "250 ft" },
  { mi: 500 / FT_PER_MI, label: "500 ft" },
  { mi: 1000 / FT_PER_MI, label: "1,000 ft" },
  { mi: 0.5, label: "0.5 mi" },
  { mi: 1, label: "1 mi" },
  { mi: 5, label: "5 mi" },
  { mi: 10, label: "10 mi" },
  { mi: 25, label: "25 mi" },
  { mi: 50, label: "50 mi" },
  { mi: 100, label: "100 mi" },
  { mi: 250, label: "250 mi" },
  { mi: 500, label: "500 mi" },
  { mi: 1000, label: "1,000 mi" },
];

const KM_PER_MI = 1 / MI_PER_KM;
const METRIC_STEPS_MI: { mi: number; label: string }[] = [
  { mi: 0.001 * KM_PER_MI, label: "1 m" },
  { mi: 0.005 * KM_PER_MI, label: "5 m" },
  { mi: 0.01 * KM_PER_MI, label: "10 m" },
  { mi: 0.025 * KM_PER_MI, label: "25 m" },
  { mi: 0.05 * KM_PER_MI, label: "50 m" },
  { mi: 0.1 * KM_PER_MI, label: "100 m" },
  { mi: 0.25 * KM_PER_MI, label: "250 m" },
  { mi: 0.5 * KM_PER_MI, label: "500 m" },
  { mi: 1 * KM_PER_MI, label: "1 km" },
  { mi: 5 * KM_PER_MI, label: "5 km" },
  { mi: 10 * KM_PER_MI, label: "10 km" },
  { mi: 25 * KM_PER_MI, label: "25 km" },
  { mi: 50 * KM_PER_MI, label: "50 km" },
  { mi: 100 * KM_PER_MI, label: "100 km" },
  { mi: 250 * KM_PER_MI, label: "250 km" },
  { mi: 500 * KM_PER_MI, label: "500 km" },
  { mi: 1000 * KM_PER_MI, label: "1,000 km" },
];

export interface ScaleBar {
  label: string;
  px: number;
  /** The step in miles, which is also the navigation grid's spacing. */
  stepMi: number;
}

/**
 * Pick the scale step whose bar is closest to ~120 screen pixels.
 *
 * The same step drives the navigation grid, so the grid always agrees with the
 * legend — `SCALE | 50 MI` means the faint lines really are 50 miles apart.
 */
export function pickScaleBar(zoom: number, units: "imperial" | "metric" | "both"): ScaleBar {
  const steps = units === "metric" ? METRIC_STEPS_MI : IMPERIAL_STEPS_MI;
  let best = steps[0];
  let bestScore = Infinity;
  for (const s of steps) {
    const px = s.mi * zoom;
    const score = Math.abs(Math.log(px / 120));
    if (score < bestScore) {
      best = s;
      bestScore = score;
    }
  }
  const label = units === "both" ? `${best.label} / ${formatKm(best.mi)}` : best.label;
  return { label, px: best.mi * zoom, stepMi: best.mi };
}

function formatKm(mi: number): string {
  const km = mi / MI_PER_KM;
  if (km < 1) return `${Math.round(km * 1000)} m`;
  return `${km >= 100 ? Math.round(km) : +km.toFixed(1)} km`;
}

// ── Distance ─────────────────────────────────────────────────────────────────

export function distanceMi(a: AtlasPoint, b: AtlasPoint): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/** "17.4 mi", "890 ft", "38.4 mi / 61.8 km" — the readout the measure tool and
 *  node cards share, so no two surfaces format the same distance differently. */
export function formatDistance(mi: number, units: "imperial" | "metric" | "both"): string {
  const imperial = mi < 0.25 ? `${Math.round(mi * FT_PER_MI)} ft` : `${mi >= 100 ? Math.round(mi) : +mi.toFixed(1)} mi`;
  if (units === "imperial") return imperial;
  const metric = formatKm(mi);
  if (units === "metric") return metric;
  return `${imperial} / ${metric}`;
}

// ── Geometry ─────────────────────────────────────────────────────────────────

/** Ray-cast point-in-polygon. Zones are drawn free-hand, so no convexity is
 *  assumed. */
export function pointInPolygon(p: AtlasPoint, poly: AtlasPoint[]): boolean {
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

/** Is this node shown at the current zoom? Gates are what keep a planetary view
 *  to the Space Elevator and the Tree while streets wait for street zoom. */
export function nodeVisibleAtZoom(node: { minZoom?: number; maxZoom?: number }, zoom: number): boolean {
  if (node.minZoom !== undefined && zoom < node.minZoom) return false;
  if (node.maxZoom !== undefined && zoom > node.maxZoom) return false;
  return true;
}

// ── Technical dressing ───────────────────────────────────────────────────────

/** The COORD readout: a stable, fictional-feeling designation derived from the
 *  world position. Deterministic so two players looking at the same spot see
 *  the same designation. */
export function coordLabel(p: AtlasPoint, mapName: string): string {
  const tag = mapName
    .replace(/[^A-Za-z]/g, "")
    .slice(0, 3)
    .toUpperCase() || "MAP";
  // Wrapped into fixed-width fields — an instrument readout has a fixed number
  // of digits, and 191.0 mi rendering as "19100" read as a malfunction.
  const fx = Math.abs(Math.round(p.x * 10)) % 10000;
  const fy = Math.abs(Math.round(p.y * 10)) % 100;
  return `${tag}-${String(fx).padStart(4, "0")}.${String(fy).padStart(2, "0")}`;
}

/** Corrupted readouts for null rejection, picked deterministically from the
 *  cursor position so the glitch flickers as you move rather than every frame. */
const NULL_TEXT = [
  "DATA NULL",
  "OBSERVATION DENIED",
  "CARTOGRAPHIC RETURN: Ø",
  "CLEARANCE INSUFFICIENT",
  "METRIC INFORMATION UNRESOLVED",
  "SIGNAL REJECTED",
];

export function nullReadout(p: AtlasPoint, salt: number): string {
  const h = Math.abs(Math.sin(p.x * 12.9898 + p.y * 78.233 + salt) * 43758.5453);
  return NULL_TEXT[Math.floor(h % NULL_TEXT.length)];
}
