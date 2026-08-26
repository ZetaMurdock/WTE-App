import { describe, it, expect } from "vitest";
import { SimulationSystem } from "./SimulationSystem";
import {
  defaultSceneData,
  type VttEffect,
  type VttEffectData,
  type VttEffectKind,
  type VttSceneData,
  type VttToken,
} from "../../types/scene";

const SIZE = 70;

/** Stands in for the Curator's authorised path: commits the statuses and reports
 *  that it did, so a test sees what a real table would. */
const commit = (data: VttSceneData) => (id: string, statuses: string[]) => {
  const token = data.tokens.find((t) => t.id === id);
  if (!token) return false;
  token.statuses = statuses;
  return true;
};

/**
 * The membership test as it stood BEFORE this pass was generalised — the body of
 * `EffectLayer.zoneContains`, copied verbatim.
 *
 * It is a copy on purpose. Importing the original would drag a Pixi draw layer
 * into a unit test, and the original is gone anyway: it was deleted precisely so
 * the app has ONE containment answer rather than a geometry module plus a second
 * rectangle test on a renderer, quietly drifting apart. Frozen here it does the
 * one job left to it, which is to hold the new code to the old behaviour.
 */
function legacyZoneContains(e: VttEffect, size: number, wx: number, wy: number): boolean {
  if (e.kind !== "zone") return false;
  const w = (e.data.w ?? 4) * size;
  const h = (e.data.h ?? 4) * size;
  return wx >= e.x && wx <= e.x + w && wy >= e.y && wy <= e.y + h;
}

const fx = (id: string, kind: VttEffectKind, data: VttEffectData, x = 0, y = 0): VttEffect => ({ id, kind, x, y, data });

const tok = (id: string, x: number, y: number, size = 1, statuses?: string[]): VttToken => ({
  id,
  name: id,
  x,
  y,
  size,
  color: "#fff",
  visible: true,
  ...(statuses ? { statuses } : {}),
});

function scene(effects: VttEffect[], tokens: VttToken[]): VttSceneData {
  const data = defaultSceneData();
  data.grid = { ...data.grid, size: SIZE };
  data.effects = effects;
  data.tokens = tokens;
  return data;
}

const sim = new SimulationSystem();

