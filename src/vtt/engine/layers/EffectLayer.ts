// AoE / zone effects: translucent shapes (circle, cone, rectangular zone) with a
// pickable centre handle. Ported from the legacy VTT's drawEffects/drawZones.
import { Graphics } from "pixi.js";
import type { VttEffect, VttScene } from "../../types/scene";
import type { VttSelection } from "../PixiVttApp";
import { effectBodyContains } from "../systems/effectGeometry";

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
      } else if (e.kind === "line") {
        // A directed beam from (x,y): length = radius, width = w, along dir.
        const len = (e.data.radius ?? 6) * size;
        const wid = (e.data.w ?? 1) * size;
        const dir = e.data.dir ?? 0;
        const dx = Math.cos(dir), dy = Math.sin(dir);
        const px = -dy * (wid / 2), py = dx * (wid / 2); // perpendicular half-width
        const ex = e.x + dx * len, ey = e.y + dy * len;
        g.poly([e.x + px, e.y + py, ex + px, ey + py, ex - px, ey - py, e.x - px, e.y - py]).fill({ color, alpha: 0.16 });
        g.poly([e.x + px, e.y + py, ex + px, ey + py, ex - px, ey - py, e.x - px, e.y - py]).stroke({ width: 2, color, alpha: 0.6 });
      } else if (e.kind === "ring") {
        // Annulus: a thick stroked circle at the band's mid-radius.
        const outer = (e.data.radius ?? 4) * size;
        const band = Math.max(2, (e.data.w ?? 1) * size);
        const mid = Math.max(band / 2, outer - band / 2);
        g.circle(e.x, e.y, mid).stroke({ width: band, color, alpha: 0.28 });
        g.circle(e.x, e.y, outer).stroke({ width: 2, color, alpha: 0.6 });
      } else if (e.kind === "cross") {
        // A plus centred on (x,y): arm length = radius each way, thickness = w.
        const arm = (e.data.radius ?? 4) * size;
        const t = (e.data.w ?? 1) * size;
        g.rect(e.x - arm, e.y - t / 2, arm * 2, t).fill({ color, alpha: 0.16 });
        g.rect(e.x - t / 2, e.y - arm, t, arm * 2).fill({ color, alpha: 0.16 });
        g.rect(e.x - arm, e.y - t / 2, arm * 2, t).stroke({ width: 2, color, alpha: 0.5 });
        g.rect(e.x - t / 2, e.y - arm, t, arm * 2).stroke({ width: 2, color, alpha: 0.5 });
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

  /** Topmost effect whose centre handle (or body) contains the point. Body hits
   *  cover EVERY shape (circle/cone/line/ring/cross/zone) via effectGeometry. */
  pick(scene: VttScene, wx: number, wy: number, zoom: number): string | null {
    const size = scene.data.grid.size;
    const tol = 12 / Math.max(zoom, 0.001);
    const list = scene.data.effects;
    for (let i = list.length - 1; i >= 0; i--) {
      const e = list[i];
      if ((wx - e.x) ** 2 + (wy - e.y) ** 2 <= tol * tol) return e.id;
      if (effectBodyContains(e, size, wx, wy)) return e.id;
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
