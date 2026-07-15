// 2D atmosphere: the flat top-down view is the STANDARD perspective, so every
// scene modification the Curator sets must be visible here. This layer renders:
//   • an environmental BACKDROP behind the map (space / cavern / wireframe / void)
//   • a height-fog colour wash (from the custom shader's colour + density)
//   • a mood colour-grade wash (multiply)
//   • a depth-fog vignette that fades the edges into the mood haze
//   • drifting ground MIST
//   • drifting PARTICLES (embers / spores / rain / snow)
//   • a SHADOWS ambient-darkening pass
// The backdrop sits BEHIND the world (added first on the stage); everything else
// is a screen-space overlay ON TOP of the map, so it stays fixed while the map
// pans/zooms.
import { Container, Graphics, Sprite, Texture, TilingSprite } from "pixi.js";
import { defaultAtmosphere, type VttAtmosphere, type VttScene } from "../../types/scene";

// Mood → { tint (multiply wash), fog (vignette/haze colour) }.
const MOOD_2D: Record<VttAtmosphere["mood"], { tint: number; fog: number }> = {
  neutral: { tint: 0xffffff, fog: 0x060a14 },
  moonlight: { tint: 0x9fb0e8, fog: 0x0a1028 },
  hellfire: { tint: 0xff7a4a, fog: 0x1c0a05 },
  toxic: { tint: 0x9fe07a, fog: 0x0a1608 },
  dusk: { tint: 0xffb070, fog: 0x160a14 },
};
// Environmental backdrop → base fill colour (the pattern tiles over it).
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

function makeTex(draw: (x: CanvasRenderingContext2D) => void): Texture {
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  draw(c.getContext("2d")!);
  return Texture.from(c);
}

// Lazily-built, cached, tileable pattern textures for the backdrops + mist.
let vignetteTex: Texture | null = null;
let starTex: Texture | null = null;
let rockTex: Texture | null = null;
let gridTex: Texture | null = null;
let mistTex: Texture | null = null;

function vignetteTexture(): Texture {
  if (!vignetteTex) {
    vignetteTex = makeTex((x) => {
      const g = x.createRadialGradient(128, 128, 40, 128, 128, 150);
      g.addColorStop(0, "rgba(255,255,255,0)");
      g.addColorStop(0.7, "rgba(255,255,255,0.35)");
      g.addColorStop(1, "rgba(255,255,255,1)");
      x.fillStyle = g;
      x.fillRect(0, 0, 256, 256);
    });
  }
  return vignetteTex;
}
function starTexture(): Texture {
  if (!starTex) {
    starTex = makeTex((x) => {
      for (let i = 0; i < 90; i++) {
        const a = 0.25 + Math.random() * 0.75;
        const r = Math.random() < 0.85 ? 0.6 : 1.3;
        x.fillStyle = `rgba(255,255,255,${a})`;
        x.beginPath();
        x.arc(Math.random() * 256, Math.random() * 256, r, 0, Math.PI * 2);
        x.fill();
      }
    });
  }
  return starTex;
}
function rockTexture(): Texture {
  if (!rockTex) {
    rockTex = makeTex((x) => {
      for (let i = 0; i < 260; i++) {
        const light = Math.random() < 0.5;
        const a = 0.04 + Math.random() * 0.09;
        x.fillStyle = light ? `rgba(150,130,110,${a})` : `rgba(0,0,0,${a + 0.05})`;
        x.beginPath();
        x.arc(Math.random() * 256, Math.random() * 256, 3 + Math.random() * 14, 0, Math.PI * 2);
        x.fill();
      }
    });
  }
  return rockTex;
}
function gridTexture(): Texture {
  if (!gridTex) {
    gridTex = makeTex((x) => {
      x.strokeStyle = "rgba(90,150,190,0.5)";
      x.lineWidth = 1;
      x.strokeRect(0.5, 0.5, 255, 255);
      x.strokeStyle = "rgba(60,110,150,0.28)";
      x.beginPath();
      x.moveTo(128, 0);
      x.lineTo(128, 256);
      x.moveTo(0, 128);
      x.lineTo(256, 128);
      x.stroke();
    });
  }
  return gridTex;
}
function mistTexture(): Texture {
  if (!mistTex) {
    mistTex = makeTex((x) => {
      for (let i = 0; i < 14; i++) {
        const cx = Math.random() * 256;
        const cy = Math.random() * 256;
        const rad = 40 + Math.random() * 70;
        const g = x.createRadialGradient(cx, cy, 0, cx, cy, rad);
        g.addColorStop(0, "rgba(255,255,255,0.16)");
        g.addColorStop(1, "rgba(255,255,255,0)");
        x.fillStyle = g;
        x.fillRect(cx - rad, cy - rad, rad * 2, rad * 2);
      }
    });
  }
  return mistTex;
}

