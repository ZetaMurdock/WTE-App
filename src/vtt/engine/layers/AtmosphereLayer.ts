// 2D atmosphere. The flat top-down view is the STANDARD perspective, so every
// scene modification the Curator sets must be visible AND look good — no matter
// how you pan, zoom, reset, or revisit the scene.
//
// Two kinds of effect, split by whether they have visible structure:
//   • WORLD-ANCHORED (children of the engine's `world`, so they pan/zoom WITH
//     the map — the camera moves over them, they don't slide with the camera):
//       - backdrop  : the void behind the map (space / cavern / wireframe / void)
//       - worldFx   : drifting mist + weather particles (rain/snow/embers/spores)
//     These are drawn seam-free (scattered graphics + soft gradient sprites) —
//     never tiled — so they can't show the "textile block" repeat artefact.
//   • SCREEN-SPACE post grades (on the stage, uniform, no structure, so they read
//     fine fixed to the frame): mood colour wash, depth vignette, height-fog tint,
//     shadows. A uniform tint has nothing to "slide", so it never looks detached.
import { Container, Graphics, Sprite, Texture } from "pixi.js";
import { defaultAtmosphere, type VttAtmosphere, type VttScene } from "../../types/scene";

// Mood → { tint (multiply wash), fog (vignette/haze colour) }.
const MOOD_2D: Record<VttAtmosphere["mood"], { tint: number; fog: number }> = {
  neutral: { tint: 0xffffff, fog: 0x060a14 },
  moonlight: { tint: 0x9fb0e8, fog: 0x0a1028 },
  hellfire: { tint: 0xff7a4a, fog: 0x1c0a05 },
  toxic: { tint: 0x9fe07a, fog: 0x0a1608 },
  dusk: { tint: 0xffb070, fog: 0x160a14 },
};
const ENV_BASE: Record<VttAtmosphere["env"], number> = {
  space: 0x05070f,
  cavern: 0x0a0806,
  wireframe: 0x03060a,
  void: 0x010102,
};
const PART_COLOR: Record<VttAtmosphere["particles"], number> = {
  none: 0xffffff,
  embers: 0xff9040,
  spores: 0x9fe07a,
  rain: 0x9ab8d8,
  snow: 0xffffff,
};
// Approx world-px² of map per particle (smaller = denser). Count is clamped.
const PART_AREA: Record<VttAtmosphere["particles"], number> = {
  none: 1, embers: 26000, spores: 24000, rain: 11000, snow: 20000,
};

let vignetteTex: Texture | null = null;
let softTex: Texture | null = null;

function makeCanvas(draw: (x: CanvasRenderingContext2D, s: number) => void, size = 256): Texture {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  draw(c.getContext("2d")!, size);
  return Texture.from(c);
}
function vignetteTexture(): Texture {
  if (!vignetteTex) {
    vignetteTex = makeCanvas((x, s) => {
      const g = x.createRadialGradient(s / 2, s / 2, s * 0.16, s / 2, s / 2, s * 0.58);
      g.addColorStop(0, "rgba(255,255,255,0)");
      g.addColorStop(0.7, "rgba(255,255,255,0.35)");
      g.addColorStop(1, "rgba(255,255,255,1)");
      x.fillStyle = g;
      x.fillRect(0, 0, s, s);
    });
  }
  return vignetteTex;
}
// A single soft radial blob (opaque centre → transparent edge). Tinted + scaled
// per mist puff; being one smooth sprite, it has no seams to repeat.
function softTexture(): Texture {
  if (!softTex) {
    softTex = makeCanvas((x, s) => {
      const g = x.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
      g.addColorStop(0, "rgba(255,255,255,0.9)");
      g.addColorStop(0.5, "rgba(255,255,255,0.5)");
      g.addColorStop(1, "rgba(255,255,255,0)");
      x.fillStyle = g;
      x.fillRect(0, 0, s, s);
    });
  }
  return softTex;
}

interface P { x: number; y: number; vx: number; vy: number; r: number; }
interface Puff { sprite: Sprite; x: number; y: number; vx: number; vy: number; }

function clamp(n: number, lo: number, hi: number): number {
  return n < lo ? lo : n > hi ? hi : n;
}

export class AtmosphereLayer {
  // WORLD-anchored (added into the engine's `world`): pan/zoom with the map.
  readonly backdrop = new Container();
  readonly worldFx = new Container();
  private bgFill = new Graphics();
  private bgDetail = new Graphics();
  private mist = new Container();
  private puffs: Puff[] = [];
  private particleG = new Graphics();
  // SCREEN-space grades (added onto the stage): fixed to the frame.
  readonly view = new Container();
  private heightWash = new Graphics();
  private tint = new Graphics();
  private vignette = new Sprite(vignetteTexture());
  private shadowWash = new Graphics();

  private parts: P[] = [];
  private kind: VttAtmosphere["particles"] = "none";
  private pColor = 0xffffff;
  private washOn = false;
  private washColor = 0xffffff;
  private heightAlpha = 0;
  private heightColor = 0x0c1220;
  private shadowAlpha = 0;
  private sw = 0; // screen size (for the grades)
  private sh = 0;
  private mapW = 0; // world-space map bounds (for world effects)
  private mapH = 0;
  private detailKey = ""; // env + bounds signature so detail rebuilds only on change

