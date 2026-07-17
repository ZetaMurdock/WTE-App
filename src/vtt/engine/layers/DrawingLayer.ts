// Freehand annotations: world-space polyline strokes everyone at the table
// sees, each in the drawer's own ink color. A live preview renders the stroke
// in progress before it commits + syncs.
import { Graphics } from "pixi.js";
import type { VttScene } from "../../types/scene";

export class DrawingLayer {
  readonly view = new Graphics();
  readonly previewG = new Graphics();

  draw(scene: VttScene): void {
    const g = this.view;
    g.clear();
    for (const d of scene.data.drawings ?? []) {
      if (d.points.length < 4) continue;
      g.moveTo(d.points[0], d.points[1]);
      for (let i = 2; i < d.points.length; i += 2) g.lineTo(d.points[i], d.points[i + 1]);
      g.stroke({ width: d.width || 3, color: d.color || "#7ecfca", alpha: 0.9, cap: "round", join: "round" });
    }
  }

  preview(points: number[], color: string, width: number): void {
    const g = this.previewG;
    g.clear();
    if (points.length < 4) return;
    g.moveTo(points[0], points[1]);
    for (let i = 2; i < points.length; i += 2) g.lineTo(points[i], points[i + 1]);
    g.stroke({ width, color, alpha: 0.7, cap: "round", join: "round" });
  }

  clearPreview(): void {
    this.previewG.clear();
  }
}
