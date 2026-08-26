import { describe, it, expect } from "vitest";
import {
  occupancyByEffect,
  occupantIdsOf,
  occupantsOf,
  tokenInEffect,
  tokenSamplePoints,
} from "./effectOccupants";
import { tokenFootprint } from "../../data/occupancy";
import type { VttEffect, VttEffectData, VttEffectKind, VttGrid, VttToken } from "../../types/scene";

const GRID: VttGrid = { type: "square", size: 70, cols: 40, rows: 26, color: "#000", visible: true };

const fx = (kind: VttEffectKind, data: VttEffectData, x = 0, y = 0): VttEffect => ({ id: "e-" + kind, kind, x, y, data });

const tok = (id: string, x: number, y: number, size = 1, extra: Partial<VttToken> = {}): VttToken => ({
  id,
  name: id,
  x,
  y,
  size,
  color: "#fff",
  visible: true,
  ...extra,
});

describe("tokenSamplePoints", () => {
  it("samples a size-1 token at its OWN point, snapped or not", () => {
    // The pre-generalisation membership test read token.x/token.y and nothing
    // else. Rounding an unsnapped token to its cell centre here would move the
    // zone boundary under a token nobody moved.
    expect(tokenSamplePoints(GRID, { x: 12, y: 3, size: 1 })).toEqual([{ x: 12, y: 3 }]);
    expect(tokenSamplePoints(GRID, { x: 35, y: 35, size: 1 })).toEqual([{ x: 35, y: 35 }]);
  });

  it("samples a Large token at its own point AND every occupied cell centre", () => {
    const token = { x: 105, y: 105, size: 2 };
    const points = tokenSamplePoints(GRID, token);
    // The own point leads, so membership can only ever GROW as a body does —
    // see the header: dropping it took the tag off Large tokens standing in
    // rectangles this pass was not supposed to touch.
    expect(points[0]).toEqual({ x: 105, y: 105 });
    // The footprint is occupancy's, not a second opinion about which cells a
    // body fills — that is the whole point of sharing it.
    expect(points.slice(1)).toEqual(
      tokenFootprint(GRID, token).map((c) => ({ x: (c.col + 0.5) * GRID.size, y: (c.row + 0.5) * GRID.size }))
    );
    expect(points).toHaveLength(5);
  });

  it("rounds a fractional size UP to the squares it fills, exactly as occupancy does", () => {
    // `tokenFootprint` ceils; anything else here and a body would burn on the
    // cells it may not be pushed off of, or the reverse.
    const token = { x: 105, y: 105, size: 1.5 };
    expect(tokenFootprint(GRID, token)).toHaveLength(4);
    expect(tokenSamplePoints(GRID, token).slice(1)).toEqual(
      tokenFootprint(GRID, token).map((c) => ({ x: (c.col + 0.5) * GRID.size, y: (c.row + 0.5) * GRID.size }))
    );
  });

  it("survives corrupt geometry rather than emitting NaN points", () => {
    expect(tokenSamplePoints(GRID, { x: NaN, y: 0, size: 1 })).toEqual([]);
    expect(tokenSamplePoints(GRID, { x: 0, y: Infinity, size: 2 })).toEqual([]);
    expect(tokenSamplePoints(GRID, { x: 7, y: 9, size: NaN })).toEqual([{ x: 7, y: 9 }]);
    expect(tokenSamplePoints({ ...GRID, size: 0 }, { x: 7, y: 9, size: 3 })).toEqual([{ x: 7, y: 9 }]);
  });
});