  constructor() {
    this.backdrop.eventMode = "none";
    this.worldFx.eventMode = "none";
    this.view.eventMode = "none";
    this.vignette.anchor.set(0);
    this.backdrop.addChild(this.bgFill, this.bgDetail);
    this.worldFx.addChild(this.mist, this.particleG);
    this.view.addChild(this.heightWash, this.tint, this.vignette, this.shadowWash);
  }

  // ---- world backdrop -----------------------------------------------------
  // Cover a generous margin around the map so panning/zooming out reveals the
  // environment around the play area (never a hard edge onto nothing).
  private drawBackdrop(env: VttAtmosphere["env"], grid: number): void {
    const M = Math.max(this.mapW, this.mapH, 1200);
    const x0 = -M, y0 = -M, w = this.mapW + 2 * M, h = this.mapH + 2 * M;
    this.bgFill.clear();
    this.bgFill.rect(x0, y0, w, h).fill({ color: ENV_BASE[env] ?? ENV_BASE.space });

    const key = env + "|" + Math.round(this.mapW) + "x" + Math.round(this.mapH);
    if (key === this.detailKey) return; // scatter is expensive; only when it changes
    this.detailKey = key;
    const g = this.bgDetail;
    g.clear();
    if (env === "space") {
      const n = clamp(Math.round((w * h) / 42000), 80, 1400);
      for (let i = 0; i < n; i++) {
        const a = 0.25 + Math.random() * 0.7;
        const r = Math.random() < 0.85 ? 0.8 : 1.7;
        g.circle(x0 + Math.random() * w, y0 + Math.random() * h, r).fill({ color: 0xffffff, alpha: a });
      }
    } else if (env === "cavern") {
      const n = clamp(Math.round((w * h) / 60000), 60, 900);
      for (let i = 0; i < n; i++) {
        const light = Math.random() < 0.5;
        g.circle(x0 + Math.random() * w, y0 + Math.random() * h, 6 + Math.random() * 22).fill({
          color: light ? 0x8a7a66 : 0x000000,
          alpha: light ? 0.05 + Math.random() * 0.06 : 0.08 + Math.random() * 0.08,
        });
      }
    } else if (env === "wireframe") {
      const step = Math.max(grid, 40);
      for (let gx = x0; gx <= x0 + w; gx += step) g.moveTo(gx, y0).lineTo(gx, y0 + h);
      for (let gy = y0; gy <= y0 + h; gy += step) g.moveTo(x0, gy).lineTo(x0 + w, gy);
      g.stroke({ color: 0x3a6b8f, alpha: 0.22, width: 1 });
    }
    // void: solid fill only, no detail.
  }

  // ---- drifting mist (world) ----------------------------------------------
  private syncMist(on: boolean, color: number): void {
    const want = on ? clamp(Math.round((this.mapW * this.mapH) / 220000), 5, 20) : 0;
    while (this.puffs.length > want) {
      const p = this.puffs.pop()!;
      p.sprite.destroy();
    }
    while (this.puffs.length < want) {
      const sprite = new Sprite(softTexture());
      sprite.anchor.set(0.5);
      this.mist.addChild(sprite);
      const r = clamp(Math.min(this.mapW, this.mapH) * (0.22 + Math.random() * 0.2), 220, 900);
      this.puffs.push({
        sprite,
        x: Math.random() * this.mapW,
        y: Math.random() * this.mapH,
        vx: (Math.random() - 0.5) * 14,
        vy: (Math.random() - 0.5) * 6,
      });
      sprite.width = sprite.height = r * 2;
    }
    for (const p of this.puffs) {
      p.sprite.tint = color;
      p.sprite.alpha = 0.14 + Math.random() * 0.06;
      p.sprite.position.set(p.x, p.y);
    }
  }

  // ---- weather particles (world) ------------------------------------------
  private seed(kind: VttAtmosphere["particles"]): void {
    const w = this.mapW, h = this.mapH;
    const n = kind === "none" ? 0 : clamp(Math.round((w * h) / PART_AREA[kind]), 40, 700);
    this.parts = [];
    for (let i = 0; i < n; i++) {
      const base: P = { x: Math.random() * w, y: Math.random() * h, vx: 0, vy: 0, r: 1.5 };
      if (kind === "embers") {
        base.vx = (Math.random() - 0.5) * 20; base.vy = -30 - Math.random() * 40; base.r = 1.5 + Math.random() * 1.5;
      } else if (kind === "spores") {
        base.vx = (Math.random() - 0.5) * 16; base.vy = (Math.random() - 0.5) * 12; base.r = 2 + Math.random() * 2;
      } else if (kind === "rain") {
        base.vx = 120; base.vy = 900 + Math.random() * 300; base.r = 1;
      } else if (kind === "snow") {
        base.vx = (Math.random() - 0.5) * 30; base.vy = 60 + Math.random() * 50; base.r = 1.5 + Math.random() * 1.5;
      }
      this.parts.push(base);
    }
  }

