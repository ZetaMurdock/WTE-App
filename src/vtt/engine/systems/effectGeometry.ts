// Pure hit-testing for AoE effect bodies — every VttEffectKind, matching how
// EffectLayer draws them. Pixi-free so it's unit-testable and reusable (pick,
// future token-in-area queries).
import type { VttEffect } from "../../types/scene";

/** Is the world point inside the effect's BODY (not just its centre handle)? */
export function effectBodyContains(e: VttEffect, size: number, wx: number, wy: number): boolean {
  const dx = wx - e.x;
  const dy = wy - e.y;
  switch (e.kind) {
    case "circle": {
      const r = (e.data.radius ?? 3) * size;
      return dx * dx + dy * dy <= r * r;
    }
    case "cone": {
      const r = (e.data.radius ?? 4) * size;
      if (dx * dx + dy * dy > r * r) return false;
      const dir = e.data.dir ?? 0;
      const half = (((e.data.angle ?? 60) * Math.PI) / 180) / 2;
      // Signed angular distance from the cone's facing, normalized to [-PI, PI].
      let da = Math.atan2(dy, dx) - dir;
      while (da > Math.PI) da -= 2 * Math.PI;
      while (da < -Math.PI) da += 2 * Math.PI;
      return Math.abs(da) <= half;
    }
    case "line": {
      const len = (e.data.radius ?? 6) * size;
      const halfW = ((e.data.w ?? 1) * size) / 2;
      const dir = e.data.dir ?? 0;
      const ux = Math.cos(dir);
      const uy = Math.sin(dir);
      const along = dx * ux + dy * uy; // projection down the beam
      const across = Math.abs(-uy * dx + ux * dy); // distance from its axis
      return along >= 0 && along <= len && across <= halfW;
    }
    case "ring": {
      const outer = (e.data.radius ?? 4) * size;
      const band = Math.max(2, (e.data.w ?? 1) * size);
      const dist = Math.sqrt(dx * dx + dy * dy);
      return dist <= outer && dist >= outer - band;
    }
    case "cross": {
      const arm = (e.data.radius ?? 4) * size;
      const halfT = ((e.data.w ?? 1) * size) / 2;
      const ax = Math.abs(dx);
      const ay = Math.abs(dy);
      return (ax <= arm && ay <= halfT) || (ay <= arm && ax <= halfT);
    }
    case "zone": {
      const w = (e.data.w ?? 4) * size;
      const h = (e.data.h ?? 4) * size;
      return wx >= e.x && wx <= e.x + w && wy >= e.y && wy <= e.y + h;
    }
  }
}
