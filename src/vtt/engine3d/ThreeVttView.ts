// The 3D view (slice 3D-1): a three.js renderer over the SAME VttScene the Pixi
// map draws — 3D is a view mode, not a separate world. 2D (x, y) maps to the 3D
// ground plane (x, z), up is +Y, units stay world-pixels so coordinates are
// shared verbatim with the 2D engine and the P2P sync ops.
//  - background image → ground-plane texture (fit-to-grid alignment)
//  - walls → extruded boxes   - lights → point lights + marker
//  - tokens → upright billboard sprites (token art or colour disc + name)
// Selection / drag-move call back into the PixiVttApp engine, which stays the
// single mutation authority (so ops/persistence/2D all update as usual).
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { defaultAtmosphere, type VttAtmosphere, type VttScene, type VttToken } from "../types/scene";
import type { VttSelection } from "../engine/PixiVttApp";
import { cellKey, computeVisibleCells } from "../engine/systems/VisionSystem";

// ── Mood presets: ambient / sun / fog-and-backdrop colours ──
const MOODS: Record<VttAtmosphere["mood"], { amb: number; ambI: number; sun: number; sunI: number; fog: number }> = {
  neutral: { amb: 0x8090b0, ambI: 0.7, sun: 0xfff4e0, sunI: 1.1, fog: 0x060a14 },
  moonlight: { amb: 0x6f82c8, ambI: 0.55, sun: 0xbfd2ff, sunI: 0.8, fog: 0x0a1028 },
  hellfire: { amb: 0x8c3620, ambI: 0.55, sun: 0xff8340, sunI: 1.05, fog: 0x1c0a05 },
  toxic: { amb: 0x4e7a50, ambI: 0.62, sun: 0xc2e890, sunI: 0.9, fog: 0x0a1608 },
  dusk: { amb: 0x9a7090, ambI: 0.6, sun: 0xffb070, sunI: 0.9, fog: 0x160a14 },
};

// ── Generated textures (once per session) ──
let starTexC: THREE.Texture | null = null;
function starTexture(): THREE.Texture {
  if (starTexC) return starTexC;
  const c = document.createElement("canvas");
  c.width = 1024;
  c.height = 512;
  const x = c.getContext("2d")!;
  x.fillStyle = "#04060f";
  x.fillRect(0, 0, 1024, 512);
  // nebulas
  for (let i = 0; i < 5; i++) {
    const gx = Math.random() * 1024, gy = Math.random() * 512, gr = 90 + Math.random() * 160;
    const g = x.createRadialGradient(gx, gy, 0, gx, gy, gr);
    const hue = [200, 260, 180, 300, 220][i];
    g.addColorStop(0, `hsla(${hue},60%,40%,0.20)`);
    g.addColorStop(1, "transparent");
    x.fillStyle = g;
    x.fillRect(0, 0, 1024, 512);
  }
  // stars
  for (let i = 0; i < 700; i++) {
    const a = 0.3 + Math.random() * 0.7;
    x.fillStyle = `rgba(255,255,255,${a})`;
    const s = Math.random() < 0.94 ? 1 : 2;
    x.fillRect(Math.random() * 1024, Math.random() * 512, s, s);
  }
  starTexC = new THREE.CanvasTexture(c);
  starTexC.colorSpace = THREE.SRGBColorSpace;
  return starTexC;
}
let rockTexC: THREE.Texture | null = null;
function rockTexture(): THREE.Texture {
  if (rockTexC) return rockTexC;
  const c = document.createElement("canvas");
  c.width = c.height = 512;
  const x = c.getContext("2d")!;
  x.fillStyle = "#17130f";
  x.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 900; i++) {
    const shade = 12 + Math.random() * 26;
    x.fillStyle = `rgba(${shade + 8},${shade + 4},${shade},${0.25 + Math.random() * 0.5})`;
    const w = 6 + Math.random() * 46, h = 4 + Math.random() * 22;
    x.fillRect(Math.random() * 512, Math.random() * 512, w, h);
  }
  rockTexC = new THREE.CanvasTexture(c);
  rockTexC.wrapS = rockTexC.wrapT = THREE.RepeatWrapping;
  return rockTexC;
}
let mistTexC: THREE.Texture | null = null;
function mistTexture(): THREE.Texture {
  if (mistTexC) return mistTexC;
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const x = c.getContext("2d")!;
  for (let i = 0; i < 26; i++) {
    const gx = Math.random() * 256, gy = Math.random() * 256, gr = 30 + Math.random() * 60;
    const g = x.createRadialGradient(gx, gy, 0, gx, gy, gr);
    g.addColorStop(0, "rgba(255,255,255,0.16)");
    g.addColorStop(1, "transparent");
    x.fillStyle = g;
    x.fillRect(0, 0, 256, 256);
  }
  mistTexC = new THREE.CanvasTexture(c);
  mistTexC.wrapS = mistTexC.wrapT = THREE.RepeatWrapping;
  return mistTexC;
}
let dotTexC: THREE.Texture | null = null;
function dotTexture(): THREE.Texture {
  if (dotTexC) return dotTexC;
  const c = document.createElement("canvas");
  c.width = c.height = 32;
  const x = c.getContext("2d")!;
  const g = x.createRadialGradient(16, 16, 0, 16, 16, 16);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.5, "rgba(255,255,255,0.4)");
  g.addColorStop(1, "transparent");
  x.fillStyle = g;
  x.fillRect(0, 0, 32, 32);
  dotTexC = new THREE.CanvasTexture(c);
  return dotTexC;
}