describe("SimulationSystem — rectangular zones are unchanged", () => {
  it("agrees with the pre-generalisation test at every sampled point", () => {
    // Generalising membership swapped the rectangle-only test for one that
    // handles every shape. For the rectangle it has to be the SAME test, point
    // for point, or tables find tokens sliding in and out of zones nobody moved.
    const zone = fx("z", "zone", { w: 3, h: 2, status: "Burning" }, 140, 70);
    for (let x = -40; x <= 500; x += 17) {
      for (let y = -40; y <= 400; y += 19) {
        const token = tok("t", x, y);
        const data = scene([zone], [token]);
        sim.tick(data, SIZE, commit(data));
        expect([x, y, (token.statuses ?? []).includes("Burning")]).toEqual([x, y, legacyZoneContains(zone, SIZE, x, y)]);
      }
    }
  });

  it("still grants on entry, revokes on exit, and never touches a manual tag", () => {
    const zone = fx("z", "zone", { w: 2, h: 2, status: "Burning" }, 0, 0);
    const token = tok("t", 35, 35, 1, ["Bleeding"]);
    const data = scene([zone], [token]);

    expect(sim.tick(data, SIZE, commit(data))).toBe(true);
    expect(token.statuses).toEqual(["Bleeding", "Burning"]);
    // Idempotent: standing still is not a second application.
    expect(sim.tick(data, SIZE, commit(data))).toBe(false);

    token.x = 500;
    expect(sim.tick(data, SIZE, commit(data))).toBe(true);
    expect(token.statuses).toEqual(["Bleeding"]);
  });

  it("keeps a Large body in a rectangle the old test already had it in", () => {
    // The regression that footprint-only sampling introduced, pinned at the
    // scene level. A 1x1 zone dropped on an unsnapped corner covers y 23..93;
    // both rows of a size-2 body anchored at y 80 sit at 105 and 175, outside.
    // Sampling the anchor point too is what keeps the old answer.
    const zone = fx("z", "zone", { w: 1, h: 1, status: "Burning" }, 0, 23);
    for (const size of [1, 2, 3, 4]) {
      const token = tok("t", 5, 80, size);
      const data = scene([zone], [token]);
      sim.tick(data, SIZE, commit(data));
      expect([size, legacyZoneContains(zone, SIZE, 5, 80)]).toEqual([size, true]);
      expect([size, token.statuses ?? []]).toEqual([size, ["Burning"]]);
    }
  });

  it("measures with the gridSize the CALLER passed, not the scene's own", () => {
    // The signature has taken a gridSize since before this pass, and the sim now
    // needs the whole grid record for footprint maths. Reading `size` off that
    // record instead would silently hand the argument back to the scene — and
    // the two differ wherever a caller measures a scene it is not rendering.
    const zone = fx("z", "zone", { w: 1, h: 1, status: "Burning" }, 0, 0);
    const token = tok("t", 90, 90);
    const data = scene([zone], [token]);
    data.grid = { ...data.grid, size: 20 }; // scene disagrees with the caller
    expect(sim.tick(data, 100, commit(data))).toBe(true);
    expect(token.statuses).toEqual(["Burning"]); // 90 <= 100, inside at the caller's scale
    expect(legacyZoneContains(zone, 20, 90, 90)).toBe(false); // and outside at the scene's
  });

  it("treats an empty status string as no status at all", () => {
    // `""` is a drawing with a blank label, not a tag. Letting it through would
    // push an unnamed pip onto everyone standing inside and never take it off.
    const data = scene([fx("z", "zone", { w: 4, h: 4, status: "" })], [tok("t", 35, 35)]);
    expect(sim.tick(data, SIZE, commit(data))).toBe(false);
    expect(data.tokens[0].statuses).toBeUndefined();
  });

  it("does nothing at all when no effect carries a status", () => {
    // A plain AoE template is a drawing. Only a status-bearing effect owns a tag.
    const data = scene([fx("z", "zone", { w: 4, h: 4 })], [tok("t", 35, 35)]);
    expect(sim.tick(data, SIZE, commit(data))).toBe(false);
    expect(data.tokens[0].statuses).toBeUndefined();
  });
});

describe("SimulationSystem — every other shape finally counts", () => {
  const shapes: Array<[VttEffectKind, VttEffectData, { x: number; y: number }, { x: number; y: number }]> = [
    ["circle", { radius: 2, status: "Chilled" }, { x: 100, y: 0 }, { x: 400, y: 0 }],
    ["cone", { radius: 2, dir: 0, angle: 60, status: "Chilled" }, { x: 100, y: 0 }, { x: 100, y: 80 }],
    ["line", { radius: 2, w: 1, dir: 0, status: "Chilled" }, { x: 70, y: 0 }, { x: 70, y: 36 }],
    ["ring", { radius: 2, w: 1, status: "Chilled" }, { x: 100, y: 0 }, { x: 30, y: 0 }],
    ["cross", { radius: 2, w: 1, status: "Chilled" }, { x: 100, y: 0 }, { x: 100, y: 100 }],
  ];

  it("puts the tag on whoever stands in a circle, cone, line, ring or cross", () => {
    // Before this, an `In zone:` condition under anything but a rectangle
    // enumerated nobody — forever. The declared field simply never landed.
    for (const [kind, data, inside, outside] of shapes) {
      const effect = fx("z", kind, data);
      const here = tok("in", inside.x, inside.y);
      const there = tok("out", outside.x, outside.y);
      const scn = scene([effect], [here, there]);
      expect([kind, sim.tick(scn, SIZE, commit(scn))]).toEqual([kind, true]);
      expect([kind, here.statuses]).toEqual([kind, ["Chilled"]]);
      expect([kind, there.statuses ?? []]).toEqual([kind, []]);
    }
  });

  it("revokes when the field moves off the token", () => {
    // An aura reanchored onto its walking caster leaves people behind, and the
    // tag has to come off them the same round the circle stops covering them.
    const aura = fx("z", "circle", { radius: 1, status: "Chilled" }, 35, 35);
    const token = tok("t", 35, 35);
    const data = scene([aura], [token]);
    sim.tick(data, SIZE, commit(data));
    expect(token.statuses).toEqual(["Chilled"]);
    aura.x = 700;
    expect(sim.tick(data, SIZE, commit(data))).toBe(true);
    expect(token.statuses).toEqual([]);
  });

  it("holds a tag from each overlapping effect independently", () => {
    const fire = fx("f", "circle", { radius: 1, status: "Burning" }, 35, 35);
    const frost = fx("c", "zone", { w: 1, h: 1, status: "Chilled" }, 0, 0);
    const token = tok("t", 35, 35);
    const data = scene([fire, frost], [token]);
    sim.tick(data, SIZE, commit(data));
    expect(token.statuses).toEqual(["Burning", "Chilled"]);
    fire.x = 700;
    sim.tick(data, SIZE, commit(data));
    expect(token.statuses).toEqual(["Chilled"]);
  });
});

