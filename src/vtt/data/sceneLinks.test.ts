import { describe, it, expect } from "vitest";
import { tokenInEdge, arrivalPos, EDGE_OPPOSITE } from "./sceneLinks";
import type { VttGrid } from "../types/scene";

const grid = (cols: number, rows: number, size = 70): VttGrid => ({ type: "square", size, cols, rows, color: "#333", visible: true });

describe("tokenInEdge", () => {
  const g = grid(30, 20); // 2100 x 1400 world
  it("detects each 1-cell border strip", () => {
    expect(tokenInEdge(g, "north", 1000, 35)).toBe(true);
    expect(tokenInEdge(g, "south", 1000, 1400 - 35)).toBe(true);
    expect(tokenInEdge(g, "west", 35, 700)).toBe(true);
    expect(tokenInEdge(g, "east", 2100 - 35, 700)).toBe(true);
  });
  it("the map interior triggers nothing", () => {
    for (const e of ["north", "south", "east", "west"] as const) {
      expect(tokenInEdge(g, e, 1050, 700)).toBe(false);
    }
  });
  it("points outside the map trigger nothing", () => {
    expect(tokenInEdge(g, "north", 1000, -10)).toBe(false);
    expect(tokenInEdge(g, "east", 2200, 700)).toBe(false);
  });
});

describe("arrivalPos", () => {
  const src = grid(30, 20);
  it("east exit arrives just inside the target's west edge, same relative row", () => {
    const tgt = grid(30, 20);
    // leaving at row 5 of 20 (y = 5.5 cells)
    const p = arrivalPos(src, tgt, "east", 2065, 5.5 * 70);
    expect(p.x).toBe(1.5 * 70); // 1.5 cells inside the west edge
    expect(p.y).toBe(5.5 * 70); // same row
  });
  it("scales the cross-axis proportionally when grids differ", () => {
    const tgt = grid(30, 40); // twice the rows
    const p = arrivalPos(src, tgt, "east", 2065, 10.5 * 70); // middle-ish row 10/20
    expect(p.y).toBe(21.5 * 70); // ~middle of 40 rows, cell-centre snapped
  });
  it("handles all four edges (arrive opposite)", () => {
    const tgt = grid(30, 20);
    expect(arrivalPos(src, tgt, "west", 35, 700).x).toBe((30 - 2 + 0.5) * 70); // inside the EAST edge
    expect(arrivalPos(src, tgt, "south", 1050, 1365).y).toBe(1.5 * 70); // inside the NORTH edge
    expect(arrivalPos(src, tgt, "north", 1050, 35).y).toBe((20 - 2 + 0.5) * 70); // inside the SOUTH edge
  });
  it("offsets extra party members one cell further inward", () => {
    const tgt = grid(30, 20);
    const a = arrivalPos(src, tgt, "east", 2065, 700, 0);
    const b = arrivalPos(src, tgt, "east", 2065, 700, 1);
    expect(b.x - a.x).toBe(70);
    expect(b.y).toBe(a.y);
  });
  it("arrival never lands back inside the target's own trigger strip", () => {
    const tgt = grid(30, 20);
    for (const e of ["north", "south", "east", "west"] as const) {
      const p = arrivalPos(src, tgt, e, 1050, 700, 0);
      expect(tokenInEdge(tgt, EDGE_OPPOSITE[e], p.x, p.y)).toBe(false); // no instant bounce-back
    }
  });
});
