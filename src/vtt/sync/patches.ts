// VTT v2 (slice 10): op-based sync patches. Every local scene mutation emits one
// small op (never a full-scene resend); peers apply it to their own scene. Late
// joiners get a full `snapshot` instead. Ops ride the reserved `vtt-patch` net
// message (scope = scene id) so the protocol envelope stays stable.
import type { VttAtmosphere, VttBackground, VttDrawing, VttEffect, VttEffectData, VttEmitter, VttFogMode, VttGrid, VttLight, VttSceneData, VttTerrain, VttToken, VttWall, VttZoneKind } from "../types/scene";

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
  | { op: "emitter.add"; emitter: VttEmitter }
  | { op: "emitter.update"; id: string; patch: Partial<VttEmitter> }
  | { op: "emitter.remove"; id: string }
  | { op: "envfx.set"; envFx: { preset: string; intensity: number } | null }
  | { op: "fog.set"; enabled: boolean }
  | { op: "fog.reveal"; cells: string[] }
  | { op: "fog.reset" }
  | { op: "fog.config"; patch: { mode?: VttFogMode; decaySeconds?: number } }
  | { op: "zone.paint"; kind: VttZoneKind; cells: string[]; erase?: boolean }
  | { op: "zone.glsl"; kind: VttZoneKind; body: string }
  | { op: "draw.add"; drawing: VttDrawing }
  | { op: "draw.clear" }
  | { op: "draw.allow"; allow: boolean }
  | { op: "bg.set"; src?: string | null; patch?: Partial<VttBackground> }
  | { op: "grid.set"; patch: Partial<VttGrid> }
  | { op: "terrain.set"; terrain: VttTerrain | null }
  | { op: "atmo.set"; atmo: VttAtmosphere }
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
    case "emitter.add": {
      const list = (d.emitters ??= []);
      if (list.some((e) => e.id === op.emitter.id)) return false;
      list.push(op.emitter);
      return true;
    }
    case "emitter.update": {
      const e = d.emitters?.find((x) => x.id === op.id);
      if (!e) return false;
      Object.assign(e, op.patch);
      return true;
    }
    case "emitter.remove": {
      const before = d.emitters?.length ?? 0;
      d.emitters = (d.emitters ?? []).filter((x) => x.id !== op.id);
      return d.emitters.length !== before;
    }
    case "envfx.set":
      d.envFx = op.envFx;
      return true;
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
    case "fog.reset": {
      if (d.fog.revealed.length === 0 && !d.fog.seen) return false;
      d.fog.revealed = [];
      d.fog.seen = undefined;
      return true;
    }
    case "fog.config":
      Object.assign(d.fog, op.patch);
      return true;
    case "zone.paint": {
      const zones = (d.zones ??= {});
      const set = new Set(zones[op.kind] ?? []);
      let changed = false;
      for (const c of op.cells) {
        if (op.erase) {
          if (set.delete(c)) changed = true;
        } else if (!set.has(c)) {
          set.add(c);
          changed = true;
        }
      }
      if (changed) zones[op.kind] = [...set];
      return changed;
    }
    case "zone.glsl": {
      const zg = (d.zoneGlsl ??= {});
      if ((zg[op.kind] ?? "") === op.body) return false;
      zg[op.kind] = op.body;
      return true;
    }
    case "draw.add": {
      const list = (d.drawings ??= []);
      if (list.some((x) => x.id === op.drawing.id)) return false;
      list.push(op.drawing);
      return true;
    }
    case "draw.clear": {
      if (!d.drawings?.length) return false;
      d.drawings = [];
      return true;
    }
    case "draw.allow":
      if ((d.allowPlayerDraw ?? true) === op.allow) return false;
      d.allowPlayerDraw = op.allow;
      return true;
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
    case "atmo.set":
      d.atmosphere = op.atmo;
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