interface Hooks {
  onSelect: (sel: VttSelection) => void;
  /** done=true on drop (snap + broadcast); false while dragging. */
  onMove: (id: string, wx: number, wy: number, done: boolean) => void;
  /** Throttled raw-position broadcast while piloting (peers see live motion). */
  onLive?: (id: string, wx: number, wy: number) => void;
  /** Pilot mode started (token id) / ended (null). */
  onPilotChange?: (id: string | null) => void;
}

/** Distance from point to segment < r (circle-vs-wall collision). */
function segCircle(x1: number, y1: number, x2: number, y2: number, px: number, py: number, r: number): boolean {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const L2 = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / L2));
  const qx = x1 + t * dx;
  const qy = y1 + t * dy;
  return (px - qx) ** 2 + (py - qy) ** 2 < r * r;
}

const WALL_HEIGHT_CELLS = 2.2;
const WALL_THICKNESS = 0.12; // cells

export class ThreeVttView {
  private renderer: THREE.WebGLRenderer | null = null;
  private scene3 = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(55, 1, 1, 100000);
  private controls: OrbitControls | null = null;
  private host: HTMLElement | null = null;
  private ro: ResizeObserver | null = null;
  private raf = 0;

  private ground: THREE.Mesh | null = null;
  private gridLines: THREE.LineSegments | null = null;
  private wallGroup = new THREE.Group();
  private lightGroup = new THREE.Group();
  private tokenGroup = new THREE.Group();
  private fogGroup = new THREE.Group();
  private envGroup = new THREE.Group();
  private ambient!: THREE.AmbientLight;
  private sun!: THREE.DirectionalLight;
  private atmo: VttAtmosphere = defaultAtmosphere();
  private atmoKey = "";
  private mist: THREE.Mesh | null = null;
  private particlePts: THREE.Points | null = null;
  private particleVel: Float32Array | null = null;
  private particleBounds = { w: 0, d: 0, h: 0 };
  private texCache = new Map<string, THREE.Texture>();
  private groundTexSrc = "";
  private groundTex: THREE.Texture | null = null;

  private ray = new THREE.Raycaster();
  private pointer = new THREE.Vector2();
  private dragId: string | null = null;
  private downAt = { x: 0, y: 0 };
  private moved = false;

  // ── Pilot mode: possess a token and drive it with the arrow keys ──
  private pilotId: string | null = null;
  private keys = new Set<string>();
  private clock = new THREE.Clock();
  private lastLiveOp = 0;

  private vtt: VttScene | null = null;
  private selection: VttSelection = null;

  constructor(private hooks: Hooks) {}

  init(host: HTMLElement): void {
    this.host = host;
    const r = new THREE.WebGLRenderer({ antialias: true });
    r.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    r.setClearColor(0x060a14);
    host.appendChild(r.domElement);
    this.renderer = r;

    this.ambient = new THREE.AmbientLight(0x8090b0, 0.7);
    this.sun = new THREE.DirectionalLight(0xfff4e0, 1.1);
    this.sun.position.set(1500, 2600, 1000);
    this.scene3.add(this.ambient, this.sun, this.sun.target, this.wallGroup, this.lightGroup, this.tokenGroup, this.fogGroup, this.envGroup);

    this.controls = new OrbitControls(this.camera, r.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.maxPolarAngle = Math.PI * 0.49; // stay above the table

    r.domElement.addEventListener("pointerdown", this.onDown);
    r.domElement.addEventListener("pointermove", this.onMovePtr);
    window.addEventListener("pointerup", this.onUp);
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);

    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(host);
    this.resize();

    const loop = () => {
      this.raf = requestAnimationFrame(loop);
      this.frames++;
      if (!this.host || this.host.offsetParent === null) return; // hidden — skip
      try {
        this.renderOnce();
      } catch (e) {
        this.lastError = e instanceof Error ? e.message : String(e);
      }
    };
    loop();
  }

  /** One frame: size check + pilot step + controls + render. The rAF loop drives
   *  this; public so tests / headless environments (where rAF is paused) can render. */
  renderOnce(): void {
    if (!this.renderer) return;
    this.ensureSize(); // covers hidden→shown flips the ResizeObserver can miss
    const dt = Math.min(this.clock.getDelta(), 0.1);
    if (this.pilotId) this.updatePilot(dt);
    else this.controls?.update();
    this.animateAtmosphere(dt);
    this.renderer.render(this.scene3, this.camera);
    this.rendered++;
  }

  /** Enter pilot mode on a token: arrow keys drive it (camera-relative), walls
   *  block, the camera follows third-person. Esc or stopPilot() exits. */
  startPilot(id: string): void {
    this.pilotId = id;
    this.keys.clear();
    this.clock.getDelta(); // reset dt so the first step isn't huge
    if (this.controls) this.controls.enabled = false;
    this.hooks.onPilotChange?.(id);
  }
  stopPilot(commit = true): void {
    if (!this.pilotId) return;
    const id = this.pilotId;
    this.pilotId = null;
    this.keys.clear();
    if (this.controls) this.controls.enabled = true;
    const t = this.vtt?.data.tokens.find((x) => x.id === id);
    if (commit && t) this.hooks.onMove(id, t.x, t.y, true); // snap + broadcast + persist
    this.hooks.onPilotChange?.(null);
  }
  get piloting(): string | null {
    return this.pilotId;
  }

