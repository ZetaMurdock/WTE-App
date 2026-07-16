// Vision: which grid cells are currently visible, given token vision radii and
// light sources, with sight blocked by walls (segment occlusion per cell).
// Sight is DIRECTIONAL when a token has a facing: a forward cone plus a tight
// peripheral ring — dungeons read claustrophobic, not 360. Lights only help a
// player once they have a visual on them (unblocked line of sight), and under
// realistic fog a light contributes only while it's lit (and shrinks as it
// burns down).
import type { VttLight, VttSceneData, VttWall } from "../../types/scene";
import { lightFactor, lightRadiusScale } from "./lightState";

export const cellKey = (c: number, r: number): string => `${c},${r}`;

/** Forward field of view when a token has a facing (degrees, full width). */
export const VISION_CONE_DEG = 140;
/** You can always sense right around yourself (cells) — even behind you. */
export const PERIPHERAL_CELLS = 1.5;

/** Is the offset (dx,dy) inside the token's field of view? No facing = 360. */
export function inVisionCone(facing: number | undefined, dx: number, dy: number, distPx: number, peripheralPx: number): boolean {
  if (facing == null) return true;
  if (distPx <= peripheralPx) return true;
  let da = Math.atan2(dy, dx) - facing;
  while (da > Math.PI) da -= 2 * Math.PI;
  while (da < -Math.PI) da += 2 * Math.PI;
  return Math.abs(da) <= ((VISION_CONE_DEG * Math.PI) / 180) / 2;
}

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

/** MOVEMENT collision: does the straight path from (sx,sy) to (tx,ty) cross any
 *  wall? Every wall is solid to movement (blocksLight only shapes vision). */
export function pathBlocked(walls: VttWall[], sx: number, sy: number, tx: number, ty: number): boolean {
  for (const w of walls) {
    if (segsIntersect(sx, sy, tx, ty, w.x1, w.y1, w.x2, w.y2)) return true;
  }
  return false;
}

/** Can this viewer SEE the light itself? A light only helps (or glows for) a
 *  player once some vision token of theirs has an unblocked, in-cone line of
 *  sight to it. The GM (ownerId undefined) always sees every light. */
export function lightVisibleTo(data: VttSceneData, light: Pick<VttLight, "x" | "y">, ownerId?: string): boolean {
  if (!ownerId) return true;
  const size = data.grid.size;
  const walls = data.walls.filter((w) => w.blocksLight);
  const peripheral = PERIPHERAL_CELLS * size;
  for (const t of data.tokens) {
    if (t.owner !== ownerId || t.visible === false) continue;
    const dx = light.x - t.x;
    const dy = light.y - t.y;
    if (!inVisionCone(t.facing, dx, dy, Math.hypot(dx, dy), peripheral)) continue;
    if (!blocked(t.x, t.y, light.x, light.y, walls)) return true;
  }
  return false;
}

/** Currently-visible cell keys. Empty set when fog is disabled (fog layer hides itself).
 *  `ownerId` (player perspective): vision comes only from tokens that player owns,
 *  plus lights the player can actually SEE — so an enemy token no longer reveals
 *  its own cell and an unseen torch reveals nothing. Undefined (GM / omniscient)
 *  uses every token and light. `now` drives realistic-fog light burn-down. */
export function computeVisibleCells(data: VttSceneData, ownerId?: string, now = Date.now()): Set<string> {
  const vis = new Set<string>();
  if (!data.fog.enabled) return vis;
  const size = data.grid.size;
  const walls = data.walls.filter((w) => w.blocksLight);
  const realistic = data.fog.mode === "realistic";
  const peripheral = PERIPHERAL_CELLS * size;
  const visionTokens = ownerId ? data.tokens.filter((t) => t.owner === ownerId) : data.tokens;

  interface Source {
    x: number;
    y: number;
    r: number;
    facing?: number;
  }
  const sources: Source[] = visionTokens
    .filter((t) => t.visible !== false)
    .map((t) => ({ x: t.x, y: t.y, r: (t.vision ?? 5) * size, facing: t.facing }));
  for (const l of data.lights) {
    const f = lightFactor(l, realistic, now);
    if (f <= 0) continue; // unlit / burned-out lanterns reveal nothing
    if (!lightVisibleTo(data, l, ownerId)) continue; // no visual on it yet
    sources.push({ x: l.x, y: l.y, r: l.radius * size * lightRadiusScale(f) });
  }

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
        const dx = cx - s.x;
        const dy = cy - s.y;
        if (dx * dx + dy * dy > s.r * s.r) continue;
        if (!inVisionCone(s.facing, dx, dy, Math.sqrt(dx * dx + dy * dy), peripheral)) continue;
        if (!blocked(s.x, s.y, cx, cy, walls)) vis.add(key);
      }
    }
  }
  return vis;
}
