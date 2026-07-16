import { describe, it, expect } from "vitest";
import { pathBlocked } from "./VisionSystem";
import type { VttWall } from "../../types/scene";

const wall = (x1: number, y1: number, x2: number, y2: number, blocksLight = true): VttWall => ({
  id: "w",
  x1,
  y1,
  x2,
  y2,
  blocksLight,
});

describe("pathBlocked (movement collision)", () => {
  const vertical = [wall(100, 0, 100, 200)];

  it("blocks a path crossing a wall", () => {
    expect(pathBlocked(vertical, 50, 100, 150, 100)).toBe(true);
  });

  it("allows a path that stays on one side", () => {
    expect(pathBlocked(vertical, 50, 100, 90, 100)).toBe(false);
    expect(pathBlocked(vertical, 110, 50, 150, 150)).toBe(false);
  });

  it("allows a path parallel to the wall", () => {
    expect(pathBlocked(vertical, 50, 0, 50, 200)).toBe(false);
  });

  it("allows walking past the wall's END (not an infinite line)", () => {
    expect(pathBlocked(vertical, 50, 250, 150, 250)).toBe(false);
  });

  it("blocks against windows too — blocksLight=false walls are still solid", () => {
    expect(pathBlocked([wall(100, 0, 100, 200, false)], 50, 100, 150, 100)).toBe(true);
  });

  it("checks every wall in the list", () => {
    const maze = [wall(100, 0, 100, 90), wall(100, 110, 100, 200)];
    expect(pathBlocked(maze, 50, 100, 150, 100)).toBe(false); // through the gap
    expect(pathBlocked(maze, 50, 50, 150, 50)).toBe(true); // through the upper wall
  });

  it("no walls, no blocks", () => {
    expect(pathBlocked([], 0, 0, 500, 500)).toBe(false);
  });
});
