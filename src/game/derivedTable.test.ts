import { describe, expect, it } from "vitest";
import { ATTR_KEYS, SPEC_KEYS, computeDerived, type Attributes, type Specialties } from "./wte";

const zeroA = () => Object.fromEntries(ATTR_KEYS.map((k) => [k, 0])) as Attributes;
const zeroS = () => Object.fromEntries(SPEC_KEYS.map((k) => [k, 0])) as Specialties;

// THE 10 DERIVED STATISTICS — the published inputs/reduced-by table.
describe("derived statistics table", () => {
  it("matches the published DHP example: END 20 + Weight 25 → 60; Balance 60 → 40", () => {
    const a = { ...zeroA(), end: 20 };
    const s = { ...zeroS(), wt: 25 };
    expect(computeDerived(a, s, {}).raw.dhp).toBe(60);
    expect(computeDerived(a, { ...s, bal: 60 }, {}).raw.dhp).toBe(40); // Balance is no longer a free dump stat
  });

  it("Weapon Mastery feeds Attack Power; Control no longer does", () => {
    const base = computeDerived(zeroA(), zeroS(), {}).raw.atk;
    expect(computeDerived(zeroA(), { ...zeroS(), wm: 30 }, {}).raw.atk).toBeGreaterThan(base);
    expect(computeDerived(zeroA(), { ...zeroS(), ctrl: 30 }, {}).raw.atk).toBe(base);
  });

  it("Control feeds Movement, Synaptic Space and Action Density (Priority is out)", () => {
    const ctrl = computeDerived(zeroA(), { ...zeroS(), ctrl: 30 }, {}).raw;
    const pri = computeDerived(zeroA(), { ...zeroS(), pri: 30 }, {}).raw;
    const base = computeDerived(zeroA(), zeroS(), {}).raw;
    expect(ctrl.mv).toBeGreaterThan(base.mv);
    expect(ctrl.ss).toBeGreaterThan(base.ss);
    expect(ctrl.ad).toBeGreaterThan(base.ad);
    expect(pri.mv).toBe(base.mv);
    expect(pri.ss).toBe(base.ss);
    expect(pri.ad).toBe(base.ad);
  });

  it("Neuronal Capacity reads Perception; Influence reads Perception + Precision and is dragged by Weight", () => {
    const base = computeDerived(zeroA(), zeroS(), {}).raw;
    const per = computeDerived(zeroA(), { ...zeroS(), per: 30 }, {}).raw;
    expect(per.nc).toBeGreaterThan(base.nc);
    expect(per.inf).toBeGreaterThan(base.inf);
    const pre = computeDerived(zeroA(), { ...zeroS(), pre: 30 }, {}).raw;
    expect(pre.inf).toBeGreaterThan(base.inf);
    const wt = computeDerived(zeroA(), { ...zeroS(), wt: 30 }, {}).raw;
    expect(wt.inf).toBeLessThan(base.inf); // −1 per 3 pts of Weight
  });

  it("every reduction runs at −1 per 3 points", () => {
    // DHP with 30 Balance loses exactly 10 off the unreduced value.
    const a = { ...zeroA(), end: 20 };
    const s = { ...zeroS(), wt: 25 };
    const clean = computeDerived(a, s, {}).raw.dhp;
    expect(computeDerived(a, { ...s, bal: 30 }, {}).raw.dhp).toBe(clean - 10);
  });
});
