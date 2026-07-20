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
  /** Map prop: a placed PNG (tree/crate/ruin) — full rectangular art, no disc,
   *  no label, no circular mask. Rides the whole token pipeline (drag/rotate/
   *  scale/sync) but reads as scenery, not an actor. */
  prop?: boolean;
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
  /** Facing in radians (stamped from movement direction). When set, vision is a
   *  forward cone + a tight peripheral ring — claustrophobic, not 360. */
  facing?: number;
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
  /** Realistic-fog lantern state: unlit (dark) until someone at the table
   *  clicks it alight. Ignored outside realistic fog (lights just burn). */
  lit?: boolean;
  /** Epoch ms when (re)lit — drives the burn-down dimming. */
  litAt?: number;
  /** Curator-set seconds from lit to burned out (unset/0 = never burns out). */
  burnSeconds?: number;
  /** Exempt from the lit/burn mechanic — always at full brightness. */
  alwaysOn?: boolean;
  /** Direction the light points, radians clockwise from +x (omni when unset). */
  dir?: number;
  /** Cone spread in degrees. Unset or >= 360 = omnidirectional. */
  cone?: number;
}
/** A spatial sound pinned to the world: players hear it by RANGE from their own
 *  token, and every wall between them and the source muffles it (quieter +
 *  low-passed). Handles render for the Curator only; the audio itself (a data
 *  URL) rides scene snapshots to players and is de-inlined to a blob ref at
 *  save time like map art. */
