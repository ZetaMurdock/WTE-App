// The Azgaar importer, proven on a hand-built two-state world: a 30×20 map of
// four square cells on a 3×3 vertex lattice — Redland owns the left column,
// Bluemoor the right. Small enough to reason about by hand, complete enough
// to exercise burgs, markers, scale, and the border tracer in BOTH shapes
// Azgaar has shipped (cells as parallel arrays, cells as object rows).
import { describe, expect, it } from "vitest";
import { importAzgaar } from "./azgaarImport";
import { pointInPolygon } from "./atlasMath";

const VERTICES_P = [
  [0, 0], [15, 0], [30, 0],
  [0, 10], [15, 10], [30, 10],
  [0, 20], [15, 20], [30, 20],
];
const VERTICES_C = [
  [0], [0, 1], [1],
  [0, 2], [0, 1, 2, 3], [1, 3],
  [2], [2, 3], [3],
];
const CELL_RINGS = [
  [0, 1, 4, 3],
  [1, 2, 5, 4],
  [3, 4, 7, 6],
  [4, 5, 8, 7],
];
const CELL_STATES = [1, 2, 1, 2];

function fixture(cellShape: "arrays" | "objects") {
  const cells =
    cellShape === "arrays"
      ? { v: CELL_RINGS, state: CELL_STATES }
      : CELL_RINGS.map((v, i) => ({ i, v, state: CELL_STATES[i] }));
  const vertices =
    cellShape === "arrays"
      ? { p: VERTICES_P, c: VERTICES_C }
      : VERTICES_P.map((p, i) => ({ p, c: VERTICES_C[i] }));
  return {
    info: { width: 30, height: 20, mapName: "Vadruna Test" },
    settings: { distanceScale: 4, distanceUnit: "km" },
    notes: [{ id: "marker7", name: "The Sunken Gate" }],
    pack: {
      cells,
      vertices,
      burgs: [
        {},
        { i: 1, name: "Rivenbark", x: 7.5, y: 5, state: 1, capital: 1, population: 20 },
        { i: 2, name: "Lowmarsh", x: 7.5, y: 15, state: 1, population: 4 },
        { i: 3, name: "Bluehaven", x: 22.5, y: 10, state: 2, population: 11 },
        { i: 4, name: "Gone", x: 1, y: 1, removed: true },
      ],
      markers: [{ i: 7, x: 15, y: 10, type: "portal" }],
      states: [
        { i: 0, name: "Neutrals" },
        { i: 1, name: "Redland" },
        { i: 2, name: "Bluemoor" },
        { i: 3, name: "Fallen Realm", removed: true },
      ],
    },
  };
}

describe("the Azgaar import", () => {
  for (const shape of ["arrays", "objects"] as const) {
    it(`reads the ${shape} cell shape`, () => {
      const out = importAzgaar(fixture(shape))!;
      expect(out).not.toBeNull();
      expect(out.mapName).toBe("Vadruna Test");
      expect(out.zones.map((z) => z.name).sort()).toEqual(["Bluemoor", "Redland"]);
      expect(out.nodes.filter((n) => n.kind === "settlement")).toHaveLength(3);
    });
  }

  it("suggests the real-world size from the distance scale, km converted", () => {
    const out = importAzgaar(fixture("arrays"))!;
    expect(out.suggestedWidthMi).toBeCloseTo(30 * 4 * 0.621371, 1);
    expect(out.suggestedHeightMi).toBeCloseTo(20 * 4 * 0.621371, 1);
  });

  it("traces each state's territory as a closed border in normalized space", () => {
    const out = importAzgaar(fixture("arrays"))!;
    const red = out.zones.find((z) => z.name === "Redland")!;
    // Redland is the left half: its heart is inside, Bluemoor's is not
    expect(pointInPolygon({ x: 0.25, y: 0.5 }, red.polygon.map((p) => ({ x: p.u, y: p.v })))).toBe(true);
    expect(pointInPolygon({ x: 0.75, y: 0.5 }, red.polygon.map((p) => ({ x: p.u, y: p.v })))).toBe(false);
    // shared border with Bluemoor runs down the middle of the map
    expect(red.polygon.some((p) => Math.abs(p.u - 0.5) < 1e-9)).toBe(true);
  });

  it("orders settlements by importance and keeps capitals flagged", () => {
    const out = importAzgaar(fixture("arrays"))!;
    const s = out.nodes.filter((n) => n.kind === "settlement");
    expect(s[0].name).toBe("Rivenbark");
    expect(s[0].capital).toBe(true);
    expect(s[0].u).toBeCloseTo(0.25);
    expect(s[0].v).toBeCloseTo(0.25);
    expect(out.nodes.map((n) => n.name)).not.toContain("Gone"); // removed stays gone
  });

  it("names markers from the notes legend", () => {
    const out = importAzgaar(fixture("arrays"))!;
    const m = out.nodes.find((n) => n.kind === "landmark")!;
    expect(m.name).toBe("The Sunken Gate");
    expect(m.u).toBeCloseTo(0.5);
  });

  it("skips the Neutrals and removed states", () => {
    const out = importAzgaar(fixture("arrays"))!;
    expect(out.zones.map((z) => z.name)).not.toContain("Neutrals");
    expect(out.zones.map((z) => z.name)).not.toContain("Fallen Realm");
  });

  it("survives a file with burgs but no readable mesh", () => {
    const f = fixture("arrays") as { pack: Record<string, unknown> };
    delete f.pack.cells;
    const out = importAzgaar(f)!;
    expect(out.zones).toHaveLength(0);
    expect(out.nodes.length).toBeGreaterThan(0);
    expect(out.dropped.join(" ")).toMatch(/territories/);
  });

  it("refuses files that are not an Azgaar export at all", () => {
    expect(importAzgaar(null)).toBeNull();
    expect(importAzgaar({ hello: "world" })).toBeNull();
    expect(importAzgaar({ pack: {}, info: { width: 0, height: 0 } })).toBeNull();
  });
});