describe("tokenInEffect", () => {
  it("enumerates for EVERY effect kind, not just the rectangle", () => {
    const cases: Array<[VttEffect, VttToken, VttToken]> = [
      [fx("circle", { radius: 2 }), tok("in", 100, 0), tok("out", 141, 0)],
      [fx("cone", { radius: 2, dir: 0, angle: 60 }), tok("in", 100, 0), tok("out", 100, 80)],
      [fx("line", { radius: 2, w: 1, dir: 0 }), tok("in", 70, 0), tok("out", 70, 36)],
      [fx("ring", { radius: 2, w: 1 }), tok("in", 100, 0), tok("out", 30, 0)],
      [fx("cross", { radius: 2, w: 1 }), tok("in", 100, 0), tok("out", 100, 100)],
      [fx("zone", { w: 2, h: 1 }), tok("in", 100, 30), tok("out", 150, 30)],
    ];
    for (const [effect, inside, outside] of cases) {
      expect([effect.kind, tokenInEffect(effect, GRID, inside)]).toEqual([effect.kind, true]);
      expect([effect.kind, tokenInEffect(effect, GRID, outside)]).toEqual([effect.kind, false]);
    }
  });

  it("puts a Large body in a template that covers ANY cell it fills", () => {
    // A 1-cell circle sitting on the far corner cell of a 2x2 body. The body's
    // own centre is 99px away and would miss it; the corner cell it fills does
    // not, and a creature that fills a burning square is standing in the fire.
    const corner = fx("circle", { radius: 0.5 }, 175, 175);
    expect(tokenInEffect(corner, GRID, tok("large", 105, 105, 2))).toBe(true);
    expect(tokenInEffect(corner, GRID, tok("small", 105, 105, 1))).toBe(false);
  });

  it("never takes membership AWAY from a body just because it got bigger", () => {
    // The superset property, swept: whatever the old point-only test said was
    // inside a rectangle stays inside for a body of any size. A 1x1 zone on an
    // unsnapped corner is the case that used to break it.
    const zone = fx("zone", { w: 1, h: 1 }, 0, 23);
    const pointInside = (x: number, y: number): boolean =>
      x >= zone.x && x <= zone.x + 70 && y >= zone.y && y <= zone.y + 70;
    for (const size of [1, 2, 3, 4]) {
      for (let x = -40; x <= 300; x += 7) {
        for (let y = -40; y <= 300; y += 7) {
          if (!pointInside(x, y)) continue;
          expect([size, x, y, tokenInEffect(zone, GRID, { x, y, size })]).toEqual([size, x, y, true]);
        }
      }
    }
  });
});

describe("occupantsOf", () => {
  const zone = fx("zone", { w: 4, h: 4 });
  const tokens = [tok("a", 35, 35), tok("b", 500, 500), tok("c", 175, 175), tok("crate", 105, 105, 1, { prop: true })];

  it("returns everyone inside, in scene order", () => {
    // Scene order, so the Curator's list of names does not reshuffle between
    // rounds for tokens that never moved.
    expect(occupantsOf(zone, GRID, tokens).map((t) => t.id)).toEqual(["a", "c", "crate"]);
    expect(occupantIdsOf(zone, GRID, tokens)).toEqual(["a", "c", "crate"]);
  });

  it("answers geometry only — filtering scenery is the caller's rule", () => {
    // RecurringEffectSystem drops props before proposing a card; the status pass
    // does not, because a burning crate may legitimately hold a pip.
    expect(occupantsOf(zone, GRID, tokens).some((t) => t.prop)).toBe(true);
  });

  it("keys an empty list for an effect nobody is standing in", () => {
    // "The fire caught nobody" and "there is no fire" are different answers.
    const empty = fx("circle", { radius: 1 }, 5000, 5000);
    const map = occupancyByEffect([zone, empty], GRID, tokens);
    expect(map.get(empty.id)).toEqual([]);
    expect(map.get(zone.id)?.map((t) => t.id)).toEqual(["a", "c", "crate"]);
    expect(map.has("nope")).toBe(false);
  });

  it("stays linear over a crowded scene", () => {
    // 100 tokens x 8 effects is the stated ceiling for one round tick. This
    // asserts the ANSWER at that scale, not a stopwatch: a timing bound on ~800
    // float tests measures the CI runner's mood, not this module.
    const crowd = Array.from({ length: 100 }, (_, i) => tok("t" + i, (i % 10) * 70 + 35, Math.floor(i / 10) * 70 + 35));
    const effects = Array.from({ length: 8 }, (_, i) => ({ ...fx("circle", { radius: 0.4 }, 35 + i * 70, 35), id: "fx" + i }));
    const map = occupancyByEffect(effects, GRID, crowd);
    expect(map.size).toBe(8);
    // Each sub-cell circle catches the single token on its own square.
    expect([...map.values()].map((v) => v.length)).toEqual([1, 1, 1, 1, 1, 1, 1, 1]);
  });
});
