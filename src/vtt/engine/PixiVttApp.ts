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
import { computeVisibleCells } from "./systems/VisionSystem";
import { newId, TOKEN_COLORS, type VttLight, type VttScene, type VttToken, type VttWall } from "../types/scene";
import type { VttTool } from "../types/tool";

export type VttSelection = { kind: "token" | "wall" | "light"; id: string } | null;

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

  scene: VttScene | null = null;
  tool: VttTool = "select";
  selection: VttSelection = null;
  onChanged: () => void = () => {};
  onSelect: (sel: VttSelection) => void = () => {};

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
    return t;
  }
  addWall(x1: number, y1: number, x2: number, y2: number): void {
    if (!this.scene || (x1 === x2 && y1 === y2)) return;
    const w: VttWall = { id: newId("wl"), x1, y1, x2, y2, blocksLight: true };
    this.scene.data.walls.push(w);
    this.select({ kind: "wall", id: w.id });
    this.onChanged();
  }
  addLightAt(wx: number, wy: number): void {
    if (!this.scene) return;
    const p = this.snap(wx, wy);
    const l: VttLight = { id: newId("lt"), x: p.x, y: p.y, radius: 6, color: "#a08a4f", intensity: 0.5 };
    this.scene.data.lights.push(l);
    this.select({ kind: "light", id: l.id });
    this.onChanged();
  }
  updateWall(id: string, patch: Partial<VttWall>): void {
    const w = this.scene?.data.walls.find((x) => x.id === id);
    if (!w) return;
    Object.assign(w, patch);
    this.redraw();
    this.onChanged();
  }
  updateLight(id: string, patch: Partial<VttLight>): void {
    const l = this.scene?.data.lights.find((x) => x.id === id);
    if (!l) return;
    Object.assign(l, patch);
    this.redraw();
    this.onChanged();
  }
  deleteSelected(): void {
    if (!this.scene || !this.selection) return;
    const { kind, id } = this.selection;
    const d = this.scene.data;
    if (kind === "token") d.tokens = d.tokens.filter((x) => x.id !== id);
    if (kind === "wall") d.walls = d.walls.filter((x) => x.id !== id);
    if (kind === "light") d.lights = d.lights.filter((x) => x.id !== id);
    this.select(null);
    this.onChanged();
  }
  toggleFog(): void {
    if (!this.scene) return;
    this.scene.data.fog.enabled = !this.scene.data.fog.enabled;
    this.redraw();
    this.onChanged();
  }
  moveToken(id: string, wx: number, wy: number, snap: boolean): void {
    const t = this.scene?.data.tokens.find((x) => x.id === id);
    if (!t) return;
    const p = snap ? this.snap(wx, wy) : { x: wx, y: wy };
    t.x = p.x;
    t.y = p.y;
    this.redraw();
  }
  updateToken(id: string, patch: Partial<VttToken>): void {
    if (!this.scene) return;
    const t = this.scene.data.tokens.find((x) => x.id === id);
    if (!t) return;
    Object.assign(t, patch);
    this.redraw();
    this.onChanged();
  }
  persistCamera(): void {
    if (!this.scene) return;
    this.scene.data.camera = this.camera.state();
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