interface P {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
}

export class AtmosphereLayer {
  // Behind the map: the environmental backdrop.
  readonly backdrop = new Container();
  private bgFill = new Graphics();
  private bgTile = new TilingSprite({ texture: starTexture(), width: 1, height: 1 });
  // On top of the map: washes, vignette, mist, particles.
  readonly view = new Container();
  private heightWash = new Graphics();
  private tint = new Graphics();
  private vignette = new Sprite(vignetteTexture());
  private shadowWash = new Graphics();
  private mist = new TilingSprite({ texture: mistTexture(), width: 1, height: 1 });
  private mist2 = new TilingSprite({ texture: mistTexture(), width: 1, height: 1 });
  private particleG = new Graphics();

  private parts: P[] = [];
  private kind: VttAtmosphere["particles"] = "none";
  private pColor = 0xffffff;
  private washOn = false;
  private washColor = 0xffffff;
  private bgColor = ENV_BASE.space;
  private heightAlpha = 0;
  private heightColor = 0x0c1220;
  private shadowAlpha = 0;
  private mistOn = false;
  private w = 0;
  private h = 0;

  constructor() {
    this.backdrop.eventMode = "none";
    this.view.eventMode = "none";
    this.vignette.anchor.set(0);
    this.mist.alpha = 0;
    this.mist2.alpha = 0;
    this.backdrop.addChild(this.bgFill, this.bgTile);
    // Order matters: height-fog wash + mood wash grade the map, then the
    // vignette + shadows darken, then mist and particles ride on top.
    this.view.addChild(this.heightWash, this.tint, this.vignette, this.shadowWash, this.mist, this.mist2, this.particleG);
  }

  private seed(kind: VttAtmosphere["particles"], w: number, h: number): void {
    const n = kind === "none" ? 0 : kind === "rain" ? 220 : 150;
    this.parts = [];
    for (let i = 0; i < n; i++) {
      const base = { x: Math.random() * w, y: Math.random() * h, vx: 0, vy: 0, r: 1.5 };
      if (kind === "embers") {
        base.vx = (Math.random() - 0.5) * 20;
        base.vy = -30 - Math.random() * 40; // rise
        base.r = 1.5 + Math.random() * 1.5;
      } else if (kind === "spores") {
        base.vx = (Math.random() - 0.5) * 16;
        base.vy = (Math.random() - 0.5) * 12;
        base.r = 2 + Math.random() * 2;
      } else if (kind === "rain") {
        base.vx = 120;
        base.vy = 900 + Math.random() * 300;
        base.r = 1;
      } else if (kind === "snow") {
        base.vx = (Math.random() - 0.5) * 30;
        base.vy = 60 + Math.random() * 50;
        base.r = 1.5 + Math.random() * 1.5;
      }
      this.parts.push(base);
    }
  }

