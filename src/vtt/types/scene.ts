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
  hp?: number;
  hpMax?: number;
  /** Linked character or actor (Codex creature / party member). */
  characterId?: string | null;
  actorId?: string | null;
  ownerPeer?: string | null;
  visible: boolean;
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
export interface VttEffect {
  id: string;
  kind: string; // aoe-circle | aoe-cone | zone | weather | …
  x: number;
  y: number;
  data: Record<string, unknown>;
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
export interface VttBackground {
  color: string;
  src?: string; // image url / asset path
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
    background: { color: "#0c1220", scale: 1, x: 0, y: 0 },
    tokens: [],
    walls: [],
    lights: [],
    effects: [],
    fog: { enabled: false, revealed: [] },
    layers: { grid: true, tokens: true, walls: true, lights: true, fog: true, effects: true },
    timeline: { round: 0, turn: 0 },
    encounterId: null,
  };
}

export function newScene(campaignId: string, name = "New Scene"): VttScene {
  const now = Date.now();
  return { id: newId("sc"), campaignId, name, active: false, data: defaultSceneData(), createdAt: now, updatedAt: now };
}
