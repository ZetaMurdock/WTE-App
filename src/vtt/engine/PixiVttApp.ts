// The VTT v2 engine: Pixi draws the map, React drives this class. One instance
// per mounted VttScreen; scene mutations happen here and are reported upward
// through onChanged/onSelect so React can persist + reflect UI state.
import { Application, Container } from "pixi.js";
import { Camera } from "./Camera";
import { InputController } from "./InputController";
import { BackgroundLayer } from "./layers/BackgroundLayer";
import { GridLayer } from "./layers/GridLayer";
import { TokenLayer } from "./layers/TokenLayer";
import { MeasurementLayer } from "./layers/MeasurementLayer";
import { newId, TOKEN_COLORS, type VttScene, type VttToken } from "../types/scene";
import type { VttTool } from "../types/tool";

export class PixiVttApp {
  readonly app = new Application();
  readonly world = new Container();
  readonly camera = new Camera(this.world);
  readonly bg = new BackgroundLayer();
  readonly grid = new GridLayer();
  readonly tokens = new TokenLayer();
  readonly measure = new MeasurementLayer();

  scene: VttScene | null = null;
  tool: VttTool = "select";
  selectedId: string | null = null;
  onChanged: () => void = () => {};
  onSelect: (id: string | null) => void = () => {};

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
    this.world.addChild(this.bg.view, this.grid.view, this.tokens.view, this.measure.view);
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
    this.tokens.sync(this.scene, this.selectedId);
  }

  setTool(t: VttTool): void {
    this.tool = t;
    this.measure.clear();
  }
  select(id: string | null): void {
    this.selectedId = id;
    this.onSelect(id);
    this.redraw();
  }
  snap(wx: number, wy: number): { x: number; y: number } {
    const s = this.scene?.data.grid.size ?? 70;
    return { x: (Math.floor(wx / s) + 0.5) * s, y: (Math.floor(wy / s) + 0.5) * s };
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
    this.select(t.id);
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
  deleteToken(id: string): void {
    if (!this.scene) return;
    this.scene.data.tokens = this.scene.data.tokens.filter((x) => x.id !== id);
    if (this.selectedId === id) this.select(null);
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
