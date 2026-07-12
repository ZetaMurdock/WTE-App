// Light sources: soft radial glow + a pickable handle.
import { Graphics } from "pixi.js";
import type { VttScene } from "../../types/scene";
import type { VttSelection } from "../PixiVttApp";

export class LightingLayer {
  readonly view = new Graphics();

  draw(scene: VttScene, selection: VttSelection): void {
    const g = this.view;
    g.clear();
    g.visible = scene.data.layers.lights;
    if (!g.visible) return;
    const size = scene.data.grid.size;
    for (const l of scene.data.lights) {
      const r = l.radius * size;
      const a = 0.1 * (l.intensity ?? 0.5) * 2;
      g.circle(l.x, l.y, r).fill({ color: l.color || "#a08a4f", alpha: a });
      g.circle(l.x, l.y, r * 0.55).fill({ color: l.color || "#a08a4f", alpha: a });
      const sel = selection?.kind === "light" && selection.id === l.id;
      g.circle(l.x, l.y, 7).fill({ color: l.color || "#a08a4f", alpha: 0.9 });
      g.circle(l.x, l.y, sel ? 12 : 9).stroke({ width: sel ? 2.5 : 1.5, color: sel ? 0x7ecfca : 0x04070d });
    }
  }
  pick(scene: VttScene, wx: number, wy: number, zoom: number): string | null {
    const tol = 12 / Math.max(zoom, 0.001);
    for (let i = scene.data.lights.length - 1; i >= 0; i--) {
      const l = scene.data.lights[i];
      if ((wx - l.x) ** 2 + (wy - l.y) ** 2 <= tol * tol) return l.id;
    }
    return null;
  }
}