  /** Project a token to CSS pixels within the host (for DOM overlays like the
   *  radial menu). Returns null if the token is gone or behind the camera. */
  projectToken(id: string): { x: number; y: number; r: number } | null {
    if (!this.vtt || !this.renderer) return null;
    const t = this.vtt.data.tokens.find((x) => x.id === id);
    if (!t || t.visible === false) return null;
    const s = this.vtt.data.grid.size;
    const size = (t.size || 1) * s;
    const elev = this.heightAt(this.vtt, t.x, t.y);
    const rect = this.renderer.domElement.getBoundingClientRect();
    const center = new THREE.Vector3(t.x, elev + size * 0.5, t.y).project(this.camera);
    if (center.z > 1) return null; // behind the camera
    const x = (center.x * 0.5 + 0.5) * rect.width;
    const y = (-center.y * 0.5 + 0.5) * rect.height;
    const edge = new THREE.Vector3(t.x + size * 0.5, elev + size * 0.5, t.y).project(this.camera);
    const ex = (edge.x * 0.5 + 0.5) * rect.width;
    return { x, y, r: Math.abs(ex - x) + 26 };
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    if (!this.pilotId) return;
    if (e.key === "Escape") {
      e.preventDefault();
      this.stopPilot();
      return;
    }
    if (e.key.startsWith("Arrow")) {
      e.preventDefault();
      this.keys.add(e.key);
    }
  };
  private onKeyUp = (e: KeyboardEvent): void => {
    if (e.key.startsWith("Arrow")) this.keys.delete(e.key);
  };

  /** Reposition a token's visual (sprite/model + ring) without a rebuild. */
  private moveVisual(id: string, x: number, z: number): void {
    if (!this.vtt) return;
    const y = this.heightAt(this.vtt, x, z);
    for (const ch of this.tokenGroup.children) {
      if (ch.userData.tokenId === id) ch.position.set(x, y + (ch.userData.yOff ?? 0), z);
      else if (ch.userData.ringFor === id) ch.position.set(x, y + 2, z);
    }
  }