export interface VttEmitter {
  id: string;
  x: number; // world px
  y: number;
  /** Audible radius in cells — silent at and beyond the edge. */
  radius: number;
  /** Clip name (from the soundboard), for the inspector. */
  name: string;
  /** Audio data URL. */
  src: string;
  /** 0..1 volume standing at the source. */
  volume: number;
  loop: boolean;
  /** Optional environmental screen FX (EnvFxFilter preset id) that intensifies
   *  as a player's token nears this emitter — "walk toward the altar, the
   *  screen bleeds harder". Independent of whether it also plays a sound. */
  fx?: string;
  /** Max FX strength 0..1 at the source (default 0.85). */
  fxMax?: number;
}
export type VttEffectKind = "circle" | "cone" | "zone" | "line" | "ring" | "cross";
export interface VttEffectData {
  radius?: number; // cells — circle/cone reach; line length; ring outer radius; cross arm length
  dir?: number; // facing, radians — cone facing; line direction
  angle?: number; // cone spread, degrees
  w?: number; // zone width; line/cross thickness; ring band thickness (cells)
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
/** Darkness levels: pitch = no memory (left areas go fully black); remembered =
 *  explored stays dimly visible (the classic); realistic = explored memory
 *  DECAYS back to pitch black over time (creepy). */
export type VttFogMode = "pitch" | "remembered" | "realistic";
export interface VttFogState {
  enabled: boolean;
  /** Darkness level — defaults to "remembered" (pre-mode behavior). */
  mode?: VttFogMode;
  /** realistic: cell -> last-seen epoch ms (drives the decay fade). Aesthetic —
   *  refreshed locally from each client's own vision; approximate is fine. */
  seen?: Record<string, number>;
  /** realistic: seconds for a left cell to fade fully back to black (default 90). */
  decaySeconds?: number;
  /** realistic: must players light lanterns themselves (default true)? Turn OFF
   *  to make every light simply burn — the whole lit/relight mechanic opts out. */
  lanterns?: boolean;
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
// 3D atmosphere: environmental backdrop, depth fog, mist, particles, mood
// lighting, shadows, and a custom height-fog shader. Curator-set per scene.

/** Height-based volumetric fog via a custom shader (Roblox-style altitude falloff).
 *  Applied to the 3D ground + walls; params drive the injected GLSL, or the raw
 *  `glsl` chunk overrides the body entirely for deep custom effects. */
export interface VttShader {
  heightFog: boolean;
  /** Base fog density at y = offset. */
  density: number;
  /** How fast the fog thins as you climb (larger = thinner up high). */
  falloff: number;
  /** Fog colour (hex). */
  color: string;
  /** World-height where the fog is thickest. */
  offset: number;
  /** Advanced: a raw GLSL fragment chunk operating on gl_FragColor. Empty = the
   *  built-in height-fog body from the params above. */
  glsl?: string;
}
export function defaultShader(): VttShader {
  return { heightFog: false, density: 0.6, falloff: 0.012, color: "#0c1220", offset: 0, glsl: "" };
}
export interface VttAtmosphere {
  env: "void" | "space" | "cavern" | "wireframe";
  mood: "neutral" | "moonlight" | "hellfire" | "toxic" | "dusk";
  fog: number;
  mist: boolean;
  particles: "none" | "embers" | "spores" | "rain" | "snow";
  shadows: boolean;
  shader?: VttShader;
}
export function defaultAtmosphere(): VttAtmosphere {
  return { env: "space", mood: "neutral", fog: 0.35, mist: false, particles: "none", shadows: false, shader: defaultShader() };
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

/** Painted effect-zone kinds — SIX slots across two RGB masks (canvas uploads
 *  premultiply alpha, so A can't carry data; 3 channels per mask). The first
 *  three ship with built-in effects (water/smoke/ember); auxa/auxb/auxc are
 *  the Custom A/B/C slots. EVERY slot's GLSL body is editable per scene. */
export type VttZoneKind = "water" | "smoke" | "ember" | "auxa" | "auxb" | "auxc";
export const ZONE_KINDS: VttZoneKind[] = ["water", "smoke", "ember", "auxa", "auxb", "auxc"];

/** A portal along a map border: walking a token into that edge carries the
 *  party into the linked scene (arriving at the opposite edge). */
export type VttLinkEdge = "north" | "south" | "east" | "west";
export interface VttSceneLink {
  id: string;
  targetSceneId: string;
  edge: VttLinkEdge;
}

/** A freehand annotation stroke (world-space polyline). */
export interface VttDrawing {
  id: string;
  /** Flat [x0,y0, x1,y1, ...] world coords. */
  points: number[];
  color: string;
  width: number;
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
  /** Per-scene ambient music (audio data URL) — plays while the scene is active. */
  audio?: { src: string; volume: number } | null;
  /** Spatial sounds pinned to world positions (distance + wall muffling). */
  emitters?: VttEmitter[];
  /** Whole-map environmental screen FX — a constant field everyone sees (e.g.
   *  "all the walls bleed"). Emitters can locally exceed it by proximity. */
  envFx?: { preset: string; intensity: number } | null;
  /** Border portals into adjacent scenes (multi-map dungeons). */
  links?: VttSceneLink[];
  /** Painted effect zones — cell keys per effect kind (water/smoke/ember),
   *  rendered as animated procedural shader regions over the map. */
  zones?: Partial<Record<VttZoneKind, string[]>>;
  /** Freehand annotation strokes (everyone sees them; per-peer ink colors). */
  drawings?: VttDrawing[];
  /** Curator switch: may players use the Draw tool? Default true. */
  allowPlayerDraw?: boolean;
  /** Custom GLSL body per zone slot (empty/undefined = the slot's built-in
   *  effect). Contract: set `col` (vec3) and `alpha` (float) from `mask`
   *  (feathered 0..1), `pc` (world cell coords), and `uTime` (seconds). */
  zoneGlsl?: Partial<Record<VttZoneKind, string>>;
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
    audio: null,
    encounterId: null,
  };
}

export function newScene(campaignId: string, name = "New Scene"): VttScene {
  const now = Date.now();
  return { id: newId("sc"), campaignId, name, active: false, data: defaultSceneData(), createdAt: now, updatedAt: now };
}