  /** Configure from the scene's atmosphere — every field reflected in 2D. */
  draw(scene: VttScene, screenW: number, screenH: number): void {
    this.sw = screenW;
    this.sh = screenH;
    const atmo = scene.data.atmosphere ?? defaultAtmosphere();
    const M = MOOD_2D[atmo.mood] ?? MOOD_2D.neutral;
    const grid = scene.data.grid;
    const boundsChanged = this.mapW !== grid.cols * grid.size || this.mapH !== grid.rows * grid.size;
    this.mapW = grid.cols * grid.size;
    this.mapH = grid.rows * grid.size;

    // --- WORLD: backdrop -----------------------------------------------------
    this.drawBackdrop(atmo.env, grid.size);

    // --- WORLD: mist ---------------------------------------------------------
    this.syncMist(atmo.mist, mixToward(M.fog, 0xdfe8ff, 0.6));

    // --- WORLD: particles ----------------------------------------------------
    if (atmo.particles !== this.kind || boundsChanged) {
      this.kind = atmo.particles;
      this.seed(atmo.particles);
    }
    this.pColor = PART_COLOR[atmo.particles] ?? 0xffffff;
    this.particleG.blendMode = atmo.particles === "embers" || atmo.particles === "spores" ? "add" : "normal";

    // --- SCREEN: height-fog colour wash --------------------------------------
    const sh = atmo.shader;
    this.heightColor = sh ? hexNum(sh.color) : 0x0c1220;
    this.heightAlpha = sh?.heightFog ? Math.min(0.5, 0.14 + sh.density * 0.36) : 0;
    this.paintScreen();

    // --- SCREEN: mood + vignette + shadows -----------------------------------
    this.washOn = atmo.mood !== "neutral";
    this.washColor = M.tint;
    this.vignette.tint = M.fog;
    this.vignette.alpha = Math.min(0.95, atmo.fog);
    this.shadowAlpha = atmo.shadows ? 0.22 : 0;
    this.paintScreen();
  }

  /** (Re)paint the uniform screen-space grades at the current viewport size. */
  private paintScreen(): void {
    const w = this.sw, h = this.sh;
    this.heightWash.clear();
    if (this.heightAlpha > 0) this.heightWash.rect(0, 0, w, h).fill({ color: this.heightColor, alpha: this.heightAlpha });
    this.tint.clear();
    if (this.washOn) {
      this.tint.rect(0, 0, w, h).fill({ color: this.washColor, alpha: 0.28 });
      this.tint.blendMode = "multiply";
    }
    this.vignette.width = w;
    this.vignette.height = h;
    this.shadowWash.clear();
    if (this.shadowAlpha > 0) {
      this.shadowWash.rect(0, 0, w, h).fill({ color: 0x000000, alpha: this.shadowAlpha });
      this.shadowWash.blendMode = "multiply";
    }
  }

  /** Advance world mist + particles; keep the screen grades sized to the view. */
  animate(dt: number, screenW: number, screenH: number): void {
    if (screenW !== this.sw || screenH !== this.sh) {
      this.sw = screenW;
      this.sh = screenH;
      this.paintScreen();
    }

    // Mist drifts in WORLD space, wrapping around the map bounds.
    if (this.puffs.length) {
      const w = this.mapW, h = this.mapH, pad = 900;
      for (const p of this.puffs) {
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        if (p.x < -pad) p.x = w + pad; else if (p.x > w + pad) p.x = -pad;
        if (p.y < -pad) p.y = h + pad; else if (p.y > h + pad) p.y = -pad;
        p.sprite.position.set(p.x, p.y);
      }
    }

    // Particles fall/rise in WORLD space, wrapping over the map.
    if (!this.parts.length) {
      this.particleG.clear();
      return;
    }
    const w = this.mapW, h = this.mapH, pad = 40;
    const g = this.particleG;
    g.clear();
    for (const p of this.parts) {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.y < -pad) p.y = h + pad; else if (p.y > h + pad) p.y = -pad;
      if (p.x < -pad) p.x = w + pad; else if (p.x > w + pad) p.x = -pad;
      if (this.kind === "rain") g.rect(p.x, p.y, 1.2, 8).fill({ color: this.pColor, alpha: 0.5 });
      else g.circle(p.x, p.y, p.r).fill({ color: this.pColor, alpha: 0.75 });
    }
  }
}

// "#rrggbb" → 0xrrggbb (tolerant of a missing hash / bad input).
function hexNum(hex: string): number {
  const n = parseInt((hex || "").replace(/^#/, ""), 16);
  return Number.isFinite(n) ? n : 0x0c1220;
}
// Linear blend of two packed RGB colours (t=0 → a, t=1 → b).
function mixToward(a: number, b: number, t: number): number {
  const ar = (a >> 16) & 0xff, ag = (a >> 8) & 0xff, ab = a & 0xff;
  const br = (b >> 16) & 0xff, bg = (b >> 8) & 0xff, bb = b & 0xff;
  return (Math.round(ar + (br - ar) * t) << 16) | (Math.round(ag + (bg - ag) * t) << 8) | Math.round(ab + (bb - ab) * t);
}
