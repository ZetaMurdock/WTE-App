// The VTT v2 engine: Pixi draws the map, React drives this class. One instance
// per mounted VttScreen; scene mutations happen here and are reported upward
// through onChanged/onSelect so React can persist + reflect UI state.
// FIRST, before any other Pixi import. Pixi v8 generates its uniform-sync and
// buffer code with `new Function`, which the packaged app's CSP forbids —
// script-src has no unsafe-eval, deliberately (Phase 1 closed the code-execution
// chain in shared content, and eval is that chain's front door). Without this
// import the renderer THREW during init in production only: dev applies no CSP,
// the browser preview applies no CSP, every test passed — and the packaged VTT
// was a black void with the failure swallowed. This entry installs Pixi's
// CSP-safe implementations instead; the strict CSP stays exactly as it is.
import "pixi.js/unsafe-eval";
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
import { computeVisibleCells, lightVisibleTo, pathBlocked } from "./systems/VisionSystem";
import { burnMechanicOn } from "./systems/lightState";
import { CustomShaderFilter, validateShaderBody, validateFragmentSource } from "./filters/CustomShaderFilter";
import { ZoneLayer, ZONE_DEFAULT_BODIES, buildZoneFragment } from "./layers/ZoneLayer";
import { DrawingLayer } from "./layers/DrawingLayer";
import { EmitterLayer } from "./layers/EmitterLayer";
import { PingLayer } from "./layers/PingLayer";
import { SpatialAudioEngine } from "./systems/spatialAudio";
import { EnvFxFilter } from "./filters/EnvFxFilter";
import { pickEnvFx } from "./systems/envFx";
import { ZONE_KINDS } from "../types/scene";
import { EffectSystem } from "./systems/EffectSystem";
import { TimelineSystem } from "./systems/TimelineSystem";
import { SimulationSystem } from "./systems/SimulationSystem";
import { EncounterSystem, type RecurringProposalSink } from "./systems/EncounterSystem";
import { ConditionClockSystem } from "./systems/ConditionClockSystem";
import {
  commitTokenCounter,
  planClearTokenCounter,
  planTokenCounter,
  pruneCounterTracks,
  tracksOfToken,
  type TokenCounterApplication,
  type TokenCounterPlan,
} from "../data/tokenCounters";
import type { CounterTrack } from "../../game/counterTracks";
import { dismissibleSummonBodies, duplicateSummonIds } from "../data/summonPlacement";
import { RecurringEffectSystem } from "./systems/RecurringEffectSystem";
import { bindAura, dropOrphanAuras, reanchorAuras, unbindAura } from "./systems/AuraSystem";
import {
  newId,
  TOKEN_COLORS,
  type VttAtmosphere,
  type VttBackground,
  type VttConditionClock,
  type VttFogMode,
  type VttZoneKind,
  type VttEffectData,
  type VttEffectKind,
  type VttEffectTick,
  type VttEmitter,
  type VttGrid,
  type VttTerrain,
  type VttLight,
  type VttScene,
  type VttToken,
  type VttWall,
  type VttCounterTrack,
  type VttEffect,
} from "../types/scene";
import { applyOp, sanitizePlayerTokenUpdatePatch, sanitizeTokenUpdatePatch, sanitizeTokenVitalsPatch, type VttOp } from "../sync/patches";
import { canControlToken as tokenControlAllowed } from "../sync/tokenPermissions";
import { canOccupy, nearestFreeCell } from "../data/occupancy";
import type { VttTool } from "../types/tool";
import { vttSnapshotFits } from "../sync/wireBudget";

export type VttSelection = { kind: "token" | "wall" | "light" | "effect" | "emitter"; id: string } | null;

/** A peer's ink color (drawings, pings): the Curator is gold, every player a
 *  stable hue hashed from their peer id — same everywhere on every client. */
export function peerInkColor(id: string | null, curator: boolean): string {
  if (curator || !id) return "#d8b25a";
  const palette = ["#7ecfca", "#e08fbe", "#8fb6e0", "#9fe07a", "#e0b57a", "#b39fe0"];
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return palette[h % palette.length];
}

/**
 * What a placement carries beyond shape and size.
 *
 * Named rather than inlined because the caller has to be able to HOLD one: the
 * AoE prompt's "click" mode arms the cursor and lands the template on a later
 * pointer event, so whatever the page declared has to survive in React state
 * between the two. It did not, once — the click path built its own two-field
 * object and dropped the declared block on the floor.
 */
