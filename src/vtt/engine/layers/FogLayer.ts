// Fog of war: unseen cells are near-black; explored-but-not-visible cells are dim.
// Visible cells come from the VisionSystem; explored cells accumulate on the scene.
// A blur filter melts the hard cell edges into soft shadow falloff.
import { BlurFilter, Graphics } from "pixi.js";
import type { VttScene } from "../../types/scene";
import { cellKey } from "../systems/VisionSystem";

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
    // engine caches the visible set — same reference + same reveal count means
    // nothing changed, so skip repainting a rect per cell on every drag frame
    const key = `${scene.id}|${on}|${playerView}|${grid.size},${grid.cols},${grid.rows}`;
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

    // Players can't see through unseen fog at all; GMs keep it semi-transparent.
    const unseenA = playerView ? 1 : 0.9;
    const exploredA = playerView ? 0.72 : 0.55;
    const s = grid.size;
    for (let c = 0; c < grid.cols; c++) {
      for (let r = 0; r < grid.rows; r++) {
        const k = cellKey(c, r);
        if (visible.has(k)) continue;
        g.rect(c * s, r * s, s, s).fill({ color: 0x030610, alpha: revealed.has(k) ? exploredA : unseenA });
      }
    }
  }
}