  private updatePilot(dt: number): void {
    if (!this.pilotId || !this.vtt) return;
    const t = this.vtt.data.tokens.find((x) => x.id === this.pilotId);
    if (!t) {
      this.stopPilot(false);
      return;
    }
    const g = this.vtt.data.grid;
    // camera-relative movement on the ground plane
    const fwd = new THREE.Vector3();
    this.camera.getWorldDirection(fwd);
    fwd.y = 0;
    if (fwd.lengthSq() < 0.0001) fwd.set(0, 0, -1);
    fwd.normalize();
    const right = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0));
    let mx = 0;
    let mz = 0;
    if (this.keys.has("ArrowUp")) (mx += fwd.x), (mz += fwd.z);
    if (this.keys.has("ArrowDown")) (mx -= fwd.x), (mz -= fwd.z);
    if (this.keys.has("ArrowRight")) (mx += right.x), (mz += right.z);
    if (this.keys.has("ArrowLeft")) (mx -= right.x), (mz -= right.z);
    if (mx || mz) {
      const len = Math.hypot(mx, mz);
      const speed = 5 * g.size; // 5 cells per second
      const nx = Math.max(0, Math.min(g.cols * g.size, t.x + (mx / len) * speed * dt));
      const nz = Math.max(0, Math.min(g.rows * g.size, t.y + (mz / len) * speed * dt));
      const r = ((t.size || 1) * g.size) / 2 - 6; // body radius, slight give
      const blocked = this.vtt.data.walls.some((w) => segCircle(w.x1, w.y1, w.x2, w.y2, nx, nz, Math.max(8, r)));
      if (!blocked) {
        this.hooks.onMove(this.pilotId, nx, nz, false);
        this.moveVisual(this.pilotId, nx, nz);
        const now = performance.now();
        if (now - this.lastLiveOp > 250) {
          this.lastLiveOp = now;
          this.hooks.onLive?.(this.pilotId, nx, nz);
        }
      }
    }
    // third-person follow: keep the camera's current bearing, settle behind/above
    const elev = this.heightAt(this.vtt, t.x, t.y);
    const target = new THREE.Vector3(t.x, elev + g.size * 0.8, t.y);
    this.controls?.target.lerp(target, 0.18);
    const off = new THREE.Vector3().subVectors(this.camera.position, this.controls?.target ?? target);
    off.y = 0;
    if (off.lengthSq() < 1) off.set(0, 0, 1);
    off.normalize().multiplyScalar(6 * g.size);
    const desired = new THREE.Vector3(target.x + off.x, elev + 3.2 * g.size, target.z + off.z);
    this.camera.position.lerp(desired, 0.08);
    this.camera.lookAt(this.controls?.target ?? target);
  }

  /** Diagnostics (dev). */
  frames = 0;
  rendered = 0;
  lastError = "";

  private lastSize = { w: 0, h: 0 };
  private ensureSize(): void {
    if (!this.host || !this.renderer) return;
    const w = Math.max(1, this.host.clientWidth);
    const h = Math.max(1, this.host.clientHeight);
    if (w === this.lastSize.w && h === this.lastSize.h) return;
    this.lastSize = { w, h };
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }
  private resize(): void {
    this.lastSize = { w: 0, h: 0 };
    this.ensureSize();
  }

  /** Aim the camera at the grid centre from a pleasant tabletop angle. */
  frame(scene: VttScene): void {
    const { grid } = scene.data;
    const cx = (grid.cols * grid.size) / 2;
    const cz = (grid.rows * grid.size) / 2;
    const span = Math.max(grid.cols, grid.rows) * grid.size;
    this.camera.position.set(cx, span * 0.65, cz + span * 0.55);
    this.controls?.target.set(cx, 0, cz);
    this.controls?.update();
  }

  /** Rebuild/refresh the 3D world from scene data (called on every engine change). */
  syncFrom(scene: VttScene, selection: VttSelection): void {
    const firstScene = this.vtt?.id !== scene.id;
    this.vtt = scene;
    this.selection = selection;
    // Vision parity with the 2D fog: null = fog off (everything visible).
    const visible = scene.data.fog.enabled && scene.data.layers.fog ? computeVisibleCells(scene.data) : null;
    this.applyAtmosphere(scene);
    this.buildGround(scene);
    this.buildWalls(scene);
    this.buildLights(scene);
    this.buildTokens(scene, visible);
    this.buildFog(scene, visible);
    if (firstScene) this.frame(scene);
  }

  /** Fog of war in 3D: dark quads over non-visible cells (deep for unseen, dim
   *  for explored), floating just above the ground. Tokens outside vision are
   *  hidden in buildTokens — matching how the 2D fog paints over them. */
  private buildFog(scene: VttScene, visible: Set<string> | null): void {
    for (const ch of this.fogGroup.children) (ch as THREE.Mesh).geometry?.dispose();
    this.fogGroup.clear();
    if (!visible) return;
    const { grid, fog } = scene.data;
    const revealed = new Set(fog.revealed);
    const s = grid.size;
    const unseen: number[] = [];
    const explored: number[] = [];
    const quad = (arr: number[], c: number, r: number) => {
      const x0 = c * s, x1 = x0 + s, z0 = r * s, z1 = z0 + s;
      const y = this.heightAt(scene, (c + 0.5) * s, (r + 0.5) * s) + 3; // fog follows the terrain
      arr.push(x0, y, z0, x0, y, z1, x1, y, z1, x0, y, z0, x1, y, z1, x1, y, z0);
    };
    for (let c = 0; c < grid.cols; c++) {
      for (let r = 0; r < grid.rows; r++) {
        const k = cellKey(c, r);
        if (visible.has(k)) continue;
        quad(revealed.has(k) ? explored : unseen, c, r);
      }
    }
    const addMesh = (pts: number[], opacity: number) => {
      if (!pts.length) return;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
      const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0x030610, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide }));
      this.fogGroup.add(mesh);
    };
    addMesh(unseen, 0.92);
    addMesh(explored, 0.55);
  }

  /** Apply the scene's atmosphere: backdrop, depth fog, mood lighting, ground
   *  mist, particles, and shadow mapping. Rebuilds only when settings change. */
  private applyAtmosphere(scene: VttScene): void {
    const atmo = scene.data.atmosphere ?? defaultAtmosphere();
    const { grid } = scene.data;
    const span = Math.max(grid.cols, grid.rows) * grid.size;
    const cx = (grid.cols * grid.size) / 2;
    const cz = (grid.rows * grid.size) / 2;
    const key = JSON.stringify(atmo) + ":" + span;
    if (key === this.atmoKey) return;
    this.atmoKey = key;
    this.atmo = atmo;
    const mood = MOODS[atmo.mood] ?? MOODS.neutral;

    // mood lighting
    this.ambient.color.set(mood.amb);
    this.ambient.intensity = mood.ambI;
    this.sun.color.set(mood.sun);
    this.sun.intensity = mood.sunI;
    this.sun.position.set(cx + span * 0.5, span * 1.2, cz + span * 0.4);
    this.sun.target.position.set(cx, 0, cz);

    // depth fog + clear colour (edges melt into the haze)
    this.renderer?.setClearColor(mood.fog);
    this.scene3.fog = atmo.fog > 0 ? new THREE.Fog(mood.fog, span * 0.55, span * (2.6 - atmo.fog * 1.7)) : null;

    // shadows
    const sh = atmo.shadows;
    if (this.renderer) this.renderer.shadowMap.enabled = sh;
    this.sun.castShadow = sh;
    if (sh) {
      this.sun.shadow.camera.left = -span * 0.75;
      this.sun.shadow.camera.right = span * 0.75;
      this.sun.shadow.camera.top = span * 0.75;
      this.sun.shadow.camera.bottom = -span * 0.75;
      this.sun.shadow.camera.near = 1;
      this.sun.shadow.camera.far = span * 4;
      this.sun.shadow.mapSize.set(2048, 2048);
      this.sun.shadow.camera.updateProjectionMatrix();
    }
    if (this.ground) {
      this.ground.receiveShadow = true;
      (this.ground.material as THREE.Material).needsUpdate = true;
    }

    // environmental backdrop
    for (const ch of this.envGroup.children) {
      (ch as THREE.Mesh).geometry?.dispose();
    }
    this.envGroup.clear();
    if (atmo.env === "space") {
      const sky = new THREE.Mesh(
        new THREE.SphereGeometry(span * 6, 32, 16),
        new THREE.MeshBasicMaterial({ map: starTexture(), side: THREE.BackSide, fog: false })
      );
      sky.position.set(cx, 0, cz);
      this.envGroup.add(sky);
    } else if (atmo.env === "cavern") {
      const rock = rockTexture();
      rock.repeat.set(6, 3);
      const wall = new THREE.Mesh(
        new THREE.CylinderGeometry(span * 1.7, span * 1.7, span * 5, 48, 1, true),
        new THREE.MeshStandardMaterial({ map: rock, side: THREE.BackSide, roughness: 1 })
      );
      wall.position.set(cx, 0, cz);
      this.envGroup.add(wall);
    } else if (atmo.env === "wireframe") {
      const plane = new THREE.Mesh(
        new THREE.PlaneGeometry(span * 12, span * 12, 56, 56),
        new THREE.MeshBasicMaterial({ wireframe: true, color: 0x14403c, fog: true })
      );
      plane.rotation.x = -Math.PI / 2;
      plane.position.set(cx, -4, cz);
      this.envGroup.add(plane);
    }

    // ground mist
    if (this.mist) {
      this.mist.geometry.dispose();
      (this.mist.material as THREE.Material).dispose();
      this.scene3.remove(this.mist);
      this.mist = null;
    }
    if (atmo.mist) {
      const tex = mistTexture().clone();
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      tex.repeat.set(4, 3);
      this.mist = new THREE.Mesh(
        new THREE.PlaneGeometry(grid.cols * grid.size * 1.15, grid.rows * grid.size * 1.15),
        new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.55, depthWrite: false })
      );
      this.mist.rotation.x = -Math.PI / 2;
      this.mist.position.set(cx, grid.size * 0.18, cz);
      this.scene3.add(this.mist);
    }

    // particles
    this.buildParticles(atmo.particles, scene, span, cx, cz);
  }

  private buildParticles(kind: VttAtmosphere["particles"], scene: VttScene, span: number, cx: number, cz: number): void {
    if (this.particlePts) {
      this.particlePts.geometry.dispose();
      (this.particlePts.material as THREE.Material).dispose();
      this.scene3.remove(this.particlePts);
      this.particlePts = null;
      this.particleVel = null;
    }
    if (kind === "none") return;
    const { grid } = scene.data;
    const w = grid.cols * grid.size;
    const d = grid.rows * grid.size;
    const h = span * 0.45;
    this.particleBounds = { w, d, h };
    const N = kind === "rain" ? 600 : 350;
    const pos = new Float32Array(N * 3);
    const vel = new Float32Array(N * 3);
    const s = grid.size;
    for (let i = 0; i < N; i++) {
      pos[i * 3] = Math.random() * w;
      pos[i * 3 + 1] = Math.random() * h;
      pos[i * 3 + 2] = Math.random() * d;
      if (kind === "embers") {
        vel[i * 3] = (Math.random() - 0.5) * s * 0.15;
        vel[i * 3 + 1] = s * (0.25 + Math.random() * 0.45); // drift up
        vel[i * 3 + 2] = (Math.random() - 0.5) * s * 0.15;
      } else if (kind === "spores") {
        vel[i * 3] = (Math.random() - 0.5) * s * 0.12;
        vel[i * 3 + 1] = (Math.random() - 0.5) * s * 0.08;
        vel[i * 3 + 2] = (Math.random() - 0.5) * s * 0.12;
      } else if (kind === "rain") {
        vel[i * 3] = s * 0.35;
        vel[i * 3 + 1] = -s * (6 + Math.random() * 3); // fast fall
        vel[i * 3 + 2] = 0;
      } else {
        vel[i * 3] = (Math.random() - 0.5) * s * 0.3; // snow sway
        vel[i * 3 + 1] = -s * (0.5 + Math.random() * 0.4);
        vel[i * 3 + 2] = (Math.random() - 0.5) * s * 0.3;
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    const conf =
      kind === "embers"
        ? { color: 0xff9040, size: s * 0.12, opacity: 0.9, blending: THREE.AdditiveBlending }
        : kind === "spores"
          ? { color: 0x9fe07a, size: s * 0.16, opacity: 0.7, blending: THREE.AdditiveBlending }
          : kind === "rain"
            ? { color: 0x9ab8d8, size: s * 0.08, opacity: 0.55, blending: THREE.NormalBlending }
            : { color: 0xffffff, size: s * 0.14, opacity: 0.85, blending: THREE.NormalBlending };
    const mat = new THREE.PointsMaterial({
      map: dotTexture(),
      color: conf.color,
      size: conf.size,
      transparent: true,
      opacity: conf.opacity,
      depthWrite: false,
      blending: conf.blending,
    });
    this.particlePts = new THREE.Points(geo, mat);
    this.particlePts.userData.vel = vel;
    this.particleVel = vel;
    this.scene3.add(this.particlePts);
    void cx;
    void cz;
  }

  /** Advance mist scroll + particle motion each frame. */
  private animateAtmosphere(dt: number): void {
    if (this.mist) {
      const tex = (this.mist.material as THREE.MeshBasicMaterial).map;
      if (tex) {
        tex.offset.x += dt * 0.012;
        tex.offset.y += dt * 0.006;
      }
    }
    if (this.particlePts && this.particleVel) {
      const pos = this.particlePts.geometry.attributes.position;
      const { w, d, h } = this.particleBounds;
      for (let i = 0; i < pos.count; i++) {
        let x = pos.getX(i) + this.particleVel[i * 3] * dt;
        let y = pos.getY(i) + this.particleVel[i * 3 + 1] * dt;
        let z = pos.getZ(i) + this.particleVel[i * 3 + 2] * dt;
        if (y < 0) y = h; // fell below the floor → respawn at the top
        if (y > h) y = 0; // drifted above → respawn at the floor
        if (x < 0) x += w;
        if (x > w) x -= w;
        if (z < 0) z += d;
        if (z > d) z -= d;
        pos.setXYZ(i, x, y, z);
      }
      pos.needsUpdate = true;
    }
  }

  /** Terrain elevation (world units) at a 2D map point; 0 on flat scenes. */
  private heightAt(scene: VttScene, x: number, y: number): number {
    const t = scene.data.terrain;
    if (!t) return 0;
    const g = scene.data.grid;
    const c = Math.max(0, Math.min(g.cols - 1, Math.floor(x / g.size)));
    const r = Math.max(0, Math.min(g.rows - 1, Math.floor(y / g.size)));
    return (t.heights[r * g.cols + c] ?? 0) * t.maxCells * g.size;
  }

  /** Swap the ground geometry between flat and terrain-displaced (per-vertex
   *  heights from the cell heightmap; local Z = world up after the -90° tilt,
   *  unaffected by the (w,h,1) scale so heights stay in world units). */
  private groundGeoKey = "";
  private lastTerrainRef: unknown = undefined;
  private applyTerrain(scene: VttScene): void {
    if (!this.ground) return;
    const { grid } = scene.data;
    const terrain = scene.data.terrain ?? null;
    const key = terrain ? `${grid.cols}x${grid.rows}:${grid.size}:${terrain.maxCells}` : "flat";
    if (key === this.groundGeoKey && this.lastTerrainRef === terrain) return;
    this.groundGeoKey = key;
    this.lastTerrainRef = terrain;
    const old = this.ground.geometry;
    if (terrain) {
      const geo = new THREE.PlaneGeometry(1, 1, grid.cols, grid.rows);
      const pos = geo.attributes.position;
      // PlaneGeometry vertices are row-major, (cols+1) per row — map each vertex
      // to its cell by INDEX, never by float uv (float32 uv rounding skips rows).
      const vertsPerRow = grid.cols + 1;
      for (let i = 0; i < pos.count; i++) {
        const col = Math.min(grid.cols - 1, i % vertsPerRow);
        const row = Math.min(grid.rows - 1, Math.floor(i / vertsPerRow));
        pos.setZ(i, (terrain.heights[row * grid.cols + col] ?? 0) * terrain.maxCells * grid.size);
      }
      geo.computeVertexNormals();
      this.ground.geometry = geo;
    } else {
      this.ground.geometry = new THREE.PlaneGeometry(1, 1);
    }
    old.dispose();
  }

  private buildGround(scene: VttScene): void {
    const { grid, background } = scene.data;
    const w = grid.cols * grid.size;
    const h = grid.rows * grid.size;
    if (!this.ground) {
      this.ground = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshStandardMaterial({ color: 0x0c1220 }));
      this.ground.rotation.x = -Math.PI / 2;
      this.ground.name = "ground";
      this.scene3.add(this.ground);
    }
    this.applyTerrain(scene);
    this.ground.scale.set(w, h, 1);
    this.ground.position.set(w / 2, 0, h / 2);
    const mat = this.ground.material as THREE.MeshStandardMaterial;
    const src = background.src || "";
    if (src !== this.groundTexSrc) {
      this.groundTexSrc = src;
      this.groundTex?.dispose();
      this.groundTex = null;
      mat.map = null;
      mat.needsUpdate = true;
      if (src) {
        new THREE.TextureLoader().load(src, (tex) => {
          if (this.groundTexSrc !== src) return;
          tex.colorSpace = THREE.SRGBColorSpace;
          this.groundTex = tex;
          mat.map = tex;
          mat.color.set(0xffffff);
          mat.needsUpdate = true;
        });
      }
    }
    // The dark scene colour only tints an UNtextured ground: with a map texture
    // the tint must stay white, or every re-sync multiplies the map toward black.
    mat.color.set(mat.map ? 0xffffff : background.color || "#0c1220");
    // grid lines
    if (this.gridLines) {
      this.scene3.remove(this.gridLines);
      this.gridLines.geometry.dispose();
    }
    if (grid.visible) {
      const pts: number[] = [];
      for (let c = 0; c <= grid.cols; c++) pts.push(c * grid.size, 1, 0, c * grid.size, 1, h);
      for (let r = 0; r <= grid.rows; r++) pts.push(0, 1, r * grid.size, w, 1, r * grid.size);
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
      this.gridLines = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: 0x1a2233, transparent: true, opacity: 0.6 }));
      this.scene3.add(this.gridLines);
    } else {
      this.gridLines = null;
    }
  }

  private buildWalls(scene: VttScene): void {
    this.wallGroup.clear();
    const s = scene.data.grid.size;
    const height = WALL_HEIGHT_CELLS * s;
    const mat = new THREE.MeshStandardMaterial({ color: 0x2a3550, roughness: 0.85 });
    const selMat = new THREE.MeshStandardMaterial({ color: 0x7ecfca, roughness: 0.6 });
    for (const wl of scene.data.walls) {
      const dx = wl.x2 - wl.x1;
      const dy = wl.y2 - wl.y1;
      const len = Math.hypot(dx, dy);
      if (len < 1) continue;
      const box = new THREE.Mesh(new THREE.BoxGeometry(len, height, WALL_THICKNESS * s), this.selection?.kind === "wall" && this.selection.id === wl.id ? selMat : mat);
      box.position.set((wl.x1 + wl.x2) / 2, height / 2, (wl.y1 + wl.y2) / 2);
      box.rotation.y = -Math.atan2(dy, dx);
      box.castShadow = this.atmo.shadows;
      box.receiveShadow = this.atmo.shadows;
      this.wallGroup.add(box);
    }
  }

  private buildLights(scene: VttScene): void {
    this.lightGroup.clear();
    const s = scene.data.grid.size;
    if (!scene.data.layers.lights) return;
    let shadowLights = 0;
    for (const l of scene.data.lights) {
      const col = new THREE.Color(l.color || "#a08a4f");
      const pt = new THREE.PointLight(col, (l.intensity ?? 0.5) * 3.2, l.radius * s * 2.4, 1.6);
      pt.position.set(l.x, this.heightAt(scene, l.x, l.y) + s * 0.9, l.y);
      if (this.atmo.shadows && shadowLights < 4) {
        pt.castShadow = true; // walls/pillars cast from nearby lights (cap at 4 for GPU)
        pt.shadow.mapSize.set(512, 512);
        shadowLights++;
      }
      const marker = new THREE.Mesh(new THREE.SphereGeometry(s * 0.1, 12, 12), new THREE.MeshBasicMaterial({ color: col }));
      marker.position.copy(pt.position);
      this.lightGroup.add(pt, marker);
    }
  }

  // ── Tokens: Paper-Mario billboards (art or colour disc + name label) ──
  private tokenTexture(t: VttToken): THREE.Texture {
    const key = `${t.img || t.color}|${t.name}`;
    const hit = this.texCache.get(key);
    if (hit) return hit;
    const c = document.createElement("canvas");
    c.width = 256;
    c.height = 300;
    const x = c.getContext("2d")!;
    const drawDisc = () => {
      x.clearRect(0, 0, 256, 256);
      x.beginPath();
      x.arc(128, 128, 118, 0, Math.PI * 2);
      x.fillStyle = t.color || "#689a96";
      x.fill();
      x.lineWidth = 8;
      x.strokeStyle = "#04070d";
      x.stroke();
    };
    drawDisc();
    // name plate
    x.fillStyle = "rgba(4,7,13,0.75)";
    x.fillRect(0, 260, 256, 40);
    x.fillStyle = "#d5dbe6";
    x.font = "26px Georgia, serif";
    x.textAlign = "center";
    x.fillText((t.name || "").slice(0, 16), 128, 289);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    this.texCache.set(key, tex);
    if (t.img) {
      const img = new Image();
      img.onload = () => {
        x.save();
        x.beginPath();
        x.arc(128, 128, 118, 0, Math.PI * 2);
        x.clip();
        x.drawImage(img, 10, 10, 236, 236);
        x.restore();
        x.lineWidth = 8;
        x.strokeStyle = "#04070d";
        x.beginPath();
        x.arc(128, 128, 118, 0, Math.PI * 2);
        x.stroke();
        tex.needsUpdate = true;
      };
      img.src = t.img;
    }
    return tex;
  }

  // ── GLB token models: template cache by uri; instances cloned per build.
  // While a model loads (or if it fails) the billboard fallback shows instead. ──
  private modelLoader = new GLTFLoader();
  private modelCache = new Map<string, Promise<THREE.Object3D | null>>();
  private buildGen = 0;
  private loadModel(uri: string): Promise<THREE.Object3D | null> {
    let p = this.modelCache.get(uri);
    if (!p) {
      p = new Promise((resolve) => {
        this.modelLoader.load(uri, (gltf) => resolve(gltf.scene), undefined, () => resolve(null));
      });
      this.modelCache.set(uri, p);
    }
    return p;
  }
  /** Clone a loaded template, uniformly scaled so its ground footprint spans the
   *  token's cells, feet at y=0 within the wrapper. */
  private instantiateModel(template: THREE.Object3D, worldSize: number): THREE.Object3D {
    const inst = template.clone(true);
    inst.traverse((o) => {
      o.castShadow = this.atmo.shadows;
    });
    const box = new THREE.Box3().setFromObject(inst);
    const dim = new THREE.Vector3();
    box.getSize(dim);
    const footprint = Math.max(dim.x, dim.z, 0.001);
    const k = worldSize / footprint;
    const wrapper = new THREE.Group();
    inst.scale.setScalar(k);
    inst.position.set(-((box.min.x + box.max.x) / 2) * k, -box.min.y * k, -((box.min.z + box.max.z) / 2) * k);
    wrapper.add(inst);
    return wrapper;
  }

  private buildTokens(scene: VttScene, visible: Set<string> | null = null): void {
    this.tokenGroup.clear();
    const gen = ++this.buildGen;
    const s = scene.data.grid.size;
    if (!scene.data.layers.tokens) return;
    for (const t of scene.data.tokens) {
      if (t.visible === false) continue;
      // Fog parity: tokens outside current vision are hidden (2D fog paints over them).
      if (visible && !visible.has(cellKey(Math.floor(t.x / s), Math.floor(t.y / s)))) continue;
      const size = (t.size || 1) * s;
      const elev = this.heightAt(scene, t.x, t.y);
      if (t.model) {
        const uri = t.model;
        const tid = t.id;
        void this.loadModel(uri).then((template) => {
          if (!template || gen !== this.buildGen) return; // failed, or a newer build replaced us
          const obj = this.instantiateModel(template, size);
          obj.position.set(t.x, elev, t.y);
          obj.rotation.y = -(((t.rotation || 0) % 360) * Math.PI) / 180; // facing from the 2D rotate handle
          obj.userData.tokenId = tid;
          obj.userData.yOff = 0;
          // remove this token's placeholder billboard, then add the model
          for (const ch of [...this.tokenGroup.children]) {
            if (ch.userData.tokenId === tid && (ch as THREE.Sprite).isSprite) this.tokenGroup.remove(ch);
          }
          this.tokenGroup.add(obj);
        });
      }
      const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.tokenTexture(t), transparent: true }));
      spr.scale.set(size, size * (300 / 256), 1);
      spr.position.set(t.x, elev + (size * (300 / 256)) / 2, t.y);
      spr.userData.tokenId = t.id;
      spr.userData.yOff = (size * (300 / 256)) / 2;
      if (this.selection?.kind === "token" && this.selection.id === t.id) {
        const ring = new THREE.Mesh(
          new THREE.RingGeometry(size * 0.5, size * 0.56, 40),
          new THREE.MeshBasicMaterial({ color: 0x7ecfca, side: THREE.DoubleSide })
        );
        ring.rotation.x = -Math.PI / 2;
        ring.position.set(t.x, elev + 2, t.y);
        ring.userData.ringFor = t.id;
        this.tokenGroup.add(ring);
      }
      this.tokenGroup.add(spr);
    }
  }

  // ── Interaction: pick tokens, drag on the ground plane; orbit otherwise ──
  private setPointer(e: PointerEvent): void {
    const r = this.renderer!.domElement.getBoundingClientRect();
    this.pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  }
  private groundPoint(): THREE.Vector3 | null {
    if (!this.ground) return null;
    this.ray.setFromCamera(this.pointer, this.camera);
    const hits = this.ray.intersectObject(this.ground, false);
    return hits[0]?.point ?? null;
  }

  private onDown = (e: PointerEvent): void => {
    if (e.button !== 0 || !this.renderer) return;
    this.setPointer(e);
    this.downAt = { x: e.clientX, y: e.clientY };
    this.moved = false;
    this.ray.setFromCamera(this.pointer, this.camera);
    // recursive: GLB models are nested meshes — walk ancestors for the token id
    const hits = this.ray.intersectObjects(this.tokenGroup.children, true);
    let tokenId: string | null = null;
    for (const h of hits) {
      let o: THREE.Object3D | null = h.object;
      while (o && !o.userData.tokenId) o = o.parent;
      if (o?.userData.tokenId) {
        tokenId = o.userData.tokenId as string;
        break;
      }
    }
    if (tokenId) {
      this.dragId = tokenId;
      this.hooks.onSelect({ kind: "token", id: tokenId });
      if (this.controls) this.controls.enabled = false;
    }
  };
  private onMovePtr = (e: PointerEvent): void => {
    if (!this.dragId) return;
    if (Math.abs(e.clientX - this.downAt.x) + Math.abs(e.clientY - this.downAt.y) > 3) this.moved = true;
    if (!this.moved) return;
    this.setPointer(e);
    const p = this.groundPoint();
    if (!p) return;
    this.hooks.onMove(this.dragId, p.x, p.z, false);
    // Move the sprite (and its selection ring) immediately — mid-drag engine
    // updates don't tick a re-sync (by design), so this is the live feedback.
    // p.y is the raycast hit on the (possibly terrain-displaced) ground.
    for (const ch of this.tokenGroup.children) {
      if (ch.userData.tokenId === this.dragId) ch.position.set(p.x, p.y + (ch.userData.yOff ?? 0), p.z);
      else if (ch.userData.ringFor === this.dragId) ch.position.set(p.x, p.y + 2, p.z);
    }
  };
  private onUp = (e: PointerEvent): void => {
    if (this.dragId) {
      if (this.moved) {
        this.setPointer(e);
        const p = this.groundPoint();
        if (p) this.hooks.onMove(this.dragId, p.x, p.z, true);
      }
      this.dragId = null;
      if (this.controls) this.controls.enabled = true;
    }
  };

  destroy(): void {
    cancelAnimationFrame(this.raf);
    this.ro?.disconnect();
    if (this.renderer) {
      this.renderer.domElement.removeEventListener("pointerdown", this.onDown);
      this.renderer.domElement.removeEventListener("pointermove", this.onMovePtr);
      window.removeEventListener("pointerup", this.onUp);
      window.removeEventListener("keydown", this.onKeyDown);
      window.removeEventListener("keyup", this.onKeyUp);
      this.renderer.dispose();
      this.renderer.domElement.remove();
    }
    for (const tex of this.texCache.values()) tex.dispose();
    this.texCache.clear();
    this.groundTex?.dispose();
  }
}
