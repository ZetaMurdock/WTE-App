// The VTT v2 engine: Pixi draws the map, React drives this class. One instance
// per mounted VttScreen; scene mutations happen here and are reported upward
// through onChanged/onSelect so React can persist + reflect UI state.
import { Application, Container } from "pixi.js";
import { Camera } from "./Camera";
import { InputController } from "./InputController";
import { BackgroundLayer } from "./layers/BackgroundLayer";
import { GridLayer } from "./layers/GridLayer";
import { TokenLayer } from "./layers/TokenLayer";
import { WallLayer } from "./layers/WallLayer";
import { LightingLayer } from "./layers/LightingLayer";
import { FogLayer } from "./layers/FogLayer";
import { MeasurementLayer } from "./layers/MeasurementLayer";
import { EffectLayer } from "./layers/EffectLayer";
import { computeVisibleCells } from "./systems/VisionSystem";
import { EffectSystem } from "./systems/EffectSystem";
import { TimelineSystem } from "./systems/TimelineSystem";
import { SimulationSystem } from "./systems/SimulationSystem";
import { EncounterSystem } from "./systems/EncounterSystem";
import {
  newId,
  TOKEN_COLORS,
  type VttEffectData,
  type VttEffectKind,
  type VttLight,
  type VttScene,
  type VttToken,
  type VttWall,
} from "../types/scene";
import { applyOp, type VttOp } from "../sync/patches";
import type { VttTool } from "../types/tool";

export type VttSelection = { kind: "token" | "wall" | "light" | "effect"; id: string } | null;

export class PixiVttApp {
  readonly app = new Application();
  readonly world = new Container();
  readonly camera = new Camera(this.world);
  readonly bg = new BackgroundLayer();
  readonly grid = new GridLayer();
  readonly lights = new LightingLayer();
  readonly tokens = new TokenLayer();
  readonly walls = new WallLayer();
  readonly fog = new FogLayer();
  readonly measure = new MeasurementLayer();
  readonly effects = new EffectLayer();

  // Engine systems (slice 12). Encounter round advance runs timeline + sim.
  readonly effectSystem = new EffectSystem();
  readonly timeline = new TimelineSystem();
  readonly sim = new SimulationSystem();
  readonly encounterSystem = new EncounterSystem(this.timeline, this.sim);

  scene: VttScene | null = null;
  tool: VttTool = "select";
  selection: VttSelection = null;
  onChanged: () => void = () => {};
  onSelect: (sel: VttSelection) => void = () => {};
  /** Emitted on each LOCAL scene mutation for P2P sync (slice 10). Remote ops
   *  arrive via applyRemote(), which never calls this — so no echo loops. */
  onOp: (op: VttOp) => void = () => {};

  private input: InputController | null = null;
  private ready = false;
  private destroyed = false;

  async init(host: HTMLElement): Promise<void> {
    await this.app.init({ backgroundAlpha: 0, resizeTo: host, antialias: true });
    // React StrictMode mounts, cleans up, and remounts: if destroy() ran while
    // app.init() was in flight, dispose here instead of attaching.
    if (this.destroyed) {
      this.app.destroy(true, { children: true });
      return;
    }
    host.appendChild(this.app.canvas);
    this.world.addChild(
      this.bg.view,
      this.grid.view,
      this.lights.view,
      this.effects.view,
      this.tokens.view,
      this.walls.view,
      this.walls.previewG,
      this.fog.view,
      this.measure.view
    );
    this.app.stage.addChild(this.world);
    this.input = new InputController(this);
    this.input.attach(this.app.canvas);
    this.ready = true;
    if (this.scene) this.setScene(this.scene);
  }

  setScene(scene: VttScene): void {
    this.scene = scene;
    if (!this.ready) return;
    this.camera.set(scene.data.camera);
    this.redraw();
  }
  redraw(): void {
    if (!this.scene || !this.ready) return;
    this.bg.draw(this.scene);
    this.grid.draw(this.scene);
    this.lights.draw(this.scene, this.selection);
    this.effects.draw(this.scene, this.selection);
    this.tokens.sync(this.scene, this.selection?.kind === "token" ? this.selection.id : null);
    this.walls.draw(this.scene, this.selection);
    this.fog.draw(this.scene, computeVisibleCells(this.scene.data));
  }