export interface PlaceAoeOptions {
  cells?: number;
  rounds?: number;
  color?: string;
  /** The tag `In zone:` hands to whoever is standing inside. */
  status?: string;
  label?: string;
  /** The `Each round:` lines this template keeps firing. */
  ticks?: VttEffectTick[];
  /** Provenance, so a recurring card can name the ability that caused it. */
  sourceAbilityId?: string;
  sourceAbilityName?: string;
  casterCharacterId?: string;
  /** `attach self` — the token this template rides from here on. */
  auraTokenId?: string;
}

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
  readonly drawings = new DrawingLayer();
  readonly emitters = new EmitterLayer();
  readonly pings = new PingLayer();
  // Spatial-sound playback (distance falloff + wall muffling), synced from the ticker.
  readonly spatial = new SpatialAudioEngine();

  // Engine systems (slice 12). Encounter round advance runs timeline + sim.
  readonly effectSystem = new EffectSystem();
  readonly timeline = new TimelineSystem();
  readonly sim = new SimulationSystem();
  readonly conditions = new ConditionClockSystem();
  readonly recurring = new RecurringEffectSystem();
  readonly encounterSystem = new EncounterSystem(this.timeline, this.sim, this.conditions, this.recurring);

  scene: VttScene | null = null;
  tool: VttTool = "select";
  selection: VttSelection = null;
  onChanged: () => void = () => {};
  onSelect: (sel: VttSelection) => void = () => {};
  /** Emitted on each LOCAL scene mutation for P2P sync (slice 10). Remote ops
   *  arrive via applyRemote(), which never calls this — so no echo loops. */
  onOp: (op: VttOp) => void = () => {};
  /** Applied remote mutations are not re-emitted, but persistence layers may
   * still need to update campaign-global token metadata. */
  onRemoteApplied: (op: VttOp) => void = () => {};
  /** A custom 2D GLSL chunk failed to compile (message is the GL info log). */
  onShaderError: (err: string) => void = () => {};
  /** A local media mutation would make the scene impossible to send. */
  onSceneBudgetError: () => void = () => {};
  /** A token finished a move (local drop/step or a remote peer's) — the host
   *  listens to detect border-portal crossings (multi-map links). */
  onTokenMoved: (id: string, x: number, y: number) => void = () => {};
  /** Movement intent leaves the renderer without mutating scene state. React's
   * sync layer validates it locally or asks the authoritative host. */
  onMoveRequested: (id: string, fromX: number, fromY: number, toX: number, toY: number) => void = () => {};
  /** THIS client pinged the map (double-click) — React broadcasts it. */
  onPing: (x: number, y: number) => void = () => {};
  /** A round's worth of recurring effect ticks, for React to open Resolution
   *  Cards from. PROPOSALS: the engine has already refused to apply them, which
   *  is the whole reason they leave the engine at all. */
  onRecurring: RecurringProposalSink = () => {};

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
      this.emitters.view, // spatial-sound handles (Curator-only)
      this.effects.view,
      this.tokens.view,
      this.drawings.view, // annotations ride above tokens so arrows/marks stay readable
      this.drawings.previewG,
      this.atmosphere.worldFx, // weather (mist + particles) OVER the map, in world space
      this.walls.view,
      this.walls.previewG,
      this.fog.view,
      this.pings.view, // "look here" pulses read over everything, even fog
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
      if (this.pings.active) this.pings.tick();
      // Environmental FX: recompute the winning ambient effect for this client's
      // listener every frame (cheap; a few emitters) so proximity ramps live and
      // the effect animates smoothly.
      if (this.scene) this.updateEnvFx();
      // Cinematic Mode: animate the screen effect, follow the spotlit token
      // (players), and jitter the frame for shake — re-applying the camera
      // first so the offset never accumulates.
      if (this.cineFilter) this.cineFilter.tick((Date.now() - this.cineT0) / 1000, this.app.screen.width, this.app.screen.height);
      if (this.cineState.on) {
        if (this.playerView && this.cineState.tokenId) {
          const t = this.scene?.data.tokens.find((x) => x.id === this.cineState.tokenId);
          if (t) this.centerOn(t.x, t.y);
        }
        if (this.cineState.shake > 0) {
          this.camera.apply();
          const s = this.cineState.shake * 9;
          this.world.position.x += (Math.random() * 2 - 1) * s;
          this.world.position.y += (Math.random() * 2 - 1) * s;
        }
      }
      // Spatial sound follows the listener a few times a second — token moves,
      // camera pans, and wall edits all re-mix without any explicit hook.
      const nowMs = performance.now();
      if (this.scene && nowMs - this.spatialAt >= 250) {
        this.spatialAt = nowMs;
        const d = this.scene.data;
        this.spatial.sync(d.emitters ?? [], this.listenerWorld(), d.walls, d.grid.size);
      }
      // Nothing in the world POPS: lights, tokens and fog cells all ease toward
      // their target, so while any of them is still travelling we keep
      // repainting. (Realistic fog additionally repaints on a 500ms beat so
      // time-based decay and lantern burn-down keep moving on their own.)
      const dt = Math.min(0.05, this.app.ticker.deltaMS / 1000);
      const fog = this.scene?.data.fog;
      const easing = !this.lights.settled || !this.tokens.settled || !this.fog.settled;
      let beat = false;
      if (fog?.enabled && fog.mode === "realistic") {
        const now = Date.now();
        if (now - fogTickAt >= 500) {
          fogTickAt = now;
          beat = true;
        }
      }
      if (this.scene && (easing || beat)) {
        const visible = this.visionOf();
        this.lights.draw(this.scene, this.selection, this.playerView && this.selfId ? this.selfId : undefined, dt);
        this.tokens.sync(this.scene, this.selection?.kind === "token" ? this.selection.id : null, this.playerView ? visible : null, dt);
        this.fog.draw(this.scene, visible ?? new Set<string>(), this.playerView, dt);
      }
    });
    this.ready = true;
    if (this.scene) this.setScene(this.scene);
  }

  setScene(scene: VttScene): void {
    this.scene = scene;
    // A scene arriving from disk or a peer may carry clocks for tokens it no
    // longer has (deleted while the map was closed, or dropped by the sender's
    // own edit). Left in place they would tick against ids that do not exist.
    this.pruneConditionClocks();
    // Same hazard for the same reason: a track whose token was deleted while the
    // map was closed has nothing left to count, and its pip is already gone.
    this.pruneCounters();
    if (!this.ready) return;
    this.app.stage.visible = true;
    this.camera.set(scene.data.camera);
    this.redraw();
  }
  clearScene(): void {
    this.scene = null;
    this.selection = null;
    this.onSelect(null);
    if (this.ready) this.app.stage.visible = false;
  }
  /** Where spatial sound is heard FROM: a player's own token (no token = hears
   *  nothing), the Curator's camera centre. */
  private spatialAt = 0;
  private listenerWorld(): { x: number; y: number } | null {
    if (!this.scene) return null;
    if (this.playerView && this.selfId) {
      const own = this.scene.data.tokens.find((t) => t.owner === this.selfId && t.visible !== false);
      return own ? { x: own.x, y: own.y } : null;
    }
    return this.viewCenterWorld();
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
    const key = ZONE_KINDS.map((k) => custom[k] ?? "").join("\u0000");
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
    this.drawings.draw(this.scene);
    this.lights.draw(this.scene, this.selection, this.playerView && this.selfId ? this.selfId : undefined);
    this.emitters.draw(this.scene, this.selection, this.playerView);
    this.effects.draw(this.scene, this.selection);
    this.tokens.sync(this.scene, this.selection?.kind === "token" ? this.selection.id : null, this.playerView ? visible : null);
    this.walls.draw(this.scene, this.selection, this.playerView);
    this.fog.draw(this.scene, visible ?? new Set<string>(), this.playerView);
    this.atmosphere.draw(this.scene, this.app.screen.width, this.app.screen.height);
  }

  /** Player perspective: fog fully obscures unseen areas and hides tokens in
   *  them (GMs keep the semi-transparent reveal). Set from the netplay role. */
  playerView = false;
  selfId: string | null = null;
  private playerCanAct = true;
  setPlayerView(v: boolean, selfId: string | null = this.selfId, canAct = true): void {
    if (this.playerView === v && this.selfId === selfId && this.playerCanAct === canAct) return;
    this.playerView = v;
    this.selfId = selfId;
    this.playerCanAct = canAct;
    this.applyPlayCam();
    this.redraw();
  }

  /** One authority check shared by pointer, keyboard and React controls.
   * Unowned actors/props are Curator-controlled; assigned actors are controlled
   * only by their owner, including against ordinary Curator manipulation. */
  canControlToken(id: string): boolean {
    const token = this.scene?.data.tokens.find((t) => t.id === id);
    if (!token) return false;
    if (this.playerView && !this.playerCanAct) return false;
    return tokenControlAllowed({ peerId: this.selfId ?? "", role: this.playerView ? "player" : "host" }, token);
  }

  // ── Play Mode camera (session, not scene): players lose free pan, their view
  // follows their own token, and the zoom-out floor rises (Curator-set range).
  playCam = { on: false, range: 0.35 };
  setPlayCam(on: boolean, range: number): void {
    this.playCam = { on, range: Math.max(0.1, Math.min(1, range || 0.35)) };
    this.applyPlayCam();
  }
  /** Is THIS client's camera locked right now? (players only, while playing) */
  playLocked(): boolean {
    return (this.playCam.on || (this.cineState.on && !!this.cineState.tokenId)) && this.playerView;
  }

  // ── Cinematic Mode: the director's cut. A full-screen GLSL effect over the
  // whole stage, optional frame shake, and (for players) a camera locked onto
  // the spotlit token, following it as it moves.
  readonly cineState = { on: false, tokenId: undefined as string | undefined, shake: 0 };
  private cineFilter: CustomShaderFilter | null = null;
  private cineBody = "";
  private cineT0 = 0;
  setCinematic(on: boolean, opts: { tokenId?: string; glsl?: string; shake?: number } = {}): void {
    this.cineState.on = on;
    this.cineState.tokenId = on ? opts.tokenId : undefined;
    this.cineState.shake = on ? Math.max(0, Math.min(1, opts.shake ?? 0)) : 0;
    const body = on ? (opts.glsl ?? "").trim() : "";
    if (body !== this.cineBody) {
      this.cineBody = body;
      this.cineFilter = null;
      if (body) {
        const err = validateShaderBody(body);
        if (err) {
          this.onShaderError("Cinematic: " + err);
        } else {
          try {
            this.cineFilter = new CustomShaderFilter(body);
            this.cineT0 = Date.now();
          } catch (e) {
            this.cineFilter = null;
            this.onShaderError("Cinematic: " + String(e).slice(0, 300));
          }
        }
      }
      this.restageFilters();
    }
    if (!on) this.camera.apply(); // clear any leftover shake offset
  }

  // ── Environmental FX: the ambient screen effect (env FX field + emitters) and
  // the cinematic effect are BOTH stage filters — compose them in a stable order
  // (ambient underneath, cinematic on top) so neither clobbers the other.
  private envFilter: EnvFxFilter | null = null;
  private envPreset = "";
  private envT0 = 0;
  private restageFilters(): void {
    const f: (EnvFxFilter | CustomShaderFilter)[] = [];
    if (this.envFilter) f.push(this.envFilter);
    if (this.cineFilter) f.push(this.cineFilter);
    this.app.stage.filters = f;
  }
  /** Set (or clear) the whole-map ambient FX field (Curator, synced). */
  setSceneEnvFx(envFx: { preset: string; intensity: number } | null): void {
    if (!this.scene || this.playerView) return;
    this.scene.data.envFx = envFx;
    this.onChanged();
    this.onOp({ op: "envfx.set", envFx });
  }
  /** Recompute the winning ambient FX for THIS client's listener and apply it. */
  private updateEnvFx(): void {
    if (!this.scene) return;
    const d = this.scene.data;
    const pick = pickEnvFx(d.emitters ?? [], this.listenerWorld(), d.grid.size, d.envFx);
    if (!pick) {
      if (this.envFilter) {
        this.envFilter = null;
        this.envPreset = "";
        this.restageFilters();
      }
      return;
    }
    if (pick.preset !== this.envPreset) {
      try {
        this.envFilter = new EnvFxFilter(pick.preset);
        this.envPreset = pick.preset;
        this.envT0 = Date.now();
        this.restageFilters();
      } catch (e) {
        this.envFilter = null;
        this.envPreset = "";
        this.onShaderError("Env FX: " + String(e).slice(0, 200));
        this.restageFilters();
        return;
      }
    }
    this.envFilter!.setIntensity(pick.intensity);
    this.envFilter!.tick((Date.now() - this.envT0) / 1000, this.app.screen.width, this.app.screen.height);
  }
  private applyPlayCam(): void {
    if (this.playLocked()) {
      this.camera.cancelFling();
      this.camera.min = Math.min(this.camera.max, 0.15 / this.playCam.range);
      if (this.camera.zoom < this.camera.min) this.camera.set({ ...this.camera.state(), zoom: this.camera.min });
      this.followOwnToken(true); // hard cut onto your token when the lock engages
    } else {
      this.camera.min = 0.15;
    }
  }
  /** The first token this player owns — their body on the table. */
  ownToken(): VttToken | null {
    if (!this.selfId) return null;
    return this.scene?.data.tokens.find((t) => t.owner === this.selfId && t.visible !== false) ?? null;
  }
  /** Center the viewport on a world point. Locked cameras GLIDE there (tokens
   *  move a whole cell at a time — snapping every step is what felt jerky);
   *  `instant` is for hard cuts: engaging the lock, scene loads, teleports. */
  centerOn(wx: number, wy: number, instant = false): void {
    const cw = this.app.canvas.clientWidth || this.app.renderer.width;
    const ch = this.app.canvas.clientHeight || this.app.renderer.height;
    const x = cw / 2 - wx * this.camera.zoom;
    const y = ch / 2 - wy * this.camera.zoom;
    if (instant) this.camera.snapTo(x, y);
    else this.camera.followTo(x, y);
  }
  followOwnToken(instant = false): void {
    const t = this.ownToken();
    if (t) this.centerOn(t.x, t.y, instant);
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
    if (!this.scene || this.playerView) return;
    const desired = this.snap(wx, wy);
    const p = nearestFreeCell(this.scene.data.grid, this.scene.data.tokens, { ...desired, size: 1 });
    if (!p) return;
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
    if (!this.scene || this.playerView) return null;
    if (spec.characterId) {
      const existing = this.scene.data.tokens.find((token) => token.characterId === spec.characterId && !token.prop);
      if (existing) {
        this.select({ kind: "token", id: existing.id });
        this.centerOn(existing.x, existing.y);
        return existing;
      }
    }
    const cw = this.app.canvas.clientWidth || this.app.renderer.width;
    const ch = this.app.canvas.clientHeight || this.app.renderer.height;
    const wc = this.camera.screenToWorld(cw / 2, ch / 2);
    const center = this.snap(wc.x, wc.y);
    const n = this.scene.data.tokens.length;
    const size = Math.max(1, Math.min(6, Number(spec.size) || 1));
    const placement = nearestFreeCell(this.scene.data.grid, this.scene.data.tokens, { ...center, size });
    if (!placement) return null;
    const t: VttToken = {
      visible: true,
      color: TOKEN_COLORS[n % TOKEN_COLORS.length],
      name: `Token ${n + 1}`,
      ...spec,
      id: newId("tk"),
      size,
      x: placement.x,
      y: placement.y,
    };
    if (!vttSnapshotFits({ ...this.scene, data: { ...this.scene.data, tokens: [...this.scene.data.tokens, t] } })) {
      this.onSceneBudgetError();
      return null;
    }
    this.scene.data.tokens.push(t);
    this.select({ kind: "token", id: t.id });
    this.onChanged();
    this.onOp({ op: "token.add", token: t });
    return t;
  }
  /**
   * Commit a planned summon — a hundred bodies as ONE act.
   *
   * `spawnToken` is the wrong tool for a swarm and calling it in a loop is the
   * bug this method exists to prevent: each call re-serialises the whole scene
   * for its own budget check and re-scans every token for its own free cell, so
   * Minion Conjuration's 100 minions would cost 100 growing serialisations and
   * a quadratic cell search before the first one appeared. Positions and the
   * wire measurement are `summonPlan`'s job and are already done by the time
   * this is called; what is left is the commit.
   *
   * It still refuses as a whole. A batch that half-lands is a swarm the Curator
   * cannot count and cannot dismiss, so a duplicate id anywhere — the only way
   * this can fail with a validated plan — drops the entire batch and returns 0
   * rather than leaving a partial one on the map.
   *
   * One op per body, deliberately. `token.add` is the op every peer already
   * knows how to apply, and inventing a bulk op would be a second way to add a
   * token that the permission and validation paths would have to learn.
   */
  placeSummonBatch(tokens: readonly VttToken[]): number {
    if (!this.scene || this.playerView || tokens.length === 0) return 0;
    if (duplicateSummonIds(this.scene.data.tokens, tokens).length) return 0;
    for (const token of tokens) this.scene.data.tokens.push(token);
    this.redraw();
    this.onChanged();
    for (const token of tokens) this.onOp({ op: "token.add", token });
    return tokens.length;
  }
  /**
   * Send a whole summoned batch away again.
   *
   * The removal counterpart of the batch placement, and for the same reason: a
   * swarm that can only be removed one token at a time has not really been
   * given a way off the map. Auras orphaned by the departure are dropped here
   * exactly as `deleteSelected` drops them — a field hanging over an empty
   * square is no more explicable when 100 bodies left at once.
   *
   * A body the Curator handed to a player is NOT dismissed, for the reason
   * `deleteSelected` will not delete one: ordinary Curator input does not remove
   * another peer's token, and a batch handle that ignored that would be a way to
   * delete a player's token by having summoned it. Returns how many actually
   * left, which is what the caller reports — never the batch size.
   */
  dismissSummonBatch(batchId: string): number {
    if (!this.scene || this.playerView || !batchId) return 0;
    const d = this.scene.data;
    const { going } = dismissibleSummonBodies(d.tokens, batchId, (token) => this.canControlToken(token.id));
    if (!going.length) return 0;
    const ids = new Set(going.map((token) => token.id));
    d.tokens = d.tokens.filter((token) => !ids.has(token.id));
    if (this.selection?.kind === "token" && ids.has(this.selection.id)) this.select(null);
    this.conditions.prune(d);
    // A hundred bodies leaving take a hundred tracks' worth of scene record with
    // them. Left behind they are rows keyed to token ids the scene no longer has
    // — the same staleness `pruneConditionClocks` exists to stop, at a hundred
    // times the volume.
    pruneCounterTracks(d);
    const orphaned = dropOrphanAuras(d);
    this.redraw();
    this.onChanged();
    for (const id of ids) this.onOp({ op: "token.remove", id });
    for (const effectId of orphaned) this.onOp({ op: "effect.remove", id: effectId });
    return ids.size;
  }

  /** How many of a batch are standing on this scene right now, and how many of
   *  those the Curator may not remove — what the confirmation prompt asks
   *  before it claims a number. */
  summonBatchCensus(batchId: string): { total: number; refused: number } {
    const tokens = this.scene?.data.tokens ?? [];
    const { going, refused } = dismissibleSummonBodies(tokens, batchId, (token) => this.canControlToken(token.id));
    return { total: going.length + refused.length, refused: refused.length };
  }
  addWall(x1: number, y1: number, x2: number, y2: number): void {
    if (!this.scene || this.playerView || (x1 === x2 && y1 === y2)) return;
    const w: VttWall = { id: newId("wl"), x1, y1, x2, y2, blocksLight: true };
    this.scene.data.walls.push(w);
    this.select({ kind: "wall", id: w.id });
    this.onChanged();
    this.onOp({ op: "wall.add", wall: w });
  }
  addLightAt(wx: number, wy: number): void {
    if (!this.scene || this.playerView) return;
    const p = this.snap(wx, wy);
    const l: VttLight = { id: newId("lt"), x: p.x, y: p.y, radius: 6, color: "#a08a4f", intensity: 0.5 };
    this.scene.data.lights.push(l);
    this.select({ kind: "light", id: l.id });
    this.onChanged();
    this.onOp({ op: "light.add", light: l });
  }
  /** Pin a soundboard clip to the world as a spatial emitter (synced). */
  addEmitterAt(wx: number, wy: number, spec: { name: string; src: string }): void {
    if (!this.scene || this.playerView) return;
    const p = this.snap(wx, wy);
    const e: VttEmitter = { id: newId("em"), x: p.x, y: p.y, radius: 8, name: spec.name, src: spec.src, volume: 0.9, loop: true };
    if (!vttSnapshotFits({ ...this.scene, data: { ...this.scene.data, emitters: [...(this.scene.data.emitters ?? []), e] } })) {
      this.onSceneBudgetError();
      return;
    }
    (this.scene.data.emitters ??= []).push(e);
    this.select({ kind: "emitter", id: e.id });
    this.onChanged();
    this.onOp({ op: "emitter.add", emitter: e });
  }
  updateEmitter(id: string, patch: Partial<VttEmitter>): void {
    if (this.playerView) return;
    const e = this.scene?.data.emitters?.find((x) => x.id === id);
    if (!e) return;
    Object.assign(e, patch);
    this.redraw();
    this.onChanged();
    this.onOp({ op: "emitter.update", id, patch });
  }
  addEffectAt(kind: VttEffectKind, wx: number, wy: number): void {
    if (!this.scene || this.playerView) return;
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
  placeAoeAt(kind: VttEffectKind, wx: number, wy: number, opts: PlaceAoeOptions = {}): void {
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
    if (opts.status) patch.status = opts.status;
    if (opts.label) patch.label = opts.label;
    if (opts.ticks?.length) patch.ticks = opts.ticks;
    if (opts.sourceAbilityId) patch.sourceAbilityId = opts.sourceAbilityId;
    if (opts.sourceAbilityName) patch.sourceAbilityName = opts.sourceAbilityName;
    if (opts.casterCharacterId) patch.casterCharacterId = opts.casterCharacterId;
    if (Object.keys(patch).length) this.updateEffect(sel.id, patch);
    // Bound LAST, and through the same op path: `bindAura` captures the offset
    // between the template's anchor and its owner, so it has to run after the
    // size patch that decided where a rect zone's corner sits. Binding first
    // would freeze an offset the resize then invalidated, and the aura would
    // ride its caster half a template off.
    if (opts.auraTokenId) this.bindAuraToToken(sel.id, opts.auraTokenId);
  }
  /**
   * Make an effect ride a token from here on.
   *
   * Emitted as an ordinary `effect.update`, so a peer learns the binding the
   * same way it learns a colour change — and from then on that peer reanchors
   * the aura from its own copy of the token's moves, with no further traffic.
   */
  bindAuraToToken(effectId: string, tokenId: string): boolean {
    if (!this.scene || this.playerView) return false;
    if (!bindAura(this.scene.data, effectId, tokenId)) return false;
    const effect = this.scene.data.effects.find((candidate) => candidate.id === effectId);
    if (!effect) return false;
    this.redraw();
    this.onChanged();
    this.onOp({
      op: "effect.update",
      id: effectId,
      patch: { auraTokenId: tokenId, auraDx: effect.data.auraDx, auraDy: effect.data.auraDy },
    });
    return true;
  }
  /**
   * Cut an aura loose, leaving the template exactly where it stands.
   *
   * Synced as a remove + re-add of the same id, the way `setEffectKind` syncs
   * for the same reason: `effect.update` merges its patch with Object.assign,
   * and there is no patch that can DELETE a key across the wire — an op is JSON,
   * and JSON drops a field holding undefined on the way out. A peer handed
   * `{ auraTokenId: undefined }` would receive `{}`, apply nothing, and go on
   * riding an aura this client had already set free.
   */
  unbindAuraFrom(effectId: string): boolean {
    if (!this.scene || this.playerView) return false;
    if (!unbindAura(this.scene.data, effectId)) return false;
    const effect = this.scene.data.effects.find((candidate) => candidate.id === effectId);
    if (!effect) return false;
    this.onChanged();
    this.onOp({ op: "effect.remove", id: effectId });
    this.onOp({ op: "effect.add", effect });
    return true;
  }
  /**
   * Take placed effects off the scene — the `Tamper: end` half of the verb.
   *
   * Not `deleteSelected`: that removes whatever is SELECTED, one thing at a
   * time, and a tamper acts on an effect the Curator picked off a list without
   * ever selecting it. Returns how many actually went, so a caller never
   * announces a field it did not remove.
   */
  removeEffects(ids: readonly string[]): number {
    if (!this.scene || this.playerView || !ids.length) return 0;
    const wanted = new Set(ids);
    const data = this.scene.data;
    const before = data.effects.length;
    const gone: string[] = [];
    data.effects = data.effects.filter((effect) => {
      if (!wanted.has(effect.id)) return true;
      gone.push(effect.id);
      return false;
    });
    if (data.effects.length === before) return 0;
    if (this.selection?.kind === "effect" && wanted.has(this.selection.id)) this.select(null);
    this.redraw();
    this.onChanged();
    for (const id of gone) this.onOp({ op: "effect.remove", id });
    return gone.length;
  }
  /**
   * Put effects on the scene exactly as given, replacing any that share an id.
   *
   * Synced as a remove + re-add per effect, the way `unbindAuraFrom` and
   * `setEffectKind` sync and for the same reason: `effect.update` merges its
   * patch with Object.assign over `data` alone, so it can carry neither a new
   * `x`/`y` nor the DELETION of a key — an op is JSON, and JSON drops a field
   * holding undefined on the way out. A peer handed `{ suspendedUntil:
   * undefined }` receives `{}`, applies nothing, and goes on treating a woken
   * field as asleep.
   */
  putEffects(effects: readonly VttEffect[]): boolean {
    if (!this.scene || this.playerView || !effects.length) return false;
    const data = this.scene.data;
    for (const effect of effects) {
      const at = data.effects.findIndex((candidate) => candidate.id === effect.id);
      // Replaced IN PLACE rather than appended: effect order is paint order, and
      // a reflected field jumping to the top of the stack would redraw the map
      // differently for a change that was only ever about position.
      if (at >= 0) data.effects[at] = effect;
      else data.effects.push(effect);
      this.onOp({ op: "effect.remove", id: effect.id });
      this.onOp({ op: "effect.add", effect });
    }
    this.redraw();
    this.onChanged();
    return true;
  }
  /**
   * Put the scene's counter-track record back to a recorded shape — the other
   * half of undoing a track that a tamper wiped, since the pip and the record
   * live in two different places.
   *
   * No `onOp`, exactly like `setConditionClocks`: tracks are host-side
   * bookkeeping that ride the snapshot and were never on the wire. A peer learns
   * of the change from the `token.update` carrying the pip, which is the only
   * part it ever had.
   */
  setCounterTracks(tracks: VttCounterTrack[]): boolean {
    if (!this.scene || this.playerView) return false;
    commitTokenCounter(this.scene.data, tracks);
    this.onChanged();
    return true;
  }
  updateEffect(id: string, patch: Partial<VttEffectData>): void {
    if (this.playerView) return;
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
    if (this.playerView) return;
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
    if (this.playerView) return;
    const w = this.scene?.data.walls.find((x) => x.id === id);
    if (!w) return;
    Object.assign(w, patch);
    this.redraw();
    this.onChanged();
    this.onOp({ op: "wall.update", id, patch });
  }
  /** Configure EVERY light in the scene at once (Curator bulk edit, synced). */
  updateAllLights(patch: Partial<VttLight>): void {
    if (this.playerView) return;
    const lights = this.scene?.data.lights;
    if (!lights?.length) return;
    for (const l of lights) Object.assign(l, patch);
    this.redraw();
    this.onChanged();
    this.onOp({ op: "light.all", patch });
  }
  updateLight(id: string, patch: Partial<VttLight>): void {
    if (this.playerView) return;
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
    if (!this.scene || !burnMechanicOn(this.scene.data.fog)) return;
    const light = this.scene.data.lights.find((candidate) => candidate.id === id);
    if (!light || light.alwaysOn || (this.playerView && !lightVisibleTo(this.scene.data, light, this.selfId ?? undefined))) return;
    const op: VttOp = { op: "light.ignite", id };
    if (!applyOp(this.scene.data, op)) return;
    this.redraw();
    this.onChanged();
    this.onOp(op);
  }
  deleteSelected(): void {
    if (!this.scene || !this.selection) return;
    const { kind, id } = this.selection;
    if (kind === "token" ? !this.canControlToken(id) : this.playerView) return;
    const d = this.scene.data;
    if (kind === "token") d.tokens = d.tokens.filter((x) => x.id !== id);
    if (kind === "wall") d.walls = d.walls.filter((x) => x.id !== id);
    if (kind === "light") d.lights = d.lights.filter((x) => x.id !== id);
    if (kind === "emitter") d.emitters = (d.emitters ?? []).filter((x) => x.id !== id);
    if (kind === "effect") d.effects = d.effects.filter((x) => x.id !== id);
    this.select(null);
    if (kind === "token") this.conditions.prune(d);
    // An aura is its owner's presence on the map. Deleting the caster and
    // leaving a 15-ft field hanging over an empty square strands an effect the
    // table cannot explain and, worse, cannot easily remove — the inspector that
    // would have offered a handle belonged to the token that just went away.
    // Auras only; a template the Curator placed by hand has no owner to lose.
    if (kind === "token") {
      const orphaned = dropOrphanAuras(d);
      for (const effectId of orphaned) this.onOp({ op: "effect.remove", id: effectId });
    }
    this.onChanged();
    if (kind === "token") this.onOp({ op: "token.remove", id });
    else if (kind === "wall") this.onOp({ op: "wall.remove", id });
    else if (kind === "light") this.onOp({ op: "light.remove", id });
    else if (kind === "emitter") this.onOp({ op: "emitter.remove", id });
    else if (kind === "effect") this.onOp({ op: "effect.remove", id });
  }
  toggleFog(): void {
    if (!this.scene || this.playerView) return;
    this.scene.data.fog.enabled = !this.scene.data.fog.enabled;
    this.redraw();
    this.onChanged();
    this.onOp({ op: "fog.set", enabled: this.scene.data.fog.enabled });
  }
  // ── Freehand drawing (synced annotations, per-peer ink) ────────────────────
  private stroke: number[] | null = null;
  /** May THIS client draw right now? Players obey the Curator's switch. */
  canDraw(): boolean {
    return !this.playerView || (this.playerCanAct && this.scene?.data.allowPlayerDraw !== false);
  }
  /** This client's ink color — Curator draws gold; each player a hashed hue. */
  inkColor(): string {
    return peerInkColor(this.selfId, !this.playerView);
  }
  /** Local "look here" — pulse at the point in MY ink color + report upward. */
  ping(wx: number, wy: number): void {
    this.pings.add(wx, wy, this.inkColor());
    this.onPing(wx, wy);
  }
  /** A peer's ping arriving over the wire (color = their ink). */
  showPing(wx: number, wy: number, color: string): void {
    this.pings.add(wx, wy, color);
  }
  beginDraw(wx: number, wy: number): void {
    if (!this.scene || !this.canDraw()) return;
    this.stroke = [wx, wy];
  }
  extendDraw(wx: number, wy: number): void {
    if (!this.stroke) return;
    const n = this.stroke.length;
    // thin points to ~4 world px so long strokes stay light on the wire
    if (Math.hypot(wx - this.stroke[n - 2], wy - this.stroke[n - 1]) < 4) return;
    this.stroke.push(wx, wy);
    this.drawings.preview(this.stroke, this.inkColor(), 3);
  }
  endDraw(): void {
    const pts = this.stroke;
    this.stroke = null;
    this.drawings.clearPreview();
    if (!this.scene || !pts || pts.length < 4) return;
    const drawing = { id: newId("dr"), points: pts, color: this.inkColor(), width: 3 };
    (this.scene.data.drawings ??= []).push(drawing);
    this.redraw();
    this.onChanged();
    this.onOp({ op: "draw.add", drawing });
  }
  /** Drop an in-progress stroke without committing it. Touch pinch takeover,
   * pointer cancellation, and teardown all use this path. */
  cancelDraw(): void {
    this.stroke = null;
    this.drawings.clearPreview();
  }
  /** Curator: wipe every annotation (synced). */
  clearDrawings(): void {
    if (this.playerView || !this.scene?.data.drawings?.length) return;
    this.scene.data.drawings = [];
    this.redraw();
    this.onChanged();
    this.onOp({ op: "draw.clear" });
  }
  /** Curator: allow/forbid player drawing (synced live). */
  setAllowPlayerDraw(allow: boolean): void {
    if (!this.scene || this.playerView || (this.scene.data.allowPlayerDraw ?? true) === allow) return;
    this.scene.data.allowPlayerDraw = allow;
    this.onChanged();
    this.onOp({ op: "draw.allow", allow });
  }

  /** Active zone brush ({kind, erase}) — the "zone" tool paints with it. */
  zoneBrush: { kind: VttZoneKind; erase: boolean } | null = null;
  /** Paint (or erase) the zone cell under a world point with the active brush. */
  paintZoneAt(wx: number, wy: number): void {
    if (!this.scene || this.playerView || !this.zoneBrush) return;
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
    if (!this.scene || this.playerView) return;
    const zg = (this.scene.data.zoneGlsl ??= {});
    if ((zg[kind] ?? "") === body) return;
    zg[kind] = body;
    this.redraw();
    this.onChanged();
    this.onOp({ op: "zone.glsl", kind, body });
  }
  /** Clear every cell of one zone kind (synced). */
  clearZone(kind: VttZoneKind): void {
    if (this.playerView) return;
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
    if (!this.scene || this.playerView) return;
    const f = this.scene.data.fog;
    if (f.revealed.length === 0 && !f.seen) return;
    f.revealed = [];
    f.seen = undefined;
    this.redraw();
    this.onChanged();
    this.onOp({ op: "fog.reset" });
  }
  /** Change the fog darkness level / decay speed (Curator, synced). */
  setFogConfig(patch: { mode?: VttFogMode; decaySeconds?: number; lanterns?: boolean }): void {
    if (!this.scene || this.playerView) return;
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
    if (!this.scene || this.playerView) return;
    if (patch.src !== undefined && !vttSnapshotFits({
      ...this.scene,
      data: { ...this.scene.data, background: { ...this.scene.data.background, ...patch } },
    })) {
      this.onSceneBudgetError();
      return;
    }
    Object.assign(this.scene.data.background, patch);
    this.redraw();
    this.onChanged();
    this.onOp({ op: "bg.set", patch });
  }
  /** Patch the grid (cell size / cols / rows / visibility) — Curator resize. */
  setGrid(patch: Partial<VttGrid>): void {
    if (!this.scene || this.playerView) return;
    Object.assign(this.scene.data.grid, patch);
    this.redraw();
    this.onChanged();
    this.onOp({ op: "grid.set", patch });
  }
  /** Set (or clear) the terrain heightmap (renders in the 3D view). */
  setTerrain(terrain: VttTerrain | null): void {
    if (!this.scene || this.playerView) return;
    this.scene.data.terrain = terrain;
    this.onChanged();
    this.onOp({ op: "terrain.set", terrain });
  }
  /** Set the 3D atmosphere (backdrop / fog / mist / particles / mood / shadows). */
  setAtmosphere(atmo: VttAtmosphere): void {
    if (!this.scene || this.playerView) return;
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
    if (!t || !this.canControlToken(id)) return;
    const p = snap ? this.snap(wx, wy) : { x: wx, y: wy };
    if (!snap) this.previewTokenMove(id, p.x, p.y);
    else this.requestTokenMove(id, t.x, t.y, p.x, p.y);
  }
  /** Visual-only pointer preview; never changes fog, persistence or sync state. */
  previewTokenMove(id: string, wx: number, wy: number): void {
    if (!this.canControlToken(id)) return;
    this.tokens.setPreview(id, wx, wy);
    this.redraw();
  }
  cancelTokenPreview(id: string): void {
    this.tokens.clearPreview(id);
    this.redraw();
  }
  requestTokenMove(id: string, fromX: number, fromY: number, toX: number, toY: number): void {
    if (!this.canControlToken(id)) return;
    const p = this.snap(toX, toY);
    this.tokens.clearPreview(id);
    this.redraw();
    this.onMoveRequested(id, fromX, fromY, p.x, p.y);
  }
  /** Apply an already-authorized move. `emit` is false for a network commit. */
  commitTokenMove(id: string, x: number, y: number, emit = true, authoritative = false): boolean {
    const t = this.scene?.data.tokens.find((token) => token.id === id);
    if (!t || !Number.isFinite(x) || !Number.isFinite(y)) return false;
    const oldX = t.x;
    const oldY = t.y;
    const occupancy = canOccupy(this.scene!.data.grid, this.scene!.data.tokens, { x, y, size: t.size }, { ignoreTokenId: id });
    if (!authoritative && (!occupancy.ok || this.moveBlocked(oldX, oldY, x, y))) {
      this.rejectTokenMove(id, x, y);
      return false;
    }
    this.tokens.clearPreview(id);
    t.x = x;
    t.y = y;
    const dx = x - oldX;
    const dy = y - oldY;
    if (Math.hypot(dx, dy) > 2) t.facing = Math.atan2(dy, dx);
    // Auras ride their owner, and they are reanchored BEFORE the redraw below:
    // a pass that ran after it would draw one frame of the aura still sitting on
    // the square the caster just left. This covers moves that START here; every
    // move that arrives from elsewhere goes through `applyOp`, which reanchors
    // for itself.
    //
    // No effect op is emitted, deliberately. A peer is already told `token.move`
    // (below, when `emit`), and applying that op runs the same reconcile on the
    // same aura with the same offset — so the position converges everywhere from
    // one op instead of three, and an aura cannot cost more wire traffic per
    // step than the token dragging it.
    reanchorAuras(this.scene!.data);
    this.redraw();
    this.onChanged();
    if (emit) this.onOp({ op: "token.move", id, x, y });
    this.onTokenMoved(id, x, y);
    if (this.playLocked() && t.owner === this.selfId) this.centerOn(x, y);
    return true;
  }
  rejectTokenMove(id: string, attemptedX: number, attemptedY: number): void {
    this.tokens.bounce(id, attemptedX, attemptedY, this.scene?.data.grid.size ?? 70);
    this.redraw();
  }
  updateToken(id: string, patch: Partial<VttToken>): void {
    if (!this.scene) return;
    const t = this.scene.data.tokens.find((x) => x.id === id);
    if (!t || !this.canControlToken(id)) return;
    const safe = this.playerView ? sanitizePlayerTokenUpdatePatch(patch) : sanitizeTokenUpdatePatch(patch);
    // Curators may assign an unowned actor once. Recovery/reassignment is an
    // explicit administrative action, never an ordinary inspector edit.
    if (
      safe.size !== undefined &&
      !canOccupy(this.scene.data.grid, this.scene.data.tokens, { x: t.x, y: t.y, size: safe.size }, { ignoreTokenId: t.id }).ok
    ) return;
    if (safe.img !== undefined && !vttSnapshotFits({
      ...this.scene,
      data: {
        ...this.scene.data,
        tokens: this.scene.data.tokens.map((candidate) => candidate.id === id ? { ...candidate, ...safe } : candidate),
      },
    })) {
      this.onSceneBudgetError();
      return;
    }
    const ownerChange = "owner" in patch && !this.playerView && !t.owner ? patch.owner || null : undefined;
    if (ownerChange !== undefined) t.owner = ownerChange || undefined;
    Object.assign(t, safe);
    this.redraw();
    this.onChanged();
    if (ownerChange !== undefined) this.onOp({ op: "token.assign", id, owner: ownerChange });
    if (Object.keys(safe).length) this.onOp({ op: "token.update", id, patch: safe });
  }
  /**
   * The Curator's confirmed ruling reaching a body — the one write that may
   * land on a token the Curator does not own.
   *
   * `updateToken` refuses another peer's token on purpose: a stray drag or an
   * inspector edit must never rewrite a player's character. Damage from a roll
   * the whole table watched is the opposite case. It is adjudication, it is the
   * Curator's to declare, and the alternative is a resolution card that reports
   * 27 damage while the op is dropped on the floor — a lie the table cannot see
   * through. So the ownership gate is spent here, and nowhere else, on the two
   * fields a ruling is allowed to touch.
   *
   * Returns whether the write was authorized, so a caller never announces HP it
   * did not commit. An authorized write that changed nothing still returns true
   * — the ruling landed; the number was simply already there.
   */
  adjudicateTokenVitals(id: string, patch: Partial<VttToken>): boolean {
    if (!this.scene || this.playerView) return false;
    const t = this.scene.data.tokens.find((x) => x.id === id);
    if (!t) return false;
    const safe = sanitizeTokenVitalsPatch(patch);
    if (!Object.keys(safe).length) return false;
    const changed = Object.entries(safe).some(([field, value]) => (t as unknown as Record<string, unknown>)[field] !== value);
    if (!changed) return true;
    Object.assign(t, safe);
    this.redraw();
    this.onChanged();
    this.onOp({ op: "token.update", id, patch: safe });
    return true;
  }
  /**
   * A condition landing on a body, with the clock the ability declared.
   *
   * The tag itself goes through `adjudicateTokenVitals` — the same authorised
   * write damage takes — and the clock is stored only once that write comes back
   * authorised. A refused application therefore leaves no countdown behind for a
   * condition nobody is carrying.
   *
   * A second application of a condition already present is not this method's
   * decision: `ConditionClockSystem.plan` reads the Stacking rule off the
   * condition's own Codex page. Returns whether the application landed.
   */
  applyTokenCondition(input: { tokenId: string; status: string; rounds?: number; potency?: number }): boolean {
    if (!this.scene || this.playerView) return false;
    const plan = this.conditions.plan(this.scene.data, { ...input, round: this.scene.data.timeline.round });
    if (!plan) return false;
    if (!this.adjudicateTokenVitals(input.tokenId, { statuses: plan.statuses })) return false;
    if (plan.clocks.length) this.scene.data.conditionClocks = plan.clocks;
    else delete this.scene.data.conditionClocks;
    this.onChanged();
    return true;
  }
  /**
   * Put the scene's condition countdowns back to a recorded shape — the other
   * half of undoing an application, since the pip and its clock are stored in
   * two different places.
   *
   * No `onOp`: clocks are host-side bookkeeping that ride the snapshot and were
   * never on the wire, so a peer learns of the reversal from the `token.update`
   * carrying the pip — the only part it ever had. Curator-only, like every
   * other write that decides how long something lasts.
   */
  setConditionClocks(clocks: VttConditionClock[]): boolean {
    if (!this.scene || this.playerView) return false;
    if (clocks.length) this.scene.data.conditionClocks = clocks;
    else delete this.scene.data.conditionClocks;
    this.onChanged();
    return true;
  }
  /** Drop clocks whose token or tag is gone. Host-side bookkeeping: a player's
   *  client is told about the removal by the ordinary token.update that carries
   *  the pip, and never keeps a clock of its own. */
  pruneConditionClocks(): boolean {
    if (!this.scene || this.playerView) return false;
    if (!this.conditions.prune(this.scene.data)) return false;
    this.onChanged();
    return true;
  }
  /**
   * Move a custom currency counted against a body — Blight, Overload Charges.
   *
   * The number goes on the token as a status tag, so it commits through
   * `adjudicateTokenVitals`, the same authorised write damage and conditions
   * take, and the scene's record is stored only once that write comes back
   * authorised. A refused move therefore leaves no record behind for a track
   * nobody is carrying — and a player-owned token is refused, which is the whole
   * point of routing through that method rather than `updateToken`.
   *
   * Returns the plan when the move landed, so the caller can see what crossed.
   * Crossings are NOT acted on here: an `At N` step is an ordinary consequence
   * and belongs on a Resolution Card in front of a human, not inside the writer.
   */
  applyTokenCounter(input: TokenCounterApplication): TokenCounterPlan | null {
    if (!this.scene || this.playerView) return null;
    const plan = planTokenCounter(this.scene.data, input);
    if (!plan) return null;
    if (!this.adjudicateTokenVitals(plan.tokenId, { statuses: plan.statuses })) return null;
    commitTokenCounter(this.scene.data, plan.sceneTracks);
    this.onChanged();
    return plan;
  }
  /** Take a body's track off, pip and record together — the Curator's eraser.
   *  The only removal there is: nothing decays a track on a round or an
   *  encounter, because no page can declare that it should. */
  clearTokenCounter(tokenId: string, name: string): boolean {
    if (!this.scene || this.playerView) return false;
    const plan = planClearTokenCounter(this.scene.data, tokenId, name);
    if (!plan) return false;
    if (!this.adjudicateTokenVitals(plan.tokenId, { statuses: plan.statuses })) return false;
    commitTokenCounter(this.scene.data, plan.sceneTracks);
    this.onChanged();
    return true;
  }
  /** Every track one body carries, for the inspector. */
  tokenCounters(tokenId: string): CounterTrack[] {
    return this.scene ? tracksOfToken(this.scene.data, tokenId) : [];
  }
  /** Drop tracks whose token is gone or whose pip a Curator cleared by hand.
   *  Host-side bookkeeping, exactly like `pruneConditionClocks`: a player's
   *  client learns of the removal from the token.update that carries the pip. */
  pruneCounters(): boolean {
    if (!this.scene || this.playerView) return false;
    if (!pruneCounterTracks(this.scene.data)) return false;
    this.onChanged();
    return true;
  }
  /** Explicit Curator recovery path for a mistaken/stale ownership binding.
   * Ordinary Curator input still cannot move, edit, or remove another player's
   * token; only this separately-confirmed identity operation bypasses it. */
  administrativelyAssignToken(id: string, owner: string | null): boolean {
    if (!this.scene || this.playerView) return false;
    const token = this.scene.data.tokens.find((candidate) => candidate.id === id);
    if (!token || token.prop || (owner != null && (!owner.trim() || owner.length > 128))) return false;
    const next = owner?.trim() || null;
    if ((token.owner ?? null) === next) return false;
    token.owner = next ?? undefined;
    delete token.ownerPeer;
    this.redraw();
    this.onChanged();
    this.onOp({ op: "token.assign", id, owner: next });
    return true;
  }
  persistCamera(): void {
    if (!this.scene) return;
    this.scene.data.camera = this.camera.state();
    this.onChanged();
  }
  /** Link (or unlink) the scene's active encounter. */
  setEncounterId(id: string | null): void {
    if (!this.scene || this.playerView) return;
    this.scene.data.encounterId = id;
    this.onChanged();
  }
  /** Mirror the encounter's round/turn into the scene timeline. When the round
   *  advances, run the engine systems (expire timed effects + zone-status sim). */
  setTimeline(round: number, turn: number): void {
    if (!this.scene || this.playerView) return;
    const prevRound = this.scene.data.timeline.round;
    this.scene.data.timeline = { round, turn };
    // Round 0 is the encounter ending. The next one counts from 1 again, so a
    // clock still holding an absolute expiry from this fight has to be re-anchored
    // here or it rides into the next fight with rounds it already spent.
    if (round === 0 && prevRound > 0) this.conditions.restart(this.scene.data, prevRound);
    if (round !== prevRound && round > 0) {
      const changed = this.encounterSystem.onRound(
        this.scene.data,
        round,
        this.scene.data.grid.size,
        (tokenId, statuses) => this.adjudicateTokenVitals(tokenId, { statuses }),
        (proposals) => this.onRecurring(proposals)
      );
      if (changed) this.redraw();
    }
    this.onChanged();
  }
  /** Apply a remote op from a peer. Mutates the scene without re-emitting (no
   *  onOp call here → no echo loop) and persists locally. scene.switch is handled
   *  by the sync layer, so it never reaches this method. */
  applyRemote(op: VttOp): boolean {
    if (!this.scene) return false;
    if (op.op === "token.update" && op.patch.img !== undefined && !vttSnapshotFits({
      ...this.scene,
      data: {
        ...this.scene.data,
        tokens: this.scene.data.tokens.map((token) => token.id === op.id ? { ...token, ...op.patch } : token),
      },
    })) {
      this.onSceneBudgetError();
      return false;
    }
    const changed = applyOp(this.scene.data, op);
    if (!changed) return false;
    if (op.op === "token.remove") this.conditions.prune(this.scene.data);
    // If the selected entity was removed remotely, drop the stale selection.
    if (op.op.endsWith(".remove") && this.selection && "id" in op && this.selection.id === op.id) {
      this.select(null);
    } else {
      this.redraw();
    }
    this.onChanged();
    this.onRemoteApplied(op);
    // Portal detection is host-side: a player's move must trigger links too.
    if (op.op === "token.move") {
      this.onTokenMoved(op.id, op.x, op.y);
      // Host teleported/moved MY token while playing → my view goes with it.
      if (this.playLocked() && this.ownToken()?.id === op.id) this.centerOn(op.x, op.y);
    }
    return true;
  }

  destroy(): void {
    this.destroyed = true;
    this.spatial.destroy();
    this.input?.detach();
    if (this.ready) {
      this.ready = false;
      this.app.destroy(true, { children: true });
    }
    // if init() is still awaiting, its continuation disposes the app
  }
}
