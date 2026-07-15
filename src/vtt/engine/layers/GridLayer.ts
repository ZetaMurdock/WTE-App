// The battle grid, drawn once per scene change.
import { Graphics } from "pixi.js";
import type { VttScene } from "../../types/scene";

export class GridLayer {
  readonly view = new Graphics();
  private key = "";

  draw(scene: VttScene): void {
    const { grid, layers } = scene.data;
    const g = this.view;
    // rebuilding thousands of line segments every redraw is wasted work — skip
    // unless the grid itself changed (redraw fires on every drag frame)
    const key = `${scene.id}|${grid.size}|${grid.cols}|${grid.rows}|${grid.visible && layers.grid}|${grid.color || ""}`;
    if (key === this.key) return;
    this.key = key;
    g.clear();
    g.visible = grid.visible && layers.grid;
    if (!g.visible) return;
    const w = grid.cols * grid.size;
    const h = grid.rows * grid.size;
    for (let c = 0; c <= grid.cols; c++) {
      g.moveTo(c * grid.size, 0).lineTo(c * grid.size, h);
    }
    for (let r = 0; r <= grid.rows; r++) {
      g.moveTo(0, r * grid.size).lineTo(w, r * grid.size);
    }
    g.stroke({ width: 1, color: grid.color || "#1a2233", alpha: 0.8 });
  }
}