  /** Configure from the scene's atmosphere (backdrop / mood / fog / shader /
   *  mist / particles / shadows) — every field is reflected in the 2D view. */
  draw(scene: VttScene, w: number, h: number): void {
    this.w = w;
    this.h = h;
    const atmo = scene.data.atmosphere ?? defaultAtmosphere();
    const M = MOOD_2D[atmo.mood] ?? MOOD_2D.neutral;

    // --- Backdrop (behind the map) ------------------------------------------
    this.bgColor = ENV_BASE[atmo.env] ?? ENV_BASE.space;
    this.bgFill.clear();
    this.bgFill.rect(0, 0, w, h).fill({ color: this.bgColor });
    this.bgTile.width = w;
    this.bgTile.height = h;
    if (atmo.env === "void") {
      this.bgTile.visible = false;
    } else {
      this.bgTile.visible = true;
      this.bgTile.texture = atmo.env === "cavern" ? rockTexture() : atmo.env === "wireframe" ? gridTexture() : starTexture();
      this.bgTile.alpha = atmo.env === "space" ? 0.9 : 1;
    }

    // --- Height-fog colour wash (from the custom shader) ---------------------
    // 2D has no altitude, but the shader's colour + density read as a coloured
    // haze grading the whole view, so enabling height fog is visible here too.
    const sh = atmo.shader;
    this.heightColor = sh ? hexNum(sh.color) : 0x0c1220;
    this.heightAlpha = sh?.heightFog ? Math.min(0.55, 0.15 + sh.density * 0.4) : 0;
    this.heightWash.clear();
    if (this.heightAlpha > 0) this.heightWash.rect(0, 0, w, h).fill({ color: this.heightColor, alpha: this.heightAlpha });

    // --- Mood colour-grade wash (multiply) ----------------------------------
    this.washOn = atmo.mood !== "neutral";
    this.washColor = M.tint;
    this.tint.clear();
    if (this.washOn) {
      this.tint.rect(0, 0, w, h).fill({ color: M.tint, alpha: 0.28 });
      this.tint.blendMode = "multiply";
    }

    // --- Depth-fog vignette --------------------------------------------------
    this.vignette.width = w;
    this.vignette.height = h;
    this.vignette.tint = M.fog;
    this.vignette.alpha = Math.min(0.95, atmo.fog);

    // --- Shadows (ambient darkening) ----------------------------------------
    this.shadowAlpha = atmo.shadows ? 0.22 : 0;
    this.shadowWash.clear();
    if (this.shadowAlpha > 0) {
      this.shadowWash.rect(0, 0, w, h).fill({ color: 0x000000, alpha: this.shadowAlpha });
      this.shadowWash.blendMode = "multiply";
    }

    // --- Mist ----------------------------------------------------------------
    this.mistOn = atmo.mist;
    this.mist.width = this.mist2.width = w;
    this.mist.height = this.mist2.height = h;
    const mistTintCol = mixToward(M.fog, 0xdfe8ff, 0.6);
    this.mist.tint = this.mist2.tint = mistTintCol;
    this.mist.alpha = atmo.mist ? 0.5 : 0;
    this.mist2.alpha = atmo.mist ? 0.32 : 0;

    // --- Particles -----------------------------------------------------------
    if (atmo.particles !== this.kind) {
      this.kind = atmo.particles;
      this.seed(atmo.particles, w, h);
    }
    this.pColor = PART_COLOR[atmo.particles] ?? 0xffffff;
    this.particleG.blendMode = atmo.particles === "embers" || atmo.particles === "spores" ? "add" : "normal";
  }

  /** Advance particles + mist + keep the overlay sized to the viewport. */
  animate(dt: number, w: number, h: number): void {
    if (w !== this.w || h !== this.h) {
      this.w = w;
      this.h = h;
      this.bgFill.clear();
      this.bgFill.rect(0, 0, w, h).fill({ color: this.bgColor });
      this.bgTile.width = w;
      this.bgTile.height = h;
      this.vignette.width = w;
      this.vignette.height = h;
      this.mist.width = this.mist2.width = w;
      this.mist.height = this.mist2.height = h;
      if (this.heightAlpha > 0) {
        this.heightWash.clear();
        this.heightWash.rect(0, 0, w, h).fill({ color: this.heightColor, alpha: this.heightAlpha });
      }
      if (this.washOn) {
        this.tint.clear();
        this.tint.rect(0, 0, w, h).fill({ color: this.washColor, alpha: 0.28 });
      }
      if (this.shadowAlpha > 0) {
        this.shadowWash.clear();
        this.shadowWash.rect(0, 0, w, h).fill({ color: 0x000000, alpha: this.shadowAlpha });
      }
    }

    // Drifting mist (two layers at different speeds for parallax depth).
    if (this.mistOn) {
      this.mist.tilePosition.x += dt * 9;
      this.mist.tilePosition.y -= dt * 2;
      this.mist2.tilePosition.x -= dt * 5;
      this.mist2.tilePosition.y += dt * 1.5;
    }

    if (!this.parts.length) {
      this.particleG.clear();
      return;
    }
    const g = this.particleG;
    g.clear();
    for (const p of this.parts) {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.y < -4) p.y = h + 4;
      if (p.y > h + 4) p.y = -4;
      if (p.x < -4) p.x = w + 4;
      if (p.x > w + 4) p.x = -4;
      if (this.kind === "rain") g.rect(p.x, p.y, 1, 7).fill({ color: this.pColor, alpha: 0.5 });
      else g.circle(p.x, p.y, p.r).fill({ color: this.pColor, alpha: 0.75 });
    }
  }
}

// "#rrggbb" → 0xrrggbb (tolerant of a missing leading hash / bad input).
function hexNum(hex: string): number {
  const n = parseInt((hex || "").replace(/^#/, ""), 16);
  return Number.isFinite(n) ? n : 0x0c1220;
}
// Linear blend of two packed RGB colours (t=0 → a, t=1 → b).
function mixToward(a: number, b: number, t: number): number {
  const ar = (a >> 16) & 0xff, ag = (a >> 8) & 0xff, ab = a & 0xff;
  const br = (b >> 16) & 0xff, bg = (b >> 8) & 0xff, bb = b & 0xff;
  const r = Math.round(ar + (br - ar) * t);
  const g = Math.round(ag + (bg - ag) * t);
  const bl = Math.round(ab + (bb - ab) * t);
  return (r << 16) | (g << 8) | bl;
}
