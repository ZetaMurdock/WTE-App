// Fog of war with three darkness levels (scene.data.fog.mode):
//   pitch      — no memory: anything you're not looking at is fully black
//   remembered — explored cells stay dimly visible (the classic default)
//   realistic  — explored memory DECAYS back to pitch black over decaySeconds
//
// RENDERING: the fog is painted into a tiny offscreen canvas at ONE PIXEL PER
// CELL and drawn as a single sprite stretched over the grid. The GPU's bilinear
// sampling interpolates between cells, so the darkness falls off in smooth
// gradients instead of visible blocks (the old per-cell rects read as a quilt);
// a blur filter on top melts it further into soft shadow. The canvas carries a
// 2-cell dark padding ring so the blur never lightens the map's outer border.
import { BlurFilter, Sprite, Texture } from "pixi.js";
import type { VttScene } from "../../types/scene";
import { cellKey } from "../systems/VisionSystem";
import { fogCellAlpha, DEFAULT_DECAY_SECONDS } from "../systems/fogShade";

const PAD = 2; // cells of solid fog around the grid
const FOG_R = 3, FOG_G = 6, FOG_B = 16; // 0x030610

export class FogLayer {
  readonly view = new Sprite(Texture.EMPTY);
  private blur = new BlurFilter({ strength: 12, quality: 3 });
  private canvas: HTMLCanvasElement | null = null;
  private tex: Texture | null = null;
  private lastVis: Set<string> | null = null;
  private lastRev = -1;
  private lastKey = "";

  constructor() {
    this.view.filters = [this.blur];
  }

  draw(scene: VttScene, visible: Set<string>, playerView = false): void {
    const { fog, grid, layers } = scene.data;
    const on = fog.enabled && layers.fog;
    const mode = fog.mode ?? "remembered";
    const now = Date.now();
    // Skip repainting when nothing changed (same visible set reference, same
    // reveal count). Realistic mode folds a half-second time bucket into the
    // key so the decay fade repaints as time passes (engine ticker re-calls).
    const bucket = mode === "realistic" ? Math.floor(now / 500) : 0;
    const key = `${scene.id}|${on}|${playerView}|${mode}|${bucket}|${grid.size},${grid.cols},${grid.rows}`;
    if (on && key === this.lastKey && visible === this.lastVis && fog.revealed.length === this.lastRev) return;
    this.lastKey = key;
    this.lastVis = visible;
    this.view.visible = on;
    if (!on) {
      this.lastRev = -1;
      return;
    }
    // extra softness for bigger cells (the bilinear stretch already smooths)
    this.blur.strength = Math.max(8, Math.min(22, grid.size * 0.22));

    // remember what's been seen (persisted with the scene)
    const revealed = new Set(fog.revealed);
    let grew = false;
    for (const k of visible) {
      if (!revealed.has(k)) {
        revealed.add(k);
        grew = true;
      }
    }
    if (grew) fog.revealed = [...revealed];
    this.lastRev = fog.revealed.length; // AFTER accumulation, so the skip key matches next frame

    // realistic: currently-visible cells stay fresh in the seen map; everything
    // else ages from its last refresh and fades back toward the dark.
    if (mode === "realistic") {
      const seen = fog.seen ?? (fog.seen = {});
      for (const k of visible) seen[k] = now;
    }

    // ── paint the fog map: one pixel per cell (+ dark padding ring) ─────────
    const w = grid.cols + PAD * 2;
    const h = grid.rows + PAD * 2;
    if (!this.canvas || this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas = document.createElement("canvas");
      this.canvas.width = w;
      this.canvas.height = h;
      this.tex?.destroy(true);
      this.tex = Texture.from(this.canvas);
      this.tex.source.scaleMode = "linear"; // bilinear between cells = smooth falloff
      this.view.texture = this.tex;
    }
    const ctx = this.canvas.getContext("2d")!;
    const img = ctx.createImageData(w, h);
    const px = img.data;
    const decay = fog.decaySeconds ?? DEFAULT_DECAY_SECONDS;
    const unseen = playerView ? 1 : 0.9;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const c = x - PAD;
        const r = y - PAD;
        let alpha: number;
        if (c < 0 || r < 0 || c >= grid.cols || r >= grid.rows) {
          alpha = unseen; // padding ring: solid dark so blur can't lighten the border
        } else {
          const k = cellKey(c, r);
          alpha = fogCellAlpha({
            mode,
            visible: visible.has(k),
            explored: revealed.has(k),
            seenAt: fog.seen?.[k],
            now,
            decaySeconds: decay,
            playerView,
          });
        }
        const i = (y * w + x) * 4;
        px[i] = FOG_R;
        px[i + 1] = FOG_G;
        px[i + 2] = FOG_B;
        px[i + 3] = Math.round(alpha * 255);
      }
    }
    ctx.putImageData(img, 0, 0);
    this.tex!.source.update();

    // stretch the tiny fog map over the grid (padding hangs past the border)
    this.view.position.set(-PAD * grid.size, -PAD * grid.size);
    this.view.width = w * grid.size;
    this.view.height = h * grid.size;
  }
}
