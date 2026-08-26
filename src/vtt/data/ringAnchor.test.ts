import { describe, expect, it } from "vitest";
import { RING_BUTTON, ringOffsets, ringPlacement, ringRadius } from "./ringAnchor";

const CAM = { x: 100, y: 40, zoom: 2 };

describe("ringPlacement", () => {
  it("lands a token's world square on the screen pixel the camera puts it at", () => {
    // The whole contract: 300 world px at 2x zoom is 600 screen px, plus the
    // camera's own 100px pan. Wrong by a factor of the zoom is the failure this
    // exists to catch, and it is invisible at zoom 1 — which is why the fixture
    // is not zoom 1.
    const at = ringPlacement({ world: { x: 300, y: 150 }, camera: CAM, radius: 60 });
    expect(at).toEqual({ x: 700, y: 340, radius: 60, clamped: false });
  });

  it("has nothing to anchor to when the thing it followed is gone", () => {
    expect(ringPlacement({ world: null, camera: CAM, radius: 60 })).toBeNull();
  });

  it("pulls a ring anchored off-canvas back onto the stage, and says it did", () => {
    // A caster who walked off-screen, or a camera panned away from a declared
    // origin. Rendering at the true screen point puts every button outside the
    // stage, where the Curator cannot press Cancel either.
    const at = ringPlacement({
      world: { x: -400, y: 90 },
      camera: CAM,
      radius: 60,
      viewport: { width: 900, height: 500 },
    });
    expect(at?.clamped).toBe(true);
    expect(at?.x).toBe(60 + RING_BUTTON / 2);
    expect(at?.y).toBe(220);
  });

  it("leaves a ring that already fits exactly where the camera put it", () => {
    const at = ringPlacement({
      world: { x: 300, y: 150 },
      camera: { x: 0, y: 0, zoom: 1 },
      radius: 60,
      viewport: { width: 900, height: 500 },
    });
    expect(at).toEqual({ x: 300, y: 150, radius: 60, clamped: false });
  });

  it("clamps nothing against a viewport that has not been measured yet", () => {
    // First frame after a mount. Clamping against zero would stack the ring in
    // the corner and then snap it to the token, which reads as a glitch.
    const at = ringPlacement({ world: { x: 300, y: 150 }, camera: CAM, radius: 60, viewport: { width: 0, height: 0 } });
    expect(at).toEqual({ x: 700, y: 340, radius: 60, clamped: false });
  });

  it("centres a ring too big for its stage instead of pinning it to one edge", () => {
    // A ring wider than the surface it is drawn on has no legal centre: the
    // clamp's low bound passes its high bound. Half the stage is the
    // least-wrong answer — taking the bounds literally shoves every button off
    // one side, Cancel included, on exactly the narrow window where the Curator
    // most needs a way out.
    const at = ringPlacement({
      world: { x: 60, y: 40 },
      camera: { x: 0, y: 0, zoom: 1 },
      radius: 200,
      viewport: { width: 120, height: 80 },
    });
    expect(at).toMatchObject({ x: 60, y: 40 });
  });
});

describe("ringRadius", () => {
  it("clears a big body at high zoom", () => {
    // A size-3 token on a 70px grid is 105 world px from centre to edge; at 2x
    // that is 210 screen px, and the gap rides on top in SCREEN px because the
    // buttons do not scale with the camera.
    expect(ringRadius({ camera: CAM, bodyCells: 3, gridSize: 70 })).toBe(240);
  });

  it("opens up for a crowded ring so its buttons cannot overlap", () => {
    const tight = { camera: { x: 0, y: 0, zoom: 0.5 }, bodyCells: 1, gridSize: 70 };
    const body = ringRadius(tight);
    const crowded = ringRadius({ ...tight, count: 8 });
    expect(crowded).toBeGreaterThan(body);
    // Circumference has to hold every button with air between them, or two of
    // them sit on top of each other and one is unpressable.
    expect(2 * Math.PI * crowded).toBeGreaterThanOrEqual(8 * RING_BUTTON);
  });

  it("still clears a body the scene sized at nothing", () => {
    // Size 0 reaches here from a token record the Curator has been editing. A
    // radius derived straight from it collapses the ring onto the square and
    // draws every button on top of the art it is about.
    const cam = { x: 0, y: 0, zoom: 1 };
    expect(ringRadius({ camera: cam, bodyCells: 0, gridSize: 70 })).toBe(ringRadius({ camera: cam, bodyCells: 1, gridSize: 70 }));
  });

  it("never shrinks a ring below the body it surrounds", () => {
    const wide = ringRadius({ camera: CAM, bodyCells: 4, gridSize: 70, count: 2 });
    expect(wide).toBe(ringRadius({ camera: CAM, bodyCells: 4, gridSize: 70 }));
  });
});

describe("ringOffsets", () => {
  it("starts at the top and goes clockwise", () => {
    const [top, right, bottom, left] = ringOffsets(4, 100);
    expect(top.dx).toBeCloseTo(0);
    expect(top.dy).toBeCloseTo(-100);
    expect(right.dx).toBeCloseTo(100);
    expect(bottom.dy).toBeCloseTo(100);
    expect(left.dx).toBeCloseTo(-100);
  });

  it("spreads every button evenly, whatever the count", () => {
    for (const count of [1, 2, 3, 5, 8]) {
      const offs = ringOffsets(count, 80);
      expect(offs).toHaveLength(count);
      for (const off of offs) expect(Math.hypot(off.dx, off.dy)).toBeCloseTo(80);
    }
  });

  it("draws no buttons for an empty ring", () => {
    expect(ringOffsets(0, 80)).toEqual([]);
  });
});
