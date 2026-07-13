// AoE / zone effects: translucent shapes (circle, cone, rectangular zone) with a
// pickable centre handle. Ported from the legacy VTT's drawEffects/drawZones.
import { Graphics } from "pixi.js";
import type { VttEffect, VttScene } from "../../types/scene";
import type { VttSelection } from "../PixiVttApp";

export class EffectLayer {
  readonly view = new Graphics();

  draw(scene: VttScene, selection: VttSelection): void {
    const g = this.view;
    g.clear();
    g.visible = scene.data.layers.effects;
    if (!g.visible) return;
    const size = scene.data.grid.size;
    for (const e of scene.data.effects) {
      const color = e.data.color || "#837aae";
      const sel = selection?.kind === "effect" && selection.id === e.id;
      if (e.kind === "circle") {
        const r = (e.data.radius ?? 3) * size;
        g.circle(e.x, e.y, r).fill({ color, alpha: 0.16 });
        g.circle(e.x, e.y, r).stroke({ width: 2, color, alpha: 0.6 });
      } else if (e.kind === "cone") {
        const r = (e.data.radius ?? 4) * size;
        const dir = e.data.dir ?? 0;
        const half = (((e.data.angle ?? 60) * Math.PI) / 180) / 2;
        g.moveTo(e.x, e.y);
        g.arc(e.x, e.y, r, dir - half, dir + half);
        g.lineTo(e.x, e.y);
        g.fill({ color, alpha: 0.16 });
        g.stroke({ width: 2, color, alpha: 0.6 });
      } else {
        // zone rectangle, anchored top-left at (x,y)
        const w = (e.data.w ?? 4) * size;
        const h = (e.data.h ?? 4) * size;
        g.rect(e.x, e.y, w, h).fill({ color, alpha: 0.12 });
        g.rect(e.x, e.y, w, h).stroke({ width: 2, color, alpha: 0.6 });
      }
      // centre handle
      g.circle(e.x, e.y, sel ? 8 : 5).fill({ color, alpha: 0.95 });
      g.circle(e.x, e.y, sel ? 11 : 7).stroke({ width: sel ? 2.5 : 1.5, color: sel ? 0x7ecfca : 0x04070d });
    }
  }

  /** Topmost effect whose centre handle (or body) contains the point. */
  pick(scene: VttScene, wx: number, wy: number, zoom: number): string | null {
    const size = scene.data.grid.size;
    const tol = 12 / Math.max(zoom, 0.001);
    const list = scene.data.effects;
    for (let i = list.length - 1; i >= 0; i--) {
      const e = list[i];
      if ((wx - e.x) ** 2 + (wy - e.y) ** 2 <= tol * tol) return e.id;
      // body hit for zones (easy to grab)
      if (e.kind === "zone") {
        const w = (e.data.w ?? 4) * size;
        const h = (e.data.h ?? 4) * size;
        if (wx >= e.x && wx <= e.x + w && wy >= e.y && wy <= e.y + h) return e.id;
      } else if (e.kind === "circle") {
        const r = (e.data.radius ?? 3) * size;
        if ((wx - e.x) ** 2 + (wy - e.y) ** 2 <= r * r) return e.id;
      }
    }
    return null;
  }

  /** Is a world point inside a zone effect? (SimulationSystem membership.) */
  static zoneContains(e: VttEffect, size: number, wx: number, wy: number): boolean {
    if (e.kind !== "zone") return false;
    const w = (e.data.w ?? 4) * size;
    const h = (e.data.h ?? 4) * size;
    return wx >= e.x && wx <= e.x + w && wy >= e.y && wy <= e.y + h;
  }
}
