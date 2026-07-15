// VTT v2 typed scene model (replaces the legacy vtt.html's untyped map blob).
// The scene rides the v1 scenes table's JSON `data` column via sceneRepo.

export interface VttGrid {
  type: "square"; // hex later
  size: number; // px per cell
  cols: number;
  rows: number;
  color: string;
  visible: boolean;
}
export interface VttCameraState {
  x: number; // world-space translation
  y: number;
  zoom: number;
}
export interface VttToken {
  id: string;
  name: string;
  x: number; // world px (cell centers)
  y: number;
  size: number; // cells of diameter
  color: string;
  /** Token art (asset uri); falls back to the colour disc when unset. */
  img?: string | null;
  /** 3D model (GLB asset uri) — rendered instead of the billboard in the 3D view. */
  model?: string | null;
  /** Facing, degrees clockwise from up — set by the on-canvas rotate handle. */
  rotation?: number;
  /** Owning player (netplay peer id). Player fog reveals only from owned tokens. */
  owner?: string;
  hp?: number;
  hpMax?: number;
  /** Linked character or actor (Codex creature / party member). */
  characterId?: string | null;
  actorId?: string | null;
  /** What the token is linked to, for the inspector + future stat sync. */
  actorKind?: "character" | "creature";
  /** Snapshot of the linked source's extra stats, shown read-only in the inspector. */
  meta?: VttTokenMeta;
  ownerPeer?: string | null;
  visible: boolean;
  /** Vision radius in cells (fog/vision system). */
  vision?: number;
  /** Condition/status tags (SimulationSystem — rendered as pips). */
  statuses?: string[];
}
export interface VttTokenMeta {
  /** Damage reduction (creatures). */
  dr?: number;
  /** Creature class id / character rank, for a short subtitle. */
  cls?: number;
  traits?: string;
  desc?: string;
  flags?: string[];
  /** Raw stat block (creature stats or character attributes), read-only. */
  stats?: Record<string, number>;
}
export interface VttWall {
  id: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  blocksLight: boolean;
}
export interface VttLight {
  id: string;
  x: number;
  y: number;
  radius: number; // cells
  color: string;
  intensity: number; // 0..1
}
export type VttEffectKind = "circle" | "cone" | "zone";
export interface VttEffectData {
  radius?: number; // cells (circle / cone reach)
  dir?: number; // cone facing, radians
  angle?: number; // cone spread, degrees
  w?: number; // zone width, cells
  h?: number; // zone height, cells
  color?: string;
  /** Lifetime in rounds; 0 / undefined = permanent. */
  rounds?: number;
  /** Encounter round the effect was placed on (for expiry). */
  bornRound?: number;
  /** Status a zone applies to tokens standing inside it (SimulationSystem). */
  status?: string;
  label?: string;
}
export interface VttEffect {
  id: string;
  kind: VttEffectKind;
  x: number;
  y: number;
  data: VttEffectData;
}
export interface VttFogState {
  enabled: boolean;
  /** Revealed cells as "col,row" keys. */
  revealed: string[];
}
export interface VttLayerState {
  grid: boolean;
  tokens: boolean;
  walls: boolean;
  lights: boolean;
  fog: boolean;
  effects: boolean;
}
export interface VttTimelineState {
  round: number;
  turn: number;
}
/** Terrain elevation for the 3D view: one normalised height (0..1) per grid
 *  cell (row-major, cols×rows), scaled by maxCells×gridSize in world units.
 *  Sampled from a grayscale heightmap image in the Grid & Map panel. */
export interface VttTerrain {
  heights: number[];
  /** World height of a full-white cell, in grid cells. */
  maxCells: number;
}
/** 3D atmosphere: environmental backdrop, depth fog, mist, particles, mood
 *  lighting and shadows. Curator-set per scene; synced like everything else. */
export interface VttAtmosphere {
  /** Environmental backdrop surrounding the map. */
  env: "void" | "space" | "cavern" | "wireframe";
  /** Mood preset tinting ambient light, sun, and fog colour. */
  mood: "neutral" | "moonlight" | "hellfire" | "toxic" | "dusk";
  /** Depth-fog amount 0..1 (0 = off) — map edges melt into the haze. */
  fog: number;
  /** Crawling ground-mist layer just above the floor. */
  mist: boolean;
  particles: "none" | "embers" | "spores" | "rain" | "snow";
  /** Lights and the sun cast real shadows (costs GPU). */
  shadows: boolean;
}
export function defaultAtmosphere(): VttAtmosphere {
  return { env: "space", mood: "neutral", fog: 0.35, mist: false, particles: "none", shadows: false };
}
export interface VttBackground {
  color: string;
  src?: string; // image url / asset path
  /** "grid" stretches the image to cover the whole grid (default); "manual" uses scale/x/y. */
  fit?: "grid" | "manual";
  scale: number;
  x: number;
  y: number;
}

export interface VttSceneData {
  grid: VttGrid;
  camera: VttCameraState;
  background: VttBackground;
  tokens: VttToken[];
  walls: VttWall[];
  lights: VttLight[];
  effects: VttEffect[];
  fog: VttFogState;
  layers: VttLayerState;
  timeline: VttTimelineState;
  terrain?: VttTerrain | null;
  atmosphere?: VttAtmosphere | null;
  encounterId?: string | null;
}

export interface VttScene {
  id: string;
  campaignId: string;
  name: string;
  active: boolean;
  data: VttSceneData;
  createdAt: number;
  updatedAt: number;
}

export const TOKEN_COLORS = ["#689a96", "#837aae", "#a1584a", "#6f9a68", "#a08a4f", "#a7aebd"];

export function newId(prefix: string): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return prefix + "-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
}

export function defaultSceneData(): VttSceneData {
  return {
    grid: { type: "square", size: 70, cols: 40, rows: 26, color: "#1a2233", visible: true },
    camera: { x: 0, y: 0, zoom: 0.6 },
    background: { color: "#0c1220", fit: "grid", scale: 1, x: 0, y: 0 },
    tokens: [],
    walls: [],
    lights: [],
    effects: [],
    fog: { enabled: false, revealed: [] },
    layers: { grid: true, tokens: true, walls: true, lights: true, fog: true, effects: true },
    timeline: { round: 0, turn: 0 },
    terrain: null,
    encounterId: null,
  };
}

export function newScene(campaignId: string, name = "New Scene"): VttScene {
  const now = Date.now();
  return { id: newId("sc"), campaignId, name, active: false, data: defaultSceneData(), createdAt: now, updatedAt: now };
}
