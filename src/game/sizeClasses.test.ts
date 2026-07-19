import { describe, expect, it } from "vitest";
import {
  SIZE_CLASSES,
  WEIGHT_CATS,
  ATTR_KEYS,
  SPEC_KEYS,
  computeDerived,
  sizeDiffMods,
  sizeGrapple,
  sizeIndexOf,
  sizeOf,
  rollSpecialty,
  type Attributes,
  type Specialties,
} from "./wte";

const idx = (key: string) => SIZE_CLASSES.findIndex((s) => s.key === key);
function attrs(v = 10): Attributes {
  return Object.fromEntries(ATTR_KEYS.map((k) => [k, v])) as Attributes;
}
function specs(v = 20): Specialties {
  return Object.fromEntries(SPEC_KEYS.map((k) => [k, v])) as Specialties;
}

describe("size class table", () => {
  it("has the six classes in ascending scale", () => {
    expect(SIZE_CLASSES.map((s) => s.key)).toEqual(["tiny", "small", "moderate", "large", "huge", "colossal"]);
  });

  it("matches the published matrix", () => {
    const row = (k: string) => SIZE_CLASSES[idx(k)];
    expect(row("tiny")).toMatchObject({ startHp: 10, dhpMod: -5, apMod: 9, evMod: 4, budget: 8, reach: 0, move: 15 });
    expect(row("small")).toMatchObject({ startHp: 15, dhpMod: -2, apMod: 3, evMod: 2, budget: 13, reach: 5, move: 25 });
    expect(row("moderate")).toMatchObject({ startHp: 25, dhpMod: 0, apMod: 0, evMod: 0, budget: 20, reach: 5, move: 30 });
    expect(row("large")).toMatchObject({ startHp: 35, dhpMod: 5, apMod: -2, evMod: -2, budget: 27, reach: 10, move: 35 });
    expect(row("huge")).toMatchObject({ startHp: 55, dhpMod: 10, apMod: -5, evMod: -5, budget: 35, reach: 15, move: 45 });
    expect(row("colossal")).toMatchObject({ startHp: 90, dhpMod: 20, apMod: -10, evMod: -8, budget: 50, reach: 25, move: 60 });
  });

  it("is an inverse kinetic scale — bigger is tougher and slower to react", () => {
    for (let i = 1; i < SIZE_CLASSES.length; i++) {
      expect(SIZE_CLASSES[i].dhpMod).toBeGreaterThan(SIZE_CLASSES[i - 1].dhpMod);
      expect(SIZE_CLASSES[i].apMod).toBeLessThan(SIZE_CLASSES[i - 1].apMod);
      expect(SIZE_CLASSES[i].evMod).toBeLessThan(SIZE_CLASSES[i - 1].evMod);
      expect(SIZE_CLASSES[i].budget).toBeGreaterThan(SIZE_CLASSES[i - 1].budget);
      expect(SIZE_CLASSES[i].move).toBeGreaterThan(SIZE_CLASSES[i - 1].move);
    }
  });

  it("each weight class maps to the size that can wield it", () => {
    expect(WEIGHT_CATS.map((w) => w.minSize)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(WEIGHT_CATS.every((w) => w.weight && w.examples)).toBe(true);
  });
});

describe("size modifiers reach the derived stats", () => {
  it("a Huge body is tougher, slower to act and easier to hit than a Moderate one", () => {
    const mod = computeDerived(attrs(), specs(), { sizeId: "moderate" });
    const huge = computeDerived(attrs(), specs(), { sizeId: "huge" });
    expect(huge.raw.dhp).toBe(mod.raw.dhp + 10); // +10 DHP into the pool
    expect(huge.ev).toBe(mod.ev - 5); // −5 evasion
    expect(huge.hpMax).toBeGreaterThan(mod.hpMax);
  });

  it("Tiny never falls below the DHP floor of 5", () => {
    const tiny = computeDerived(
      Object.fromEntries(ATTR_KEYS.map((k) => [k, 0])) as Attributes,
      Object.fromEntries(SPEC_KEYS.map((k) => [k, 0])) as Specialties,
      { sizeId: "tiny" }
    );
    expect(tiny.raw.dhp).toBeGreaterThanOrEqual(5);
  });

  it("movement is floored at the class's base move", () => {
    expect(computeDerived(attrs(1), specs(1), { sizeId: "colossal" }).mv).toBeGreaterThanOrEqual(60);
  });

  it("Moderate is a true baseline — no size shift at all", () => {
    const bare = computeDerived(attrs(), specs(), {});
    const moderate = computeDerived(attrs(), specs(), { sizeId: "moderate" });
    expect(moderate.raw.dhp).toBe(bare.raw.dhp);
    expect(moderate.ev).toBe(bare.ev);
  });
});

describe("size-difference combat", () => {
  it("punching up and down the ladder", () => {
    expect(sizeDiffMods(idx("large"), idx("moderate"))).toMatchObject({ attack: 1, damage: "+1d4" });
    expect(sizeDiffMods(idx("huge"), idx("moderate"))).toMatchObject({ attack: 2, damage: "+1d6" });
    expect(sizeDiffMods(idx("colossal"), idx("moderate"))).toMatchObject({ attack: 3, posture: "advantage", limit: "Target cannot Parry" });
    expect(sizeDiffMods(idx("moderate"), idx("moderate"))).toMatchObject({ attack: 0, posture: "standard" });
    expect(sizeDiffMods(idx("small"), idx("moderate"))).toMatchObject({ attack: 0, damage: "−1d4 (min 1 die)" });
    expect(sizeDiffMods(idx("tiny"), idx("moderate"))).toMatchObject({ posture: "disadvantage", damage: "−2 flat" });
    expect(sizeDiffMods(idx("tiny"), idx("large"))).toMatchObject({ attack: -2, damage: "−4 flat", limit: "Target cannot Endure" });
  });

  it("grapples scale with the mismatch", () => {
    expect(sizeGrapple(idx("moderate"), idx("moderate"))).toMatchObject({ mod: 0, automatic: false, posture: "standard" });
    expect(sizeGrapple(idx("large"), idx("moderate"))).toMatchObject({ mod: 2 });
    expect(sizeGrapple(idx("huge"), idx("moderate"))).toMatchObject({ posture: "advantage" });
    expect(sizeGrapple(idx("colossal"), idx("moderate"))).toMatchObject({ automatic: true });
    expect(sizeGrapple(idx("small"), idx("huge"))).toMatchObject({ posture: "disadvantage" });
  });
});

describe("auto size falls back to the species default", () => {
  it("resolves auto through the species table", () => {
    expect(sizeOf("auto", "hyomen").key).toBe("moderate");
    expect(sizeOf("auto", "mirga").key).toBe("small");
    expect(sizeIndexOf("huge", "hyomen")).toBe(idx("huge")); // explicit beats species
  });
});

describe("every check is a d20", () => {
  it("specialty checks roll a d20", () => {
    for (let i = 0; i < 40; i++) {
      const r = rollSpecialty("Willpower", 30);
      expect(r.formula.startsWith("1d20")).toBe(true);
      expect((r.detail as { die: number }).die).toBe(20);
    }
  });
});
