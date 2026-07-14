// VTT v2 (slice 10): op-based sync patches. Every local scene mutation emits one
// small op (never a full-scene resend); peers apply it to their own scene. Late
// joiners get a full `snapshot` instead. Ops ride the reserved `vtt-patch` net
// message (scope = scene id) so the protocol envelope stays stable.
import type { VttBackground, VttEffect, VttEffectData, VttGrid, VttLight, VttSceneData, VttTerrain, VttToken, VttWall } from "../types/scene";

export type VttOp =
  | { op: "token.add"; token: VttToken }
  | { op: "token.move"; id: string; x: number; y: number }
  | { op: "token.update"; id: string; patch: Partial<VttToken> }
  | { op: "token.remove"; id: string }
  | { op: "wall.add"; wall: VttWall }
  | { op: "wall.update"; id: string; patch: Partial<VttWall> }
  | { op: "wall.remove"; id: string }
  | { op: "light.add"; light: VttLight }
  | { op: "light.update"; id: string; patch: Partial<VttLight> }
  | { op: "light.remove"; id: string }
  | { op: "fog.set"; enabled: boolean }
  | { op: "fog.reveal"; cells: string[] }
  | { op: "bg.set"; src?: string | null; patch?: Partial<VttBackground> }
  | { op: "grid.set"; patch: Partial<VttGrid> }
  | { op: "terrain.set"; terrain: VttTerrain | null }
  | { op: "effect.add"; effect: VttEffect }
  | { op: "effect.update"; id: string; patch: Partial<VttEffectData> }
  | { op: "effect.remove"; id: string }
  | { op: "scene.switch"; sceneId: string };

/** Apply an op to scene data in place. Scene-scoped only — `scene.switch` is
 *  handled a level up (it swaps the whole scene), so it's a no-op here. Returns
 *  true if the data changed. */
export function applyOp(d: VttSceneData, op: VttOp): boolean {
  switch (op.op) {
    case "token.add":
      if (d.tokens.some((t) => t.id === op.token.id)) return false;
      d.tokens.push(op.token);
      return true;
    case "token.move": {
      const t = d.tokens.find((x) => x.id === op.id);
      if (!t) return false;
      t.x = op.x;
      t.y = op.y;
      return true;
    }
    case "token.update": {
      const t = d.tokens.find((x) => x.id === op.id);
      if (!t) return false;
      Object.assign(t, op.patch);
      return true;
    }
    case "token.remove": {
      const before = d.tokens.length;
      d.tokens = d.tokens.filter((x) => x.id !== op.id);
      return d.tokens.length !== before;
    }
    case "wall.add":
      if (d.walls.some((w) => w.id === op.wall.id)) return false;
      d.walls.push(op.wall);
      return true;
    case "wall.update": {
      const w = d.walls.find((x) => x.id === op.id);
      if (!w) return false;
      Object.assign(w, op.patch);
      return true;
    }
    case "wall.remove": {
      const before = d.walls.length;
      d.walls = d.walls.filter((x) => x.id !== op.id);
      return d.walls.length !== before;
    }
    case "light.add":
      if (d.lights.some((l) => l.id === op.light.id)) return false;
      d.lights.push(op.light);
      return true;
    case "light.update": {
      const l = d.lights.find((x) => x.id === op.id);
      if (!l) return false;
      Object.assign(l, op.patch);
      return true;
    }
    case "light.remove": {
      const before = d.lights.length;
      d.lights = d.lights.filter((x) => x.id !== op.id);
      return d.lights.length !== before;
    }
    case "fog.set":
      if (d.fog.enabled === op.enabled) return false;
      d.fog.enabled = op.enabled;
      return true;
    case "fog.reveal": {
      const set = new Set(d.fog.revealed);
      let added = false;
      for (const c of op.cells) if (!set.has(c)) (set.add(c), (added = true));
      if (added) d.fog.revealed = [...set];
      return added;
    }
    case "bg.set":
      if (op.patch) Object.assign(d.background, op.patch);
      else d.background.src = op.src || undefined; // legacy src-only form
      return true;
    case "grid.set":
      Object.assign(d.grid, op.patch);
      return true;
    case "terrain.set":
      d.terrain = op.terrain;
      return true;
    case "effect.add":
      if (d.effects.some((e) => e.id === op.effect.id)) return false;
      d.effects.push(op.effect);
      return true;
    case "effect.update": {
      const e = d.effects.find((x) => x.id === op.id);
      if (!e) return false;
      Object.assign(e.data, op.patch);
      return true;
    }
    case "effect.remove": {
      const before = d.effects.length;
      d.effects = d.effects.filter((x) => x.id !== op.id);
      return d.effects.length !== before;
    }
    case "scene.switch":
      return false; // handled by the sync layer, not by mutating this scene
  }
}
