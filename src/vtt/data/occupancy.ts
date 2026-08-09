import type { VttGrid, VttToken } from "../types/scene";

export interface GridCell {
  col: number;
  row: number;
}

export type TokenPlacement = Pick<VttToken, "x" | "y" | "size"> & Partial<Pick<VttToken, "id">>;

export type OccupancyFailure = "invalid-position" | "out-of-bounds" | "occupied";

export type OccupancyResult =
  | { ok: true; cells: GridCell[] }
  | { ok: false; reason: OccupancyFailure; cells: GridCell[]; blockingTokenId?: string };

export interface OccupancyOptions {
  /** Ignore the moving token's current presence. */
  ignoreTokenId?: string | null;
  /** Override which scene tokens reserve cells. */
  blocks?: (token: VttToken) => boolean;
}

const key = ({ col, row }: GridCell): string => `${col},${row}`;

/** Actors reserve cells by default. Props reserve them only when explicitly marked. */
export function tokenBlocksMovement(token: VttToken): boolean {
  return token.blocksMovement ?? token.prop !== true;
}

/**
 * Return the square grid footprint occupied by a placement. `size` is its cell
 * diameter; fractional/corrupt values are normalized to one or more cells.
 */
export function tokenFootprint(grid: VttGrid, placement: TokenPlacement): GridCell[] {
  if (!Number.isFinite(placement.x) || !Number.isFinite(placement.y) || !Number.isFinite(placement.size) || grid.size <= 0) return [];
  const span = Math.max(1, Math.ceil(placement.size));
  const anchorCol = Math.floor(placement.x / grid.size);
  const anchorRow = Math.floor(placement.y / grid.size);
  // Even-size tokens use the selected cell as their top-left-of-centre anchor;
  // this keeps a stable N x N footprint with the app's cell-centre snapping.
  const firstCol = anchorCol - Math.floor((span - 1) / 2);
  const firstRow = anchorRow - Math.floor((span - 1) / 2);
  const cells: GridCell[] = [];
  for (let row = firstRow; row < firstRow + span; row++) {
    for (let col = firstCol; col < firstCol + span; col++) cells.push({ col, row });
  }
  return cells;
}

export function canOccupy(
  grid: VttGrid,
  tokens: readonly VttToken[],
  placement: TokenPlacement,
  options: OccupancyOptions = {}
): OccupancyResult {
  const cells = tokenFootprint(grid, placement);
  if (cells.length === 0) return { ok: false, reason: "invalid-position", cells };
  if (cells.some((cell) => cell.col < 0 || cell.row < 0 || cell.col >= grid.cols || cell.row >= grid.rows)) {
    return { ok: false, reason: "out-of-bounds", cells };
  }

  const candidate = new Set(cells.map(key));
  const blocks = options.blocks ?? tokenBlocksMovement;
  for (const token of tokens) {
    if (token.id === options.ignoreTokenId || !blocks(token)) continue;
    const overlap = tokenFootprint(grid, token).some((cell) => candidate.has(key(cell)));
    if (overlap) return { ok: false, reason: "occupied", cells, blockingTokenId: token.id };
  }
  return { ok: true, cells };
}

/**
 * Find the nearest legal snapped placement using deterministic expanding rings.
 * Useful for spawns, portals, and migration repair; null means the map is full.
 */
export function nearestFreeCell(
  grid: VttGrid,
  tokens: readonly VttToken[],
  desired: TokenPlacement,
  options: OccupancyOptions = {}
): { x: number; y: number; cells: GridCell[] } | null {
  if (!Number.isFinite(desired.x) || !Number.isFinite(desired.y) || grid.size <= 0 || grid.cols <= 0 || grid.rows <= 0) return null;
  const startCol = Math.max(0, Math.min(grid.cols - 1, Math.floor(desired.x / grid.size)));
  const startRow = Math.max(0, Math.min(grid.rows - 1, Math.floor(desired.y / grid.size)));
  const maxRing = Math.max(grid.cols, grid.rows);

  for (let ring = 0; ring <= maxRing; ring++) {
    const candidates: GridCell[] = [];
    for (let row = startRow - ring; row <= startRow + ring; row++) {
      for (let col = startCol - ring; col <= startCol + ring; col++) {
        if (Math.max(Math.abs(col - startCol), Math.abs(row - startRow)) !== ring) continue;
        if (col < 0 || row < 0 || col >= grid.cols || row >= grid.rows) continue;
        candidates.push({ col, row });
      }
    }
    candidates.sort((a, b) => {
      const ad = (a.col - startCol) ** 2 + (a.row - startRow) ** 2;
      const bd = (b.col - startCol) ** 2 + (b.row - startRow) ** 2;
      return ad - bd || a.row - b.row || a.col - b.col;
    });
    for (const cell of candidates) {
      const placement = { x: (cell.col + 0.5) * grid.size, y: (cell.row + 0.5) * grid.size, size: desired.size };
      const result = canOccupy(grid, tokens, placement, options);
      if (result.ok) return { x: placement.x, y: placement.y, cells: result.cells };
    }
  }
  return null;
}
