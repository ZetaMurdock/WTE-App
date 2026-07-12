// Walls: sight-blocking segments with a draw preview and pick support.
import { Graphics } from "pixi.js";
import type { VttScene } from "../../types/scene";
import type { VttSelection } from "../PixiVttApp";

export class WallLayer {
  readonly view = new Graphics();
  readonly previewG = new Graphics();

  draw(scene: VttScene, selection: VttSelection): void {
    const g = this.view;
    g.clear();
    g.visible = scene.data.layers.walls;
    if (!g.visible) return;
    for (const w of scene.data.walls) {
      const sel = selection?.kind === "wall" && selection.id === w.id;
      g.moveTo(w.x1, w.y1).lineTo(w.x2, w.y2).stroke({ width: sel ? 5 : 3, color: sel ? 0x7ecfca : w.blocksLight ? 0xa7aebd : 0x646c7e, alpha: 0.9 });
      g.circle(w.x1, w.y1, 4).fill(0x646c7e);
      g.circle(w.x2, w.y2, 4).fill(0x646c7e);
    }
  }
  preview(x1: number, y1: number, x2: number, y2: number): void {
    this.previewG.clear();
    this.previewG.moveTo(x1, y1).lineTo(x2, y2).stroke({ width: 3, color: 0x7ecfca, alpha: 0.6 });
  }
  clearPreview(): void {
    this.previewG.clear();
  }
  /** Nearest wall within tolerance of the world point (screen-scaled). */
  pick(scene: VttScene, wx: number, wy: number, zoom: number): string | null {
    const tol = 12 / Math.max(zoom, 0.001);
    let best: string | null = null;
    let bestD = tol;
    for (const w of scene.data.walls) {
      const d = distToSeg(wx, wy, w.x1, w.y1, w.x2, w.y2);
      if (d < bestD) {
        bestD = d;
        best = w.id;
      }
    }
    return best;
  }
}

function distToSeg(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / len2)) : 0;
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}
