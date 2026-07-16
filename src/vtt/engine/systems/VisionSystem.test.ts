import { describe, it, expect } from "vitest";
import { pathBlocked, inVisionCone, computeVisibleCells, lightVisibleTo, cellKey } from "./VisionSystem";
import { defaultSceneData, type VttToken, type VttWall } from "../../types/scene";

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

describe("inVisionCone (directional sight)", () => {
  it("no facing = full 360", () => {
    expect(inVisionCone(undefined, -100, 0, 100, 50)).toBe(true);
  });
  it("sees ahead, not behind (facing right, 140° cone)", () => {
    expect(inVisionCone(0, 100, 0, 100, 50)).toBe(true); // dead ahead
    expect(inVisionCone(0, 100, 60, Math.hypot(100, 60), 50)).toBe(true); // ~31° off — inside ±70°
    expect(inVisionCone(0, -100, 0, 100, 50)).toBe(false); // directly behind
    expect(inVisionCone(0, 0, 100, 100, 50)).toBe(false); // hard 90° — outside the cone
  });
  it("peripheral ring: you always sense right around you, even behind", () => {
    expect(inVisionCone(0, -40, 0, 40, 50)).toBe(true);
  });
  it("handles facings across the ±PI wrap", () => {
    expect(inVisionCone(Math.PI, -100, 0, 100, 50)).toBe(true); // facing left, target left
    expect(inVisionCone(Math.PI, 100, 0, 100, 50)).toBe(false);
  });
});

const tok = (id: string, x: number, y: number, extra: Partial<VttToken> = {}): VttToken => ({
  id, name: id, x, y, size: 1, color: "#fff", hp: 1, visible: true, ...extra,
});

describe("computeVisibleCells — direction, light gating, burn", () => {
  function scene() {
    const d = defaultSceneData();
    d.fog.enabled = true;
    return d;
  }
  const S = 70; // default grid size assumed; read from data below

  it("a facing token sees ahead but not far behind", () => {
    const d = scene();
    const s = d.grid.size;
    d.tokens.push(tok("t", 10.5 * s, 10.5 * s, { facing: 0, vision: 5, owner: "p1" }));
    const vis = computeVisibleCells(d, "p1");
    expect(vis.has(cellKey(13, 10))).toBe(true); // ahead (right)
    expect(vis.has(cellKey(7, 10))).toBe(false); // 3 cells behind — outside peripheral
    expect(vis.has(cellKey(9, 10))).toBe(true); // 1 cell behind — peripheral ring
    expect(S).toBeGreaterThan(0);
  });

  it("players don't get vision from a light they have no line of sight to", () => {
    const d = scene();
    const s = d.grid.size;
    d.tokens.push(tok("t", 2.5 * s, 2.5 * s, { owner: "p1", vision: 2 }));
    // light far away, behind a wall that cuts LOS from the token
    d.lights.push({ id: "L", x: 12.5 * s, y: 2.5 * s, radius: 3, color: "#fff", intensity: 0.5 });
    d.walls.push({ id: "w", x1: 8 * s, y1: 0, x2: 8 * s, y2: 30 * s, blocksLight: true });
    const gated = computeVisibleCells(d, "p1");
    expect(gated.has(cellKey(12, 2))).toBe(false); // light's area hidden — no visual on it
    expect(lightVisibleTo(d, d.lights[0], "p1")).toBe(false);
    // GM still sees the light's area
    const gm = computeVisibleCells(d);
    expect(gm.has(cellKey(12, 2))).toBe(true);
    // remove the wall → the player has a visual → the lit area appears
    d.walls.length = 0;
    expect(lightVisibleTo(d, d.lights[0], "p1")).toBe(true);
    expect(computeVisibleCells(d, "p1").has(cellKey(12, 2))).toBe(true);
  });

  it("realistic fog: unlit lights reveal nothing; lit ones do; burned-out ones stop", () => {
    const d = scene();
    d.fog.mode = "realistic";
    const s = d.grid.size;
    d.tokens.push(tok("t", 2.5 * s, 2.5 * s, { owner: "p1", vision: 2 }));
    d.lights.push({ id: "L", x: 6.5 * s, y: 2.5 * s, radius: 3, color: "#fff", intensity: 0.5 });
    const unlit = computeVisibleCells(d, "p1", 1000);
    expect(unlit.has(cellKey(6, 2))).toBe(false); // cold lantern
    d.lights[0].lit = true;
    d.lights[0].litAt = 1000;
    d.lights[0].burnSeconds = 60;
    expect(computeVisibleCells(d, "p1", 1000).has(cellKey(6, 2))).toBe(true); // burning
    expect(computeVisibleCells(d, "p1", 1000 + 61_000).has(cellKey(6, 2))).toBe(false); // burned out
  });
});
