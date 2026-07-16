// Multi-map portal geometry — pure and unit-tested. A link occupies a 1-cell
// trigger strip along a map border; a token entering it travels to the linked
// scene, arriving just inside the OPPOSITE edge with its cross-axis position
// preserved proportionally (walk off the east edge at the third row up, arrive
// on the west edge at the third row up — seamless dungeon feel).
import type { VttGrid, VttLinkEdge } from "../types/scene";

export const EDGE_OPPOSITE: Record<VttLinkEdge, VttLinkEdge> = {
  north: "south",
  south: "north",
  east: "west",
  west: "east",
};

/** Is a world point inside the 1-cell trigger strip along this edge? */
export function tokenInEdge(grid: VttGrid, edge: VttLinkEdge, x: number, y: number): boolean {
  const s = grid.size;
  const w = grid.cols * s;
  const h = grid.rows * s;
  if (x < 0 || y < 0 || x > w || y > h) return false;
  switch (edge) {
    case "north":
      return y <= s;
    case "south":
      return y >= h - s;
    case "west":
      return x <= s;
    case "east":
      return x >= w - s;
  }
}

/** Where a traveller lands in the TARGET scene: 1.5 cells inside the opposite
 *  edge, cross-axis position preserved proportionally and snapped to a cell
 *  centre. `inwardIndex` offsets extra party members one cell further in each. */
export function arrivalPos(
  source: VttGrid,
  target: VttGrid,
  edge: VttLinkEdge,
  tokenX: number,
  tokenY: number,
  inwardIndex = 0
): { x: number; y: number } {
  const ts = target.size;
  const clampCell = (v: number, max: number) => Math.max(0, Math.min(max - 1, Math.round(v - 0.5)));
  // proportional cross-axis position (0..1 across the source), mapped to target cells
  const propX = tokenX / (source.cols * source.size);
  const propY = tokenY / (source.rows * source.size);
  const inward = 1 + inwardIndex; // cells inside the arrival edge (1.5-cell centre)
  switch (edge) {
    case "east": {
      // left the source going east → arrive at the target's WEST edge
      const row = clampCell(propY * target.rows, target.rows);
      return { x: (Math.min(inward, target.cols - 1) + 0.5) * ts, y: (row + 0.5) * ts };
    }
    case "west": {
      const row = clampCell(propY * target.rows, target.rows);
      return { x: (Math.max(target.cols - 1 - inward, 0) + 0.5) * ts, y: (row + 0.5) * ts };
    }
    case "south": {
      const col = clampCell(propX * target.cols, target.cols);
      return { x: (col + 0.5) * ts, y: (Math.min(inward, target.rows - 1) + 0.5) * ts };
    }
    case "north": {
      const col = clampCell(propX * target.cols, target.cols);
      return { x: (col + 0.5) * ts, y: (Math.max(target.rows - 1 - inward, 0) + 0.5) * ts };
    }
  }
}
