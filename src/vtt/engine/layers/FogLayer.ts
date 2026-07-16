// Fog of war with three darkness levels (scene.data.fog.mode):
//   pitch      — no memory: anything you're not looking at is fully black
//   remembered — explored cells stay dimly visible (the classic default)
//   realistic  — explored memory DECAYS back to pitch black over decaySeconds
// Visible cells come from the VisionSystem; explored cells accumulate on the
// scene; realistic mode refreshes per-cell last-seen timestamps each draw. A
// blur filter melts the hard cell edges into soft shadow falloff.
import { BlurFilter, Graphics } from "pixi.js";
import type { VttScene } from "../../types/scene";
import { cellKey } from "../systems/VisionSystem";
import { fogCellAlpha, DEFAULT_DECAY_SECONDS } from "../systems/fogShade";

export class FogLayer {
  readonly view = new Graphics();
  private blur = new BlurFilter({ strength: 12, quality: 2 });
  private lastVis: Set<string> | null = null;
  private lastRev = -1;
  private lastKey = "";

  constructor() {
    this.view.filters = [this.blur];
  }

  draw(scene: VttScene, visible: Set<string>, playerView = false): void {
    const g = this.view;
    const { fog, grid, layers } = scene.data;
    const on = fog.enabled && layers.fog;
    const mode = fog.mode ?? "remembered";
    const now = Date.now();
    // engine caches the visible set — same reference + same reveal count means
    // nothing changed, so skip repainting a rect per cell on every drag frame.
    // Realistic mode folds a half-second time bucket into the key so the decay
    // fade repaints as time passes (the engine ticker re-calls draw for this).
    const bucket = mode === "realistic" ? Math.floor(now / 500) : 0;
    const key = `${scene.id}|${on}|${playerView}|${mode}|${bucket}|${grid.size},${grid.cols},${grid.rows}`;
    if (on && key === this.lastKey && visible === this.lastVis && fog.revealed.length === this.lastRev) return;
    this.lastKey = key;
    this.lastVis = visible;
    g.clear();
    g.visible = on;
    if (!on) {
      this.lastRev = -1;
      return;
    }
    // soften edges relative to cell size (bigger cells → wider penumbra)
    this.blur.strength = Math.max(6, Math.min(18, grid.size * 0.16));

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

    const decay = fog.decaySeconds ?? DEFAULT_DECAY_SECONDS;
    const s = grid.size;
    for (let c = 0; c < grid.cols; c++) {
      for (let r = 0; r < grid.rows; r++) {
        const k = cellKey(c, r);
        const alpha = fogCellAlpha({
          mode,
          visible: visible.has(k),
          explored: revealed.has(k),
          seenAt: fog.seen?.[k],
          now,
          decaySeconds: decay,
          playerView,
        });
        if (alpha > 0.01) g.rect(c * s, r * s, s, s).fill({ color: 0x030610, alpha });
      }
    }
  }
}
