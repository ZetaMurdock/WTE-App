// Spatial-sound emitter handles: a speaker glyph per emitter, plus the audible
// radius ring when selected. Curator-only — players HEAR emitters (SpatialAudio-
// Engine) but never see where the sound comes from.
import { Container, Graphics } from "pixi.js";
import type { VttScene } from "../../types/scene";
import type { VttSelection } from "../PixiVttApp";

const TEAL = 0x7ecfca;

export class EmitterLayer {
  readonly view = new Container();
  private g = new Graphics();

  constructor() {
    this.view.addChild(this.g);
  }

  draw(scene: VttScene, selection: VttSelection, playerView: boolean): void {
    this.g.clear();
    if (playerView) return;
    const s = scene.data.grid.size;
    for (const e of scene.data.emitters ?? []) {
      const on = selection?.kind === "emitter" && selection.id === e.id;
      if (on) this.g.circle(e.x, e.y, e.radius * s).stroke({ width: 1.5, color: TEAL, alpha: 0.3 });
      // speaker: dot + two sound arcs opening to the right
      this.g.circle(e.x, e.y, s * 0.1).fill({ color: TEAL, alpha: on ? 1 : 0.75 });
      this.g.arc(e.x, e.y, s * 0.22, -0.9, 0.9).stroke({ width: 2.5, color: TEAL, alpha: on ? 0.9 : 0.6 });
      this.g.arc(e.x, e.y, s * 0.36, -0.7, 0.7).stroke({ width: 2, color: TEAL, alpha: on ? 0.7 : 0.4 });
      if (on) this.g.circle(e.x, e.y, s * 0.5).stroke({ width: 2, color: TEAL, alpha: 0.8 });
    }
  }

  pick(scene: VttScene, wx: number, wy: number, zoom: number): string | null {
    const tol = Math.max(14 / Math.max(zoom, 0.001), scene.data.grid.size * 0.4);
    const list = scene.data.emitters ?? [];
    for (let i = list.length - 1; i >= 0; i--) {
      const e = list[i];
      if ((wx - e.x) ** 2 + (wy - e.y) ** 2 <= tol * tol) return e.id;
    }
    return null;
  }
}
