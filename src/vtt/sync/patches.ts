// VTT v2 (slice 10): op-based sync patches. Every local scene mutation emits one
// small op (never a full-scene resend); peers apply it to their own scene. Late
// joiners get a full `snapshot` instead. Ops ride the reserved `vtt-patch` net
// message (scope = scene id) so the protocol envelope stays stable.
import type { VttAtmosphere, VttBackground, VttDrawing, VttEffect, VttEffectData, VttEmitter, VttFogMode, VttGrid, VttLight, VttSceneData, VttTerrain, VttToken, VttWall, VttZoneKind } from "../types/scene";
import { canOccupy } from "../data/occupancy";
import { canControlToken } from "./tokenPermissions";
import { lightVisibleTo } from "../engine/systems/VisionSystem";
import { burnMechanicOn } from "../engine/systems/lightState";

export type VttOp =
  | { op: "token.add"; token: VttToken }
  | { op: "token.move"; id: string; x: number; y: number }
  | { op: "token.update"; id: string; patch: Partial<VttToken> }
  | { op: "token.assign"; id: string; owner: string | null }
  | { op: "token.remove"; id: string }
  | { op: "wall.add"; wall: VttWall }
  | { op: "wall.update"; id: string; patch: Partial<VttWall> }
  | { op: "wall.remove"; id: string }
  | { op: "light.add"; light: VttLight }
  | { op: "light.update"; id: string; patch: Partial<VttLight> }
  | { op: "light.ignite"; id: string }
  | { op: "light.all"; patch: Partial<VttLight> } // configure every light at once
  | { op: "light.remove"; id: string }
  | { op: "emitter.add"; emitter: VttEmitter }
  | { op: "emitter.update"; id: string; patch: Partial<VttEmitter> }
  | { op: "emitter.remove"; id: string }
  | { op: "envfx.set"; envFx: { preset: string; intensity: number } | null }
  | { op: "fog.set"; enabled: boolean }
  | { op: "fog.reveal"; cells: string[] }
  | { op: "fog.reset" }
  | { op: "fog.config"; patch: { mode?: VttFogMode; decaySeconds?: number; lanterns?: boolean } }
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

const TOKEN_UPDATE_KEYS = new Set<keyof VttToken>([
  "name",
  "size",
  "color",
  "img",
  "rotation",
  "blocksMovement",
  "hp",
  "hpMax",
  "meta",
  "visible",
  "facing",
  "vision",
  "statuses",
]);

/** Fields an owner may change without Curator authority. */
const PLAYER_TOKEN_UPDATE_KEYS = new Set<keyof VttToken>([
  "name", "size", "color", "img", "rotation", "hp", "hpMax", "facing", "statuses",
]);

function tokenUpdateValueAllowed(field: keyof VttToken, value: unknown): boolean {
  if (value === undefined) return true;
  switch (field) {
    case "name":
      return typeof value === "string" && value.length <= 120;
    case "color": return typeof value === "string" && value.length <= 32;
    case "img": return value === null || (typeof value === "string" && value.length <= 9 * 1024 * 1024 /* props may carry 8 MB data URLs since the cap raise; below this the patch was silently rejected and peers desynced */);
    case "size": return typeof value === "number" && Number.isFinite(value) && value >= 1 && value <= 6;
    case "rotation":
    case "facing": return typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= 1_000_000;
    case "blocksMovement":
    case "visible": return typeof value === "boolean";
    case "hp":
    case "hpMax": return typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= 1_000_000_000;
    case "vision": return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100;
    case "meta": {
      if (!isRecord(value)) return false;
      try { return JSON.stringify(value).length <= 64 * 1024; } catch { return false; }
    }
    case "statuses": return Array.isArray(value) && value.length <= 64 && value.every((status) => typeof status === "string" && status.length <= 80);
    default: return false;
  }
}

/** Strip identity, ownership, movement, linkage, and unknown fields. */
export function sanitizeTokenUpdatePatch(patch: unknown): Partial<VttToken> {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) return {};
  const safe: Partial<VttToken> = {};
  for (const [field, value] of Object.entries(patch)) {
    if (TOKEN_UPDATE_KEYS.has(field as keyof VttToken) && tokenUpdateValueAllowed(field as keyof VttToken, value)) Object.assign(safe, { [field]: value });
  }
  return safe;
}

/** Apply the same owner-only customization policy before a player mutates its
 * local preview. This prevents a rejected field from lingering locally until
 * the next authoritative snapshot. */
