import { describe, expect, it } from "vitest";
import type { VttGrid, VttToken } from "../types/scene";
import { canOccupy, nearestFreeCell, tokenBlocksMovement, tokenFootprint } from "./occupancy";

const grid: VttGrid = { type: "square", size: 10, cols: 5, rows: 5, color: "#000", visible: true };
const token = (id: string, col: number, row: number, over: Partial<VttToken> = {}): VttToken => ({
  id,
  name: id,
  x: (col + 0.5) * grid.size,
  y: (row + 0.5) * grid.size,
  size: 1,
  color: "#fff",
  visible: true,
  ...over,
});

describe("token footprint occupancy", () => {
  it("maps one-cell and large tokens to deterministic grid footprints", () => {
    expect(tokenFootprint(grid, token("small", 2, 1))).toEqual([{ col: 2, row: 1 }]);
    expect(tokenFootprint(grid, token("large", 2, 2, { size: 2 }))).toEqual([
      { col: 2, row: 2 },
      { col: 3, row: 2 },
      { col: 2, row: 3 },
      { col: 3, row: 3 },
    ]);
  });

  it("rejects overlap, bad coordinates, and footprints outside the map", () => {
    const occupied = [token("guard", 2, 2)];
    expect(canOccupy(grid, occupied, token("mover", 2, 2), { ignoreTokenId: "mover" })).toMatchObject({
      ok: false,
      reason: "occupied",
      blockingTokenId: "guard",
    });
    expect(canOccupy(grid, occupied, { x: Number.NaN, y: 5, size: 1 })).toMatchObject({ ok: false, reason: "invalid-position" });
    expect(canOccupy(grid, occupied, token("large", 4, 4, { size: 2 }))).toMatchObject({ ok: false, reason: "out-of-bounds" });
  });

  it("ignores the moving token's old cells", () => {
    const mover = token("mover", 1, 1);
    expect(canOccupy(grid, [mover], { ...mover, x: 25, y: 15 }, { ignoreTokenId: "mover" }).ok).toBe(true);
  });

  it("blocks actors by default and lets props opt into collision", () => {
    expect(tokenBlocksMovement(token("actor", 0, 0))).toBe(true);
    expect(tokenBlocksMovement(token("hidden", 0, 0, { visible: false }))).toBe(true);
    expect(tokenBlocksMovement(token("ghost", 0, 0, { blocksMovement: false }))).toBe(false);
    expect(tokenBlocksMovement(token("rug", 0, 0, { prop: true }))).toBe(false);
    expect(tokenBlocksMovement(token("crate", 0, 0, { prop: true, blocksMovement: true }))).toBe(true);
  });
});

describe("nearestFreeCell", () => {
  it("keeps a legal target and fans out deterministically around an occupied one", () => {
    expect(nearestFreeCell(grid, [], token("spawn", 2, 2))).toMatchObject({ x: 25, y: 25 });
    expect(nearestFreeCell(grid, [token("block", 2, 2)], token("spawn", 2, 2))).toMatchObject({ x: 25, y: 15 });
  });

  it("clamps an off-map request before searching and returns null for a full map", () => {
    expect(nearestFreeCell(grid, [], { x: -100, y: 999, size: 1 })).toMatchObject({ x: 5, y: 45 });
    const full: VttToken[] = [];
    for (let row = 0; row < grid.rows; row++) for (let col = 0; col < grid.cols; col++) full.push(token(`${col},${row}`, col, row));
    expect(nearestFreeCell(grid, full, token("spawn", 2, 2))).toBeNull();
  });

  it("finds a placement whose entire large footprint is free", () => {
    const blockers = [token("a", 2, 2), token("b", 2, 1), token("c", 1, 2)];
    const found = nearestFreeCell(grid, blockers, token("large", 2, 2, { size: 2 }));
    expect(found).not.toBeNull();
    expect(canOccupy(grid, blockers, { ...token("large", 0, 0), ...found!, size: 2 }).ok).toBe(true);
  });
});
