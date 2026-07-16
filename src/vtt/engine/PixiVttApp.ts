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
import { AtmosphereLayer } from "./layers/AtmosphereLayer";
import { computeVisibleCells, pathBlocked } from "./systems/VisionSystem";
import { CustomShaderFilter, validateShaderBody, validateFragmentSource } from "./filters/CustomShaderFilter";
import { ZoneLayer, ZONE_DEFAULT_BODIES, buildZoneFragment } from "./layers/ZoneLayer";
import { ZONE_KINDS } from "../types/scene";
import { EffectSystem } from "./systems/EffectSystem";
import { TimelineSystem } from "./systems/TimelineSystem";
import { SimulationSystem } from "./systems/SimulationSystem";
import { EncounterSystem } from "./systems/EncounterSystem";
import {
  newId,
  TOKEN_COLORS,
  type VttAtmosphere,
  type VttBackground,
  type VttFogMode,
  type VttZoneKind,
  type VttEffectData,
  type VttEffectKind,
  type VttGrid,
  type VttTerrain,
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
  readonly atmosphere = new AtmosphereLayer();
  readonly zones = new ZoneLayer();

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
  /** A custom 2D GLSL chunk failed to compile (message is the GL info log). */
  onShaderError: (err: string) => void = () => {};
  /** A token finished a move (local drop/step or a remote peer's) — the host
   *  listens to detect border-portal crossings (multi-map links). */
  onTokenMoved: (id: string, x: number, y: number) => void = () => {};

  // Custom 2D shader filter on the background (scene atmosphere.shader.glsl).
  private shaderFilter: CustomShaderFilter | null = null;
  private shaderGlsl = "";
  private shaderT0 = 0;

  private input: InputController | null = null;
  private ready = false;
  private destroyed = false;

  async init(host: HTMLElement): Promise<void> {
    // WebGL explicitly: user-authored shader chunks are GLSL, which the WebGPU
    // backend can't run — pin the renderer so custom shaders always work.
    await this.app.init({ backgroundAlpha: 0, resizeTo: host, antialias: true, preference: "webgl" });
    // React StrictMode mounts, cleans up, and remounts: if destroy() ran while
    // app.init() was in flight, dispose here instead of attaching.
    if (this.destroyed) {
      this.app.destroy(true, { children: true });
      return;
    }
    host.appendChild(this.app.canvas);
    this.world.addChild(
      this.atmosphere.backdrop, // world void BEHIND the map (pans/zooms with it)
      this.bg.view,
      this.grid.view,
      this.zones.view, // painted effect zones sit on the map, under lights/tokens
      this.lights.view,
      this.effects.view,
      this.tokens.view,
      this.atmosphere.worldFx, // weather (mist + particles) OVER the map, in world space
      this.walls.view,
      this.walls.previewG,
      this.fog.view,
      this.measure.view
    );
    // Only the uniform post-grades (mood tint, vignette, height-fog, shadows) are
    // screen-space; the structured effects live in the world above.
    this.app.stage.addChild(this.world, this.atmosphere.view);
    this.input = new InputController(this);
    this.input.attach(this.app.canvas);
    // camera momentum + atmosphere animation each frame
    let fogTickAt = 0;
    this.app.ticker.add(() => {
      const was = this.camera.flinging;
      const moving = this.camera.tick(this.app.ticker.deltaTime);
      if (was && !moving) this.persistCamera();
      if (this.scene) this.atmosphere.animate(this.app.ticker.deltaMS / 1000, this.app.screen.width, this.app.screen.height);
      // Animate the custom 2D shader (uTime drives water/haze/pulse effects).
      if (this.shaderFilter) this.shaderFilter.tick((Date.now() - this.shaderT0) / 1000, this.app.screen.width, this.app.screen.height);
      // Animate painted zones + re-anchor their patterns to the world transform.
      if (this.zones.active && this.scene) {
        const o = this.world.toGlobal({ x: 0, y: 0 });
        this.zones.tick(performance.now() / 1000, o.x, o.y, this.world.scale.x, this.scene.data.grid.size);
      }
      // Realistic fog decays with TIME, not just mutations — repaint fog AND
      // lights twice a second so left areas sink back into the dark and burning
      // lanterns visibly dim toward nothing.
      const fog = this.scene?.data.fog;
      if (fog?.enabled && fog.mode === "realistic") {
        const now = Date.now();
        if (now - fogTickAt >= 500) {
          fogTickAt = now;
          this.lights.draw(this.scene!, this.selection, this.playerView && this.selfId ? this.selfId : undefined);
          this.fog.draw(this.scene!, this.visionOf() ?? new Set<string>(), this.playerView);
        }
      }
    });
    this.ready = true;
    if (this.scene) this.setScene(this.scene);
  }

  setScene(scene: VttScene): void {
    this.scene = scene;
    if (!this.ready) return;
    this.camera.set(scene.data.camera);
    this.redraw();
  }
  // Vision is O(sources × cells × walls) — cache it and recompute only when a
  // source crosses a cell (not on every drag-frame redraw).
  private visionKey = "";
  private visionCache: Set<string> | null = null;
  private visionOf(): Set<string> | null {
    const d = this.scene!.data;
    if (!(d.fog.enabled && d.layers.fog)) {
      this.visionKey = "";
      this.visionCache = null;
      return null;
    }
    const s = d.grid.size;
    const ownerId = this.playerView && this.selfId ? this.selfId : undefined;
    // Realistic fog: light burn-down + decay change with TIME — fold a 500ms
    // bucket into the key so the ticker's periodic redraw recomputes vision.
    const bucket = d.fog.mode === "realistic" ? Math.floor(Date.now() / 500) : 0;
    const key =
      (ownerId ?? "gm") +
      "|" +
      d.tokens
        .map(
          (t) =>
            `${Math.floor(t.x / s)},${Math.floor(t.y / s)},${t.vision ?? 5},${t.visible === false ? 0 : 1},${t.owner ?? ""},${
              t.facing == null ? "" : Math.round(t.facing * 100)
            }`
        )
        .join(";") +
      "|" +
      d.lights.map((l) => `${Math.round(l.x)},${Math.round(l.y)},${l.radius},${l.lit ? 1 : 0},${l.litAt ?? 0},${l.burnSeconds ?? 0}`).join(";") +
      `|${d.walls.length}|${s},${d.grid.cols},${d.grid.rows}|${d.fog.mode ?? "remembered"}|${bucket}`;
    if (key !== this.visionKey || !this.visionCache) {
      this.visionKey = key;
      this.visionCache = computeVisibleCells(d, ownerId);
    }
    return this.visionCache;
  }

  // (Re)apply the scene's custom 2D GLSL chunk to the background. String-guarded
  // so calling from every redraw is free; invalid chunks report via onShaderError
  // and leave the background unfiltered.
  private applyShader2D(): void {
    const glsl = (this.scene?.data.atmosphere?.shader?.glsl ?? "").trim();
    if (glsl === this.shaderGlsl) return;
    this.shaderGlsl = glsl;
    this.shaderFilter = null;
    this.bg.view.filters = [];
    if (!glsl) return;
    const err = validateShaderBody(glsl);
    if (err) {
      this.onShaderError(err);
      return;
    }
    try {
      this.shaderFilter = new CustomShaderFilter(glsl);
      this.shaderT0 = Date.now();
      this.bg.view.filters = [this.shaderFilter];
    } catch (e) {
      this.shaderFilter = null;
      this.bg.view.filters = [];
      this.onShaderError(String(e).slice(0, 500));
    }
  }

  // Custom zone-brush GLSL: validate each slot's body on THIS client and fall
  // back to the slot's built-in effect on error — a Curator's typo (or a chunk
  // this GPU rejects) can never black-hole a player's zones. String-guarded.
  private zoneGlslKey = "";
  private zoneValidCache = new Map<string, string | null>();
  private applyZoneGlsl(): void {
    const custom = this.scene?.data.zoneGlsl ?? {};
    const key = ZONE_KINDS.map((k) => custom[k] ?? "").join(" ");
    if (key === this.zoneGlslKey) return;
    this.zoneGlslKey = key;
    const effective = { ...ZONE_DEFAULT_BODIES };
    for (const k of ZONE_KINDS) {
      const body = (custom[k] ?? "").trim();
      if (!body) continue;
      let err = this.zoneValidCache.get(body);
      if (err === undefined) {
        err = validateFragmentSource(buildZoneFragment([body, "", ""]));
        this.zoneValidCache.set(body, err);
      }
      if (err) this.onShaderError(`Zone ${k}: ${err}`);
      else effective[k] = body;
    }
    this.zones.setBodies(effective);
  }

  redraw(): void {
    if (!this.scene || !this.ready) return;
    this.applyShader2D();
    this.applyZoneGlsl();
    const visible = this.visionOf();
    this.bg.draw(this.scene);
    this.grid.draw(this.scene);
    this.zones.draw(this.scene);
    this.lights.draw(this.scene, this.selection, this.playerView && this.selfId ? this.selfId : undefined);
    this.effects.draw(this.scene, this.selection);
    this.tokens.sync(this.scene, this.selection?.kind === "token" ? this.selection.id : null, this.playerView ? visible : null);
    this.walls.draw(this.scene, this.selection);
    this.fog.draw(this.scene, visible ?? new Set<string>(), this.playerView);
    this.atmosphere.draw(this.scene, this.app.screen.width, this.app.screen.height);
  }

  /** Player perspective: fog fully obscures unseen areas and hides tokens in
   *  them (GMs keep the semi-transparent reveal). Set from the netplay role. */
  playerView = false;
  selfId: string | null = null;
  setPlayerView(v: boolean, selfId: string | null = this.selfId): void {
    if (this.playerView === v && this.selfId === selfId) return;
    this.playerView = v;
    this.selfId = selfId;
    this.redraw();
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
  /** World coords under a pointer's client (page) position — for click-to-place. */
  clientToWorld(clientX: number, clientY: number): { x: number; y: number } {
    const r = this.app.canvas.getBoundingClientRect();
    return this.camera.screenToWorld(clientX - r.left, clientY - r.top);
  }
  /** World coords at the centre of the current viewport (fallback AoE drop point). */
  viewCenterWorld(): { x: number; y: number } {
    const cw = this.app.canvas.clientWidth || this.app.renderer.width;
    const ch = this.app.canvas.clientHeight || this.app.renderer.height;
    return this.camera.screenToWorld(cw / 2, ch / 2);
  }
  /** Place an ability's area template and size it in one step, leaving it SELECTED
   *  so the caster can nudge/resize it on the fly. Size is in grid cells. */
  placeAoeAt(kind: VttEffectKind, wx: number, wy: number, opts: { cells?: number; rounds?: number; color?: string }): void {
    this.addEffectAt(kind, wx, wy);
    const sel = this.selection;
    if (sel?.kind !== "effect") return;
    const patch: Partial<VttEffectData> = {};
    if (opts.cells != null) {
      // Zones size both dimensions; everything else uses `radius` as its main
      // size (line length / ring outer / cross arm), keeping default thickness.
      if (kind === "zone") {
        patch.w = opts.cells;
        patch.h = opts.cells;
      } else {
        patch.radius = opts.cells;
      }
    }
    if (opts.rounds != null) patch.rounds = opts.rounds;
    if (opts.color) patch.color = opts.color;
    if (Object.keys(patch).length) this.updateEffect(sel.id, patch);
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
  /** (Re)light a lantern — realistic fog only. Clicking an already-burning one
   *  refreshes it to full ("until it has been relit again"). Synced. */
  igniteLight(id: string): void {
    if (this.scene?.data.fog.mode !== "realistic") return;
    this.updateLight(id, { lit: true, litAt: Date.now() });
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
  /** Active zone brush ({kind, erase}) — the "zone" tool paints with it. */
  zoneBrush: { kind: VttZoneKind; erase: boolean } | null = null;
  /** Paint (or erase) the zone cell under a world point with the active brush. */
  paintZoneAt(wx: number, wy: number): void {
    if (!this.scene || !this.zoneBrush) return;
    const g = this.scene.data.grid;
    const c = Math.floor(wx / g.size);
    const r = Math.floor(wy / g.size);
    if (c < 0 || r < 0 || c >= g.cols || r >= g.rows) return;
    const key = `${c},${r}`;
    const { kind, erase } = this.zoneBrush;
    const zones = (this.scene.data.zones ??= {});
    const arr = zones[kind] ?? [];
    const has = arr.includes(key);
    if (erase ? !has : has) return; // no-op stroke over the same cell
    zones[kind] = erase ? arr.filter((k) => k !== key) : [...arr, key];
    this.redraw();
    this.onChanged();
    this.onOp({ op: "zone.paint", kind, cells: [key], erase });
  }
  /** Set (or clear, with "") a zone slot's custom GLSL body — validated on
   *  apply on every client, synced, persisted with the scene. */
  setZoneGlsl(kind: VttZoneKind, body: string): void {
    if (!this.scene) return;
    const zg = (this.scene.data.zoneGlsl ??= {});
    if ((zg[kind] ?? "") === body) return;
    zg[kind] = body;
    this.redraw();
    this.onChanged();
    this.onOp({ op: "zone.glsl", kind, body });
  }
  /** Clear every cell of one zone kind (synced). */
  clearZone(kind: VttZoneKind): void {
    const zones = this.scene?.data.zones;
    const cells = zones?.[kind];
    if (!zones || !cells?.length) return;
    zones[kind] = [];
    this.redraw();
    this.onChanged();
    this.onOp({ op: "zone.paint", kind, cells, erase: true });
  }

  /** Wipe exploration progress — every visited area goes back to unexplored dark. */
  resetFog(): void {
    if (!this.scene) return;
    const f = this.scene.data.fog;
    if (f.revealed.length === 0 && !f.seen) return;
    f.revealed = [];
    f.seen = undefined;
    this.redraw();
    this.onChanged();
    this.onOp({ op: "fog.reset" });
  }
  /** Change the fog darkness level / decay speed (Curator, synced). */
  setFogConfig(patch: { mode?: VttFogMode; decaySeconds?: number }): void {
    if (!this.scene) return;
    Object.assign(this.scene.data.fog, patch);
    this.redraw();
    this.onChanged();
    this.onOp({ op: "fog.config", patch });
  }
  /** Set (or clear) the scene's map-background image. */
  setBackground(src: string | null): void {
    this.setBackgroundProps({ src: src || undefined });
  }
  /** Patch background properties (src / fit / scale / position). */
  setBackgroundProps(patch: Partial<VttBackground>): void {
    if (!this.scene) return;
    Object.assign(this.scene.data.background, patch);
    this.redraw();
    this.onChanged();
    this.onOp({ op: "bg.set", patch });
  }
  /** Patch the grid (cell size / cols / rows / visibility) — Curator resize. */
  setGrid(patch: Partial<VttGrid>): void {
    if (!this.scene) return;
    Object.assign(this.scene.data.grid, patch);
    this.redraw();
    this.onChanged();
    this.onOp({ op: "grid.set", patch });
  }
  /** Set (or clear) the terrain heightmap (renders in the 3D view). */
  setTerrain(terrain: VttTerrain | null): void {
    if (!this.scene) return;
    this.scene.data.terrain = terrain;
    this.onChanged();
    this.onOp({ op: "terrain.set", terrain });
  }
  /** Set the 3D atmosphere (backdrop / fog / mist / particles / mood / shadows). */
  setAtmosphere(atmo: VttAtmosphere): void {
    if (!this.scene) return;
    this.scene.data.atmosphere = atmo;
    this.redraw();
    this.onChanged();
    this.onOp({ op: "atmo.set", atmo });
  }
  /** MOVEMENT collision — true when the straight path crosses any wall. */
  moveBlocked(sx: number, sy: number, tx: number, ty: number): boolean {
    return this.scene ? pathBlocked(this.scene.data.walls, sx, sy, tx, ty) : false;
  }
  moveToken(id: string, wx: number, wy: number, snap: boolean): void {
    const t = this.scene?.data.tokens.find((x) => x.id === id);
    if (!t) return;
    const p = snap ? this.snap(wx, wy) : { x: wx, y: wy };
    t.x = p.x;
    t.y = p.y;
    this.redraw();
    // Broadcast the final resting place only (on drop) — not every drag frame.
    if (snap) {
      this.onOp({ op: "token.move", id, x: t.x, y: t.y });
      this.onTokenMoved(id, t.x, t.y);
    }
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
    // Portal detection is host-side: a player's move must trigger links too.
    if (op.op === "token.move") this.onTokenMoved(op.id, op.x, op.y);
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