export function sanitizePlayerTokenUpdatePatch(patch: unknown): Partial<VttToken> {
  const safe = sanitizeTokenUpdatePatch(patch);
  for (const field of Object.keys(safe) as (keyof VttToken)[]) {
    if (!PLAYER_TOKEN_UPDATE_KEYS.has(field)) delete safe[field];
  }
  return safe;
}

/** A remote mixed safe/unsafe patch is rejected, rather than partially applied. */
export function tokenUpdateHasProtectedFields(patch: unknown): boolean {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) return true;
  return Object.keys(patch).some((field) => !TOKEN_UPDATE_KEYS.has(field as keyof VttToken));
}

export function tokenUpdatePatchAllowed(patch: unknown): boolean {
  if (!patch || typeof patch !== "object" || Array.isArray(patch) || tokenUpdateHasProtectedFields(patch)) return false;
  return Object.entries(patch).every(([field, value]) => tokenUpdateValueAllowed(field as keyof VttToken, value));
}

function playerTokenUpdatePatchAllowed(patch: unknown): boolean {
  return tokenUpdatePatchAllowed(patch) && Object.keys(patch as object).every((field) => PLAYER_TOKEN_UPDATE_KEYS.has(field as keyof VttToken));
}

/** Authorization for an op originating from a player, live or scene-pinned. */
export function foreignOpAllowed(d: VttSceneData, op: VttOp, from: string): boolean {
  if (op.op === "token.move" || op.op === "token.update" || op.op === "token.remove") {
    const tok = d.tokens.find((t) => t.id === op.id);
    const action = op.op === "token.move" ? "move" : op.op === "token.remove" ? "remove" : "customize";
    if (!tok || !canControlToken({ peerId: from, role: "player" }, tok, action)) return false;
    if (op.op === "token.update") {
      if (!playerTokenUpdatePatchAllowed(op.patch)) return false;
      if (op.patch.size !== undefined) {
        const placement = { x: tok.x, y: tok.y, size: op.patch.size };
        if (!canOccupy(d.grid, d.tokens, placement, { ignoreTokenId: tok.id }).ok) return false;
      }
    }
    return true;
  }
  if (op.op === "light.ignite") {
    const light = d.lights.find((candidate) => candidate.id === op.id);
    return !!light && !light.alwaysOn && burnMechanicOn(d.fog) && lightVisibleTo(d, light, from);
  }
  if (op.op === "draw.add") return d.allowPlayerDraw !== false && (d.drawings?.length ?? 0) < 500;
  // Token creation and every scene-building mutation are Curator-only.
  return false;
}

const VTT_OP_NAMES = new Set<VttOp["op"]>([
  "token.add", "token.move", "token.update", "token.assign", "token.remove",
  "wall.add", "wall.update", "wall.remove",
  "light.add", "light.update", "light.ignite", "light.all", "light.remove",
  "emitter.add", "emitter.update", "emitter.remove", "envfx.set",
  "fog.set", "fog.reveal", "fog.reset", "fog.config",
  "zone.paint", "zone.glsl", "draw.add", "draw.clear", "draw.allow",
  "bg.set", "grid.set", "terrain.set", "atmo.set",
  "effect.add", "effect.update", "effect.remove", "scene.switch",
]);

const isRecord = (value: unknown): value is Record<string, unknown> => value != null && typeof value === "object" && !Array.isArray(value);
const hasStringId = (value: unknown): boolean => isRecord(value) && typeof value.id === "string" && value.id.length > 0 && value.id.length <= 128;
const isStringArray = (value: unknown, max = 4096): boolean =>
  Array.isArray(value) && value.length <= max && value.every((entry) => typeof entry === "string" && entry.length <= 128);
const validDrawing = (value: unknown): value is VttDrawing => {
  if (!hasStringId(value) || !isRecord(value) || !Array.isArray(value.points)) return false;
  return value.points.length >= 4 && value.points.length <= 4096 && value.points.length % 2 === 0 &&
    value.points.every((point) => typeof point === "number" && Number.isFinite(point) && Math.abs(point) <= 10_000_000) &&
    typeof value.color === "string" && value.color.length <= 32 &&
    typeof value.width === "number" && Number.isFinite(value.width) && value.width >= 0.25 && value.width <= 100;
};

