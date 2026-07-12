// Fog of war: unseen cells are near-black; explored-but-not-visible cells are dim.
// Visible cells come from the VisionSystem; explored cells accumulate on the scene.
import { Graphics } from "pixi.js";
import type { VttScene } from "../../types/scene";
import { cellKey } from "../systems/VisionSystem";

export class FogLayer {
  readonly view = new Graphics();

  draw(scene: VttScene, visible: Set<string>): void {
    const g = this.view;
    g.clear();
    const { fog, grid, layers } = scene.data;
    g.visible = fog.enabled && layers.fog;
    if (!g.visible) return;

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

    const s = grid.size;
    for (let c = 0; c < grid.cols; c++) {
      for (let r = 0; r < grid.rows; r++) {
        const k = cellKey(c, r);
        if (visible.has(k)) continue;
        g.rect(c * s, r * s, s, s).fill({ color: 0x04070d, alpha: revealed.has(k) ? 0.55 : 0.85 });
      }
    }
  }
}
