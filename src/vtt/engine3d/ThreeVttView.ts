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
import type { VttScene, VttToken } from "../types/scene";
import type { VttSelection } from "../engine/PixiVttApp";

interface Hooks {
  onSelect: (sel: VttSelection) => void;
  /** done=true on drop (snap + broadcast); false while dragging. */
  onMove: (id: string, wx: number, wy: number, done: boolean) => void;
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
  private texCache = new Map<string, THREE.Texture>();
  private groundTexSrc = "";
  private groundTex: THREE.Texture | null = null;

  private ray = new THREE.Raycaster();
  private pointer = new THREE.Vector2();
  private dragId: string | null = null;
  private downAt = { x: 0, y: 0 };
  private moved = false;

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

    this.scene3.add(new THREE.AmbientLight(0x8090b0, 0.7));
    const sun = new THREE.DirectionalLight(0xfff4e0, 1.1);
    sun.position.set(1500, 2600, 1000);
    this.scene3.add(sun, this.wallGroup, this.lightGroup, this.tokenGroup);

    this.controls = new OrbitControls(this.camera, r.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.maxPolarAngle = Math.PI * 0.49; // stay above the table

    r.domElement.addEventListener("pointerdown", this.onDown);
    r.domElement.addEventListener("pointermove", this.onMovePtr);
    window.addEventListener("pointerup", this.onUp);

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

  /** One frame: size check + controls + render. The rAF loop drives this; it is
   *  public so tests / headless environments (where rAF is paused) can render. */
  renderOnce(): void {
    if (!this.renderer) return;
    this.ensureSize(); // covers hidden→shown flips the ResizeObserver can miss
    this.controls?.update();
    this.renderer.render(this.scene3, this.camera);
    this.rendered++;
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
    this.buildGround(scene);
    this.buildWalls(scene);
    this.buildLights(scene);
    this.buildTokens(scene);
    if (firstScene) this.frame(scene);
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
      this.wallGroup.add(box);
    }
  }

  private buildLights(scene: VttScene): void {
    this.lightGroup.clear();
    const s = scene.data.grid.size;
    if (!scene.data.layers.lights) return;
    for (const l of scene.data.lights) {
      const col = new THREE.Color(l.color || "#a08a4f");
      const pt = new THREE.PointLight(col, (l.intensity ?? 0.5) * 3.2, l.radius * s * 2.4, 1.6);
      pt.position.set(l.x, s * 0.9, l.y);
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

  private buildTokens(scene: VttScene): void {
    this.tokenGroup.clear();
    const s = scene.data.grid.size;
    if (!scene.data.layers.tokens) return;
    for (const t of scene.data.tokens) {
      if (t.visible === false) continue;
      const size = (t.size || 1) * s;
      const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.tokenTexture(t), transparent: true }));
      spr.scale.set(size, size * (300 / 256), 1);
      spr.position.set(t.x, (size * (300 / 256)) / 2, t.y);
      spr.userData.tokenId = t.id;
      if (this.selection?.kind === "token" && this.selection.id === t.id) {
        const ring = new THREE.Mesh(
          new THREE.RingGeometry(size * 0.5, size * 0.56, 40),
          new THREE.MeshBasicMaterial({ color: 0x7ecfca, side: THREE.DoubleSide })
        );
        ring.rotation.x = -Math.PI / 2;
        ring.position.set(t.x, 2, t.y);
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
    const hits = this.ray.intersectObjects(this.tokenGroup.children, false);
    const hit = hits.find((h) => h.object.userData.tokenId);
    if (hit) {
      this.dragId = hit.object.userData.tokenId as string;
      this.hooks.onSelect({ kind: "token", id: this.dragId });
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
    for (const ch of this.tokenGroup.children) {
      if (ch.userData.tokenId === this.dragId || ch.userData.ringFor === this.dragId) {
        ch.position.set(p.x, ch.position.y, p.z);
      }
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
      this.renderer.dispose();
      this.renderer.domElement.remove();
    }
    for (const tex of this.texCache.values()) tex.dispose();
    this.texCache.clear();
    this.groundTex?.dispose();
  }
}