/** Runtime boundary guard for untrusted patch payloads. */
export function isVttOp(value: unknown): value is VttOp {
  if (!isRecord(value) || typeof value.op !== "string" || !VTT_OP_NAMES.has(value.op as VttOp["op"])) return false;
  switch (value.op as VttOp["op"]) {
    case "token.add":
      return hasStringId(value.token) && isRecord(value.token) && Number.isFinite(value.token.x) && Number.isFinite(value.token.y);
    case "token.move":
      return typeof value.id === "string" && Number.isFinite(value.x) && Number.isFinite(value.y);
    case "token.update":
      return typeof value.id === "string" && tokenUpdatePatchAllowed(value.patch);
    case "token.assign":
      return typeof value.id === "string" && value.id.length <= 128 && (value.owner === null || (typeof value.owner === "string" && value.owner.length > 0 && value.owner.length <= 128));
    case "wall.update":
    case "light.update":
    case "emitter.update":
    case "effect.update":
      return typeof value.id === "string" && isRecord(value.patch);
    case "token.remove":
    case "wall.remove":
    case "light.ignite":
    case "light.remove":
    case "emitter.remove":
    case "effect.remove":
      return typeof value.id === "string";
    case "wall.add": return hasStringId(value.wall);
    case "light.add": return hasStringId(value.light);
    case "light.all": return isRecord(value.patch);
    case "emitter.add": return hasStringId(value.emitter);
    case "envfx.set": return value.envFx === null || isRecord(value.envFx);
    case "fog.set": return typeof value.enabled === "boolean";
    case "fog.reveal": return isStringArray(value.cells);
    case "fog.reset":
    case "draw.clear":
      return true;
    case "fog.config": return isRecord(value.patch);
    case "zone.paint": return typeof value.kind === "string" && isStringArray(value.cells) && (value.erase === undefined || typeof value.erase === "boolean");
    case "zone.glsl": return typeof value.kind === "string" && typeof value.body === "string";
    case "draw.add": return validDrawing(value.drawing);
    case "draw.allow": return typeof value.allow === "boolean";
    case "bg.set": return (value.src === undefined || value.src === null || typeof value.src === "string") && (value.patch === undefined || isRecord(value.patch));
    case "grid.set": return isRecord(value.patch);
    case "terrain.set": return value.terrain === null || isRecord(value.terrain);
    case "atmo.set": return isRecord(value.atmo);
    case "effect.add": return hasStringId(value.effect);
    case "scene.switch": return typeof value.sceneId === "string" && value.sceneId.length > 0;
  }
}

/** Apply an op to scene data in place. Scene-scoped only — `scene.switch` is
 *  handled a level up (it swaps the whole scene), so it's a no-op here. Returns
 *  true if the data changed. */
export function applyOp(d: VttSceneData, op: VttOp): boolean {
  switch (op.op) {
    case "token.add":
      if (!op.token.id || !Number.isFinite(op.token.x) || !Number.isFinite(op.token.y)) return false;
      if (d.tokens.some((t) => t.id === op.token.id)) return false;
      d.tokens.push(op.token);
      return true;
    case "token.move": {
      const t = d.tokens.find((x) => x.id === op.id);
      if (!t || !Number.isFinite(op.x) || !Number.isFinite(op.y) || (t.x === op.x && t.y === op.y)) return false;
      const dx = op.x - t.x;
      const dy = op.y - t.y;
      t.x = op.x;
      t.y = op.y;
      if (Math.hypot(dx, dy) > 2) t.facing = Math.atan2(dy, dx);
      return true;
    }
    case "token.update": {
      const t = d.tokens.find((x) => x.id === op.id);
      if (!t) return false;
      const patch = sanitizeTokenUpdatePatch(op.patch);
      let changed = false;
      for (const [field, value] of Object.entries(patch)) {
        if ((t as unknown as Record<string, unknown>)[field] !== value) changed = true;
      }
      if (!changed) return false;
      Object.assign(t, patch);
      return true;
    }
    case "token.assign": {
      const t = d.tokens.find((x) => x.id === op.id);
      if (!t) return false;
      const owner = op.owner || undefined;
      if (t.owner === owner && t.ownerPeer == null) return false;
      t.owner = owner;
      t.ownerPeer = undefined;
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
    case "light.ignite": {
      const l = d.lights.find((x) => x.id === op.id);
      if (!l || l.alwaysOn || !burnMechanicOn(d.fog)) return false;
      l.lit = true;
      l.litAt = Date.now();
      return true;
    }
    case "light.all": {
      if (!d.lights.length) return false;
      for (const l of d.lights) Object.assign(l, op.patch);
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
      if (!validDrawing(op.drawing) || list.length >= 500 || list.some((x) => x.id === op.drawing.id)) return false;
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
