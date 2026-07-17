import { describe, expect, it } from "vitest";
import { OPEN_CUTOFF, spatialMix, wallsBetween } from "./spatialAudio";
import type { VttEmitter, VttWall } from "../../types/scene";

const CELL = 70;

function emitter(over: Partial<VttEmitter> = {}): VttEmitter {
  return { id: "em1", x: 0, y: 0, radius: 10, name: "drips", src: "data:x", volume: 1, loop: true, ...over };
}
function wall(x1: number, y1: number, x2: number, y2: number, blocksLight = true): VttWall {
  return { id: "w-" + x1 + "-" + y1, x1, y1, x2, y2, blocksLight };
}

describe("wallsBetween", () => {
  it("counts each wall the line crosses", () => {
    const walls = [wall(100, -100, 100, 100), wall(200, -100, 200, 100)];
    expect(wallsBetween(walls, 0, 0, 300, 0)).toBe(2);
    expect(wallsBetween(walls, 0, 0, 150, 0)).toBe(1);
    expect(wallsBetween(walls, 0, 0, 50, 0)).toBe(0);
  });
  it("ignores walls off to the side", () => {
    expect(wallsBetween([wall(100, 50, 100, 200)], 0, 0, 300, 0)).toBe(0);
  });
  it("see-through walls don't muffle", () => {
    expect(wallsBetween([wall(100, -100, 100, 100, false)], 0, 0, 300, 0)).toBe(0);
  });
});

describe("spatialMix", () => {
  it("full volume at the source, unmuffled", () => {
    const m = spatialMix(emitter(), 0, 0, [], CELL);
    expect(m.gain).toBeCloseTo(1);
    expect(m.cutoff).toBe(OPEN_CUTOFF);
  });
  it("silent at and beyond the audible radius", () => {
    expect(spatialMix(emitter(), 10 * CELL, 0, [], CELL).gain).toBe(0);
    expect(spatialMix(emitter(), 25 * CELL, 0, [], CELL).gain).toBe(0);
  });
  it("gain falls off with distance", () => {
    const near = spatialMix(emitter(), 2 * CELL, 0, [], CELL).gain;
    const far = spatialMix(emitter(), 8 * CELL, 0, [], CELL).gain;
    expect(near).toBeGreaterThan(far);
    expect(far).toBeGreaterThan(0);
  });
  it("emitter volume scales the whole curve", () => {
    const loud = spatialMix(emitter({ volume: 1 }), 3 * CELL, 0, [], CELL).gain;
    const quiet = spatialMix(emitter({ volume: 0.5 }), 3 * CELL, 0, [], CELL).gain;
    expect(quiet).toBeCloseTo(loud / 2);
  });
  it("a wall between halves the gain and low-passes hard", () => {
    const between = [wall(CELL, -CELL, CELL, CELL)];
    const open = spatialMix(emitter(), 3 * CELL, 0, [], CELL);
    const muffled = spatialMix(emitter(), 3 * CELL, 0, between, CELL);
    expect(muffled.gain).toBeCloseTo(open.gain / 2);
    expect(muffled.cutoff).toBeLessThan(2000);
    expect(open.cutoff).toBe(OPEN_CUTOFF);
  });
  it("more walls, more muffle — cutoff floors instead of hitting zero", () => {
    const two = [wall(CELL, -CELL, CELL, CELL), wall(2 * CELL, -CELL, 2 * CELL, CELL)];
    const one = spatialMix(emitter(), 4 * CELL, 0, two.slice(0, 1), CELL);
    const both = spatialMix(emitter(), 4 * CELL, 0, two, CELL);
    expect(both.gain).toBeLessThan(one.gain);
    expect(both.cutoff).toBeLessThan(one.cutoff);
    const many = [...two, wall(3 * CELL, -CELL, 3 * CELL, CELL), wall(3.5 * CELL, -CELL, 3.5 * CELL, CELL)];
    expect(spatialMix(emitter({ radius: 20 }), 5 * CELL, 0, many, CELL).cutoff).toBeGreaterThanOrEqual(240);
  });
});