describe("SimulationSystem — a body bigger than one square", () => {
  it("counts a Large token standing half in the fire as standing in it", () => {
    // The deliberate footprint rule, pinned. The Large token's own centre is
    // outside this circle; one of the four cells it fills is not, and a creature
    // that fills a burning square is in the fire. See effectOccupants' header.
    const fire = fx("f", "circle", { radius: 0.5, status: "Burning" }, 175, 175);
    const large = tok("large", 105, 105, 2);
    const small = tok("small", 105, 105, 1);
    const data = scene([fire], [large, small]);
    sim.tick(data, SIZE, commit(data));
    expect(large.statuses).toEqual(["Burning"]);
    expect(small.statuses ?? []).toEqual([]);
  });
});

describe("SimulationSystem — a crowded scene", () => {
  it("reconciles 100 tokens against several fields in one pass", () => {
    // The stated per-round ceiling. Correctness at scale is the assertion; the
    // cost is a few hundred point tests once per ROUND, which no stopwatch in a
    // test runner could measure honestly.
    const tokens = Array.from({ length: 100 }, (_, i) => tok("t" + i, (i % 10) * 70 + 35, Math.floor(i / 10) * 70 + 35));
    const effects = [
      fx("a", "circle", { radius: 0.4, status: "Burning" }, 35, 35),
      fx("b", "zone", { w: 2, h: 1, status: "Chilled" }, 0, 70),
      fx("c", "line", { radius: 3, w: 1, dir: 0, status: "Shocked" }, 35, 175),
      fx("d", "cone", { radius: 2, dir: 0, angle: 60, status: "Dazed" }, 35, 315),
    ];
    const data = scene(effects, tokens);
    expect(sim.tick(data, SIZE, commit(data))).toBe(true);
    const tagged = tokens.filter((t) => (t.statuses ?? []).length > 0);
    // One per shape, worked out by hand: the circle takes the token on its own
    // square; the 2x1 rectangle takes the two tokens in its row; the 3-cell beam
    // reaches four squares along its axis; the 140px cone reaches three.
    expect(tagged.map((t) => t.id)).toEqual(["t0", "t10", "t11", "t20", "t21", "t22", "t23", "t40", "t41", "t42"]);
    // Nothing moved, so the second pass writes nothing.
    expect(sim.tick(data, SIZE, commit(data))).toBe(false);
  });
});

describe("who commits the pip", () => {
  const field = (): VttSceneData => {
    const data = defaultSceneData();
    data.effects = [{ id: "e1", kind: "circle", x: 0, y: 0, data: { radius: 3, status: "Burning" } } as VttEffect];
    data.tokens = [{ id: "t1", name: "A", x: 10, y: 10, size: 1, color: "#fff", visible: true } as VttToken];
    return data;
  };

  it("routes every tag through the authorised writer rather than the token", () => {
    // Assigning token.statuses here would emit no token.update, and the round
    // tick never broadcasts — the pip would be Curator-local and a player would
    // stand in a fire their own table could not see.
    const data = field();
    const seen: [string, string[]][] = [];
    const sim = new SimulationSystem();
    sim.tick(data, SIZE, (id, statuses) => {
      seen.push([id, statuses]);
      const token = data.tokens.find((t) => t.id === id)!;
      token.statuses = statuses;
      return true;
    });
    expect(seen).toEqual([["t1", ["Burning"]]]);
  });

  it("leaves the token alone when the write is refused", () => {
    const data = field();
    const sim = new SimulationSystem();
    expect(sim.tick(data, SIZE, () => false)).toBe(false);
    expect(data.tokens[0].statuses).toBeUndefined();
  });
});
