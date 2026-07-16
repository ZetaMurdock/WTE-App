import { describe, it, expect } from "vitest";
import { effectBodyContains } from "./effectGeometry";
import type { VttEffect, VttEffectKind, VttEffectData } from "../../types/scene";

const SIZE = 70;
const fx = (kind: VttEffectKind, data: VttEffectData): VttEffect => ({ id: "e", kind, x: 0, y: 0, data });
const hit = (e: VttEffect, x: number, y: number) => effectBodyContains(e, SIZE, x, y);

describe("effectBodyContains", () => {
  it("circle: inside vs outside the radius", () => {
    const e = fx("circle", { radius: 2 }); // 140px
    expect(hit(e, 100, 0)).toBe(true);
    expect(hit(e, 141, 0)).toBe(false);
  });

  it("cone: respects reach AND angular spread (dir 0, 60°)", () => {
    const e = fx("cone", { radius: 2, dir: 0, angle: 60 });
    expect(hit(e, 100, 0)).toBe(true); // dead ahead
    expect(hit(e, 100, 40)).toBe(true); // ~21.8° off-axis, inside ±30°
    expect(hit(e, 100, 80)).toBe(false); // ~38.7° off-axis, outside
    expect(hit(e, -50, 0)).toBe(false); // behind the apex
    expect(hit(e, 200, 0)).toBe(false); // past the reach
  });

  it("cone: handles facings across the ±PI wrap", () => {
    const e = fx("cone", { radius: 2, dir: Math.PI, angle: 60 }); // facing left
    expect(hit(e, -100, 0)).toBe(true);
    expect(hit(e, 100, 0)).toBe(false);
  });

  it("line: within length and half-thickness of the beam", () => {
    const e = fx("line", { radius: 2, w: 1, dir: 0 }); // 140 long, 70 wide
    expect(hit(e, 70, 0)).toBe(true); // on the axis
    expect(hit(e, 70, 34)).toBe(true); // inside half-width (35)
    expect(hit(e, 70, 36)).toBe(false); // just past it
    expect(hit(e, -5, 0)).toBe(false); // behind the origin
    expect(hit(e, 141, 0)).toBe(false); // past the end
  });

  it("ring: inside the band only (not the hollow centre)", () => {
    const e = fx("ring", { radius: 2, w: 1 }); // outer 140, band 70
    expect(hit(e, 100, 0)).toBe(true); // in the band (70..140)
    expect(hit(e, 30, 0)).toBe(false); // hollow centre
    expect(hit(e, 141, 0)).toBe(false); // outside
  });

  it("cross: hits either bar, misses the diagonal gaps", () => {
    const e = fx("cross", { radius: 2, w: 1 }); // arms 140, thickness 70
    expect(hit(e, 100, 0)).toBe(true); // horizontal bar
    expect(hit(e, 0, 100)).toBe(true); // vertical bar
    expect(hit(e, 100, 100)).toBe(false); // diagonal gap
  });

  it("zone: rectangle anchored at the effect origin", () => {
    const e = fx("zone", { w: 2, h: 1 }); // 140 x 70 from (0,0)
    expect(hit(e, 100, 30)).toBe(true);
    expect(hit(e, 150, 30)).toBe(false);
    expect(hit(e, -1, 30)).toBe(false);
  });
});
