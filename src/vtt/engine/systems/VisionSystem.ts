// Vision: which grid cells are currently visible, given token vision radii and
// light sources, with sight blocked by walls (segment occlusion per cell).
import type { VttSceneData, VttWall } from "../../types/scene";

export const cellKey = (c: number, r: number): string => `${c},${r}`;

function segsIntersect(ax: number, ay: number, bx: number, by: number, cx: number, cy: number, dx: number, dy: number): boolean {
  const d1 = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  const d2 = (bx - ax) * (dy - ay) - (by - ay) * (dx - ax);
  const d3 = (dx - cx) * (ay - cy) - (dy - cy) * (ax - cx);
  const d4 = (dx - cx) * (by - cy) - (dy - cy) * (bx - cx);
  return d1 * d2 < 0 && d3 * d4 < 0;
}

function blocked(sx: number, sy: number, tx: number, ty: number, walls: VttWall[]): boolean {
  for (const w of walls) {
    if (segsIntersect(sx, sy, tx, ty, w.x1, w.y1, w.x2, w.y2)) return true;
  }
  return false;
}

/** Currently-visible cell keys. Empty set when fog is disabled (fog layer hides itself). */
export function computeVisibleCells(data: VttSceneData): Set<string> {
  const vis = new Set<string>();
  if (!data.fog.enabled) return vis;
  const size = data.grid.size;
  const walls = data.walls.filter((w) => w.blocksLight);
  const sources = [
    ...data.tokens.filter((t) => t.visible !== false).map((t) => ({ x: t.x, y: t.y, r: (t.vision ?? 5) * size })),
    ...data.lights.map((l) => ({ x: l.x, y: l.y, r: l.radius * size })),
  ];
  for (const s of sources) {
    const c0 = Math.max(0, Math.floor((s.x - s.r) / size));
    const c1 = Math.min(data.grid.cols - 1, Math.floor((s.x + s.r) / size));
    const r0 = Math.max(0, Math.floor((s.y - s.r) / size));
    const r1 = Math.min(data.grid.rows - 1, Math.floor((s.y + s.r) / size));
    for (let c = c0; c <= c1; c++) {
      for (let r = r0; r <= r1; r++) {
        const key = cellKey(c, r);
        if (vis.has(key)) continue;
        const cx = (c + 0.5) * size;
        const cy = (r + 0.5) * size;
        if ((cx - s.x) ** 2 + (cy - s.y) ** 2 > s.r * s.r) continue;
        if (!blocked(s.x, s.y, cx, cy, walls)) vis.add(key);
      }
    }
  }
  return vis;
}