  setTool(t: VttTool): void {
    this.tool = t;
    this.measure.clear();
    this.walls.clearPreview();
  }
  select(sel: VttSelection): void {
    this.selection = sel;
    this.onSelect(sel);
    this.redraw();
  }
  snap(wx: number, wy: number): { x: number; y: number } {
    const s = this.scene?.data.grid.size ?? 70;
    return { x: (Math.floor(wx / s) + 0.5) * s, y: (Math.floor(wy / s) + 0.5) * s };
  }
  /** Snap to the nearest grid intersection (wall endpoints). */
  snapVertex(wx: number, wy: number): { x: number; y: number } {
    const s = this.scene?.data.grid.size ?? 70;
    return { x: Math.round(wx / s) * s, y: Math.round(wy / s) * s };
  }
  addTokenAt(wx: number, wy: number): void {
    if (!this.scene) return;
    const p = this.snap(wx, wy);
    const n = this.scene.data.tokens.length;
    const t: VttToken = {
      id: newId("tk"),
      name: `Token ${n + 1}`,
      x: p.x,
      y: p.y,
      size: 1,
      color: TOKEN_COLORS[n % TOKEN_COLORS.length],
      visible: true,
    };
    this.scene.data.tokens.push(t);
    this.select({ kind: "token", id: t.id });
    this.onChanged();
    this.onOp({ op: "token.add", token: t });
  }
  /** Place a (possibly linked) token at the current view centre, fanning out to
   *  the nearest free cell so repeated spawns don't stack. Used by the Actors
   *  panel and the Codex creature-spawn bridge. */
  spawnToken(spec: Partial<VttToken>): VttToken | null {
    if (!this.scene) return null;
    const s = this.scene.data.grid.size;
    const cw = this.app.canvas.clientWidth || this.app.renderer.width;
    const ch = this.app.canvas.clientHeight || this.app.renderer.height;
    const wc = this.camera.screenToWorld(cw / 2, ch / 2);
    const center = this.snap(wc.x, wc.y);
    const ccol = Math.round(center.x / s);
    const crow = Math.round(center.y / s);
    const occupied = new Set(this.scene.data.tokens.map((t) => `${Math.round(t.x / s)},${Math.round(t.y / s)}`));
    let px = center.x;
    let py = center.y;
    scan: for (let ring = 0; ring < 8; ring++) {
      for (let dx = -ring; dx <= ring; dx++) {
        for (let dy = -ring; dy <= ring; dy++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue;
          if (!occupied.has(`${ccol + dx},${crow + dy}`)) {
            px = (ccol + dx + 0.5) * s;
            py = (crow + dy + 0.5) * s;
            break scan;
          }
        }
      }
    }
    const n = this.scene.data.tokens.length;
    const t: VttToken = {
      visible: true,
      size: 1,
      color: TOKEN_COLORS[n % TOKEN_COLORS.length],
      name: `Token ${n + 1}`,
      ...spec,
      id: newId("tk"),
      x: px,
      y: py,
    };
    this.scene.data.tokens.push(t);
    this.select({ kind: "token", id: t.id });
    this.onChanged();
    this.onOp({ op: "token.add", token: t });
    return t;
  }
  addWall(x1: number, y1: number, x2: number, y2: number): void {
    if (!this.scene || (x1 === x2 && y1 === y2)) return;
    const w: VttWall = { id: newId("wl"), x1, y1, x2, y2, blocksLight: true };
    this.scene.data.walls.push(w);
    this.select({ kind: "wall", id: w.id });
    this.onChanged();
    this.onOp({ op: "wall.add", wall: w });
  }
  addLightAt(wx: number, wy: number): void {
    if (!this.scene) return;
    const p = this.snap(wx, wy);
    const l: VttLight = { id: newId("lt"), x: p.x, y: p.y, radius: 6, color: "#a08a4f", intensity: 0.5 };
    this.scene.data.lights.push(l);
    this.select({ kind: "light", id: l.id });
    this.onChanged();
    this.onOp({ op: "light.add", light: l });
  }
  addEffectAt(kind: VttEffectKind, wx: number, wy: number): void {
    if (!this.scene) return;
    const round = this.scene.data.timeline.round || 0;
    // zones anchor top-left at the clicked cell corner; circles/cones at the centre.
    const p = kind === "zone" ? this.snapVertex(wx, wy) : this.snap(wx, wy);
    const e = this.effectSystem.create(kind, p.x, p.y, round);
    this.scene.data.effects.push(e);
    this.select({ kind: "effect", id: e.id });
    this.onChanged();
    this.onOp({ op: "effect.add", effect: e });
  }
  updateEffect(id: string, patch: Partial<VttEffectData>): void {
    const e = this.scene?.data.effects.find((x) => x.id === id);
    if (!e) return;
    Object.assign(e.data, patch);
    this.redraw();
    this.onChanged();
    this.onOp({ op: "effect.update", id, patch });
  }
  /** Change an effect's kind in place (reseeds the shape defaults, keeps colour /
   *  lifetime / status). Syncs as a remove + re-add of the same id. */
  setEffectKind(id: string, kind: VttEffectKind): void {
    const d = this.scene?.data;
    if (!d) return;
    const idx = d.effects.findIndex((e) => e.id === id);
    if (idx < 0 || d.effects[idx].kind === kind) return;
    const old = d.effects[idx];
    const next = this.effectSystem.create(kind, old.x, old.y, old.data.bornRound ?? 0);
    next.id = old.id;
    next.data.color = old.data.color;
    next.data.rounds = old.data.rounds;
    next.data.status = old.data.status;
    d.effects[idx] = next;
    this.redraw();
    this.onChanged();
    this.onOp({ op: "effect.remove", id });
    this.onOp({ op: "effect.add", effect: next });
  }
  updateWall(id: string, patch: Partial<VttWall>): void {
    const w = this.scene?.data.walls.find((x) => x.id === id);
    if (!w) return;
    Object.assign(w, patch);
    this.redraw();
    this.onChanged();
    this.onOp({ op: "wall.update", id, patch });
  }
  updateLight(id: string, patch: Partial<VttLight>): void {
    const l = this.scene?.data.lights.find((x) => x.id === id);
    if (!l) return;
    Object.assign(l, patch);
    this.redraw();
    this.onChanged();
    this.onOp({ op: "light.update", id, patch });
  }
  deleteSelected(): void {
    if (!this.scene || !this.selection) return;
    const { kind, id } = this.selection;
    const d = this.scene.data;
    if (kind === "token") d.tokens = d.tokens.filter((x) => x.id !== id);
    if (kind === "wall") d.walls = d.walls.filter((x) => x.id !== id);
    if (kind === "light") d.lights = d.lights.filter((x) => x.id !== id);
    if (kind === "effect") d.effects = d.effects.filter((x) => x.id !== id);
    this.select(null);
    this.onChanged();
    if (kind === "token") this.onOp({ op: "token.remove", id });
    else if (kind === "wall") this.onOp({ op: "wall.remove", id });
    else if (kind === "light") this.onOp({ op: "light.remove", id });
    else if (kind === "effect") this.onOp({ op: "effect.remove", id });
  }
  toggleFog(): void {
    if (!this.scene) return;
    this.scene.data.fog.enabled = !this.scene.data.fog.enabled;
    this.redraw();
    this.onChanged();
    this.onOp({ op: "fog.set", enabled: this.scene.data.fog.enabled });
  }
  /** Set (or clear) the scene's map-background image. */
  setBackground(src: string | null): void {
    if (!this.scene) return;
    this.scene.data.background.src = src || undefined;
    this.redraw();
    this.onChanged();
    this.onOp({ op: "bg.set", src: src || null });
  }
  moveToken(id: string, wx: number, wy: number, snap: boolean): void {
    const t = this.scene?.data.tokens.find((x) => x.id === id);
    if (!t) return;
    const p = snap ? this.snap(wx, wy) : { x: wx, y: wy };
    t.x = p.x;
    t.y = p.y;
    this.redraw();
    // Broadcast the final resting place only (on drop) — not every drag frame.
    if (snap) this.onOp({ op: "token.move", id, x: t.x, y: t.y });
  }
  updateToken(id: string, patch: Partial<VttToken>): void {
    if (!this.scene) return;
    const t = this.scene.data.tokens.find((x) => x.id === id);
    if (!t) return;
    Object.assign(t, patch);
    this.redraw();
    this.onChanged();
    this.onOp({ op: "token.update", id, patch });
  }
  persistCamera(): void {
    if (!this.scene) return;
    this.scene.data.camera = this.camera.state();
    this.onChanged();
  }
  /** Link (or unlink) the scene's active encounter. */
  setEncounterId(id: string | null): void {
    if (!this.scene) return;
    this.scene.data.encounterId = id;
    this.onChanged();
  }
  /** Mirror the encounter's round/turn into the scene timeline. When the round
   *  advances, run the engine systems (expire timed effects + zone-status sim). */
  setTimeline(round: number, turn: number): void {
    if (!this.scene) return;
    const prevRound = this.scene.data.timeline.round;
    this.scene.data.timeline = { round, turn };
    if (round !== prevRound && round > 0) {
      const changed = this.encounterSystem.onRound(this.scene.data, round, this.scene.data.grid.size);
      if (changed) this.redraw();
    }
    this.onChanged();
  }
  /** Apply a remote op from a peer. Mutates the scene without re-emitting (no
   *  onOp call here → no echo loop) and persists locally. scene.switch is handled
   *  by the sync layer, so it never reaches this method. */
  applyRemote(op: VttOp): void {
    if (!this.scene) return;
    const changed = applyOp(this.scene.data, op);
    if (!changed) return;
    // If the selected entity was removed remotely, drop the stale selection.
    if (op.op.endsWith(".remove") && this.selection && "id" in op && this.selection.id === op.id) {
      this.select(null);
    } else {
      this.redraw();
    }
    this.onChanged();
  }

  destroy(): void {
    this.destroyed = true;
    this.input?.detach();
    if (this.ready) {
      this.ready = false;
      this.app.destroy(true, { children: true });
    }
    // if init() is still awaiting, its continuation disposes the app
  }
}
