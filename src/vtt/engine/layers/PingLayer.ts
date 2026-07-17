// "Look here" pings: double-click the map and everyone at the table sees an
// expanding pulse at that spot for a couple of seconds, in the pinger's ink
// color (Curator gold, per-player hues — same palette as the Draw tool).
import { Container, Graphics } from "pixi.js";

const LIFE_MS = 2400;

export class PingLayer {
  readonly view = new Container();
  private g = new Graphics();
  private pings: { x: number; y: number; color: string; t0: number }[] = [];

  constructor() {
    this.view.addChild(this.g);
  }

  get active(): boolean {
    return this.pings.length > 0;
  }

  add(x: number, y: number, color: string): void {
    this.pings.push({ x, y, color, t0: performance.now() });
  }

  tick(now = performance.now()): void {
    if (!this.pings.length) return;
    this.pings = this.pings.filter((p) => now - p.t0 < LIFE_MS);
    this.g.clear();
    for (const p of this.pings) {
      const k = (now - p.t0) / LIFE_MS;
      const fade = 1 - k;
      // a shrinking core with two staggered rings racing outward
      this.g.circle(p.x, p.y, 12 + k * 95).stroke({ width: 1 + 3 * fade, color: p.color, alpha: 0.85 * fade });
      const k2 = Math.max(0, k - 0.3) / 0.7;
      if (k2 > 0) this.g.circle(p.x, p.y, 12 + k2 * 70).stroke({ width: 2, color: p.color, alpha: 0.5 * (1 - k2) });
      this.g.circle(p.x, p.y, 3 + 7 * fade).fill({ color: p.color, alpha: 0.9 * fade });
    }
  }
}
