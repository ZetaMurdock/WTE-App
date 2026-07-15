// 2D atmosphere: a screen-space overlay (added to the Pixi stage, not the world,
// so it stays fixed while the map pans/zooms) giving the flat view the same mood
// as 3D — a mood colour-grade wash, a depth-fog vignette that fades the edges
// into the mood haze, and drifting particles (embers / spores / rain / snow).
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
const PART_COLOR: Record<VttAtmosphere["particles"], number> = {
  none: 0xffffff,
  embers: 0xff9040,
  spores: 0x9fe07a,
  rain: 0x9ab8d8,
  snow: 0xffffff,
};

let vignetteTex: Texture | null = null;
function vignetteTexture(): Texture {
  if (vignetteTex) return vignetteTex;
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const x = c.getContext("2d")!;
  const g = x.createRadialGradient(128, 128, 40, 128, 128, 150);
  g.addColorStop(0, "rgba(255,255,255,0)");
  g.addColorStop(0.7, "rgba(255,255,255,0.35)");
  g.addColorStop(1, "rgba(255,255,255,1)");
  x.fillStyle = g;
  x.fillRect(0, 0, 256, 256);
  vignetteTex = Texture.from(c);
  return vignetteTex;
}

interface P {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
}

export class AtmosphereLayer {
  readonly view = new Container();
  private tint = new Graphics();
  private vignette = new Sprite(vignetteTexture());
  private particleG = new Graphics();
  private parts: P[] = [];
  private kind: VttAtmosphere["particles"] = "none";
  private pColor = 0xffffff;
  private washOn = false;
  private washColor = 0xffffff;
  private w = 0;
  private h = 0;

  constructor() {
    this.view.eventMode = "none";
    this.vignette.anchor.set(0);
    this.view.addChild(this.tint, this.vignette, this.particleG);
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

  /** Configure from the scene's atmosphere (mood / fog / particle kind). */
  draw(scene: VttScene, w: number, h: number): void {
    this.w = w;
    this.h = h;
    const atmo = scene.data.atmosphere ?? defaultAtmosphere();
    const M = MOOD_2D[atmo.mood] ?? MOOD_2D.neutral;

    this.washOn = atmo.mood !== "neutral";
    this.washColor = M.tint;
    this.tint.clear();
    if (this.washOn) {
      this.tint.rect(0, 0, w, h).fill({ color: M.tint, alpha: 0.2 });
      this.tint.blendMode = "multiply";
    }

    this.vignette.width = w;
    this.vignette.height = h;
    this.vignette.tint = M.fog;
    this.vignette.alpha = Math.min(0.95, atmo.fog);

    if (atmo.particles !== this.kind) {
      this.kind = atmo.particles;
      this.seed(atmo.particles, w, h);
    }
    this.pColor = PART_COLOR[atmo.particles] ?? 0xffffff;
    this.particleG.blendMode = atmo.particles === "embers" || atmo.particles === "spores" ? "add" : "normal";
  }

  /** Advance particles + keep the overlay sized to the current viewport. */
  animate(dt: number, w: number, h: number): void {
    if (w !== this.w || h !== this.h) {
      this.w = w;
      this.h = h;
      this.vignette.width = w;
      this.vignette.height = h;
      // keep the mood wash covering the viewport after a resize
      if (this.washOn) {
        this.tint.clear();
        this.tint.rect(0, 0, w, h).fill({ color: this.washColor, alpha: 0.2 });
      }
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
