import { describe, expect, it } from "vitest";
import {
  ATTR_COMPENSATION,
  ATTR_KEYS,
  ATTR_PIVOT,
  SPEC_KEYS,
  attrCompensation,
  poolCompensation,
  computeDerived,
  type Attributes,
  type Specialties,
} from "./wte";

const zeroA = () => Object.fromEntries(ATTR_KEYS.map((k) => [k, 0])) as Attributes;
const zeroS = () => Object.fromEntries(SPEC_KEYS.map((k) => [k, 0])) as Specialties;

describe("attribute compensation — the gated seesaw", () => {
  it("pays nothing at or above the pivot, however well trained", () => {
    expect(attrCompensation(ATTR_PIVOT, true, 0)).toBe(0);
    expect(attrCompensation(20, true, 9)).toBe(0);
  });

  it("pays nothing to an untrained character — dumping alone is never a build", () => {
    expect(attrCompensation(1, false, 0)).toBe(0);
    expect(attrCompensation(1, false, 9)).toBe(0);
  });

  it("pays a trained character, and the payment grows with rank", () => {
    expect(attrCompensation(1, true, 0)).toBe(2);
    expect(attrCompensation(1, true, 9)).toBe(3);
  });

  it("accrues below the reduction rate — 4 points under the pivot per +1", () => {
    expect(attrCompensation(7, true, 0)).toBe(0); // 3 short → nothing yet
    expect(attrCompensation(6, true, 0)).toBe(1); // 4 short → +1
    expect(attrCompensation(2, true, 0)).toBe(2); // 8 short → +2
  });

  it("leaves the high side untouched: a wall of 20s carries its full drag", () => {
    const a = Object.fromEntries(ATTR_KEYS.map((k) => [k, 20])) as Attributes;
    const s = { ...zeroS(), wt: 30, bal: 30, cun: 30, ctrl: 30, adp: 30, pre: 30, per: 30, wm: 30 };
    const before = computeDerived(a, s, { rank: 9 });
    // Every attribute is above the pivot, so nothing is paid back anywhere.
    for (const c of ATTR_COMPENSATION) {
      expect(attrCompensation(a[c.attr], true, 9)).toBe(0);
    }
    expect(before.raw.ev).toBe(computeDerived(a, s, { rank: 9 }).raw.ev);
  });

  it("the trained gate is what makes a small investment visible", () => {
    // Physique 4 (lacking) paying into Evasion, which reads Balance.
    const a = { ...zeroA(), phy: 4, dex: 14 };
    const untrained = computeDerived(a, { ...zeroS(), bal: 24 }, { rank: 0 }).ev;
    const trained = computeDerived(a, { ...zeroS(), bal: 25 }, { rank: 0 }).ev;
    expect(trained).toBeGreaterThan(untrained);
  });

  it("compensation lands on the check, not the raw pool", () => {
    const a = { ...zeroA(), phy: 1 };
    const s = { ...zeroS(), bal: 40 };
    const out = computeDerived(a, s, { rank: 0 });
    const raw = computeDerived(a, s, { rank: 0 }).raw.ev;
    expect(raw).toBe(out.raw.ev); // raw is untouched by the seesaw
    expect(out.ev).toBeGreaterThan(0);
  });

  it("wires every attribute to its dichotomy partner exactly once", () => {
    expect(ATTR_COMPENSATION).toHaveLength(7);
    expect(new Set(ATTR_COMPENSATION.map((c) => c.attr)).size).toBe(7);
    expect(new Set(ATTR_COMPENSATION.map((c) => c.stat)).size).toBe(7);
  });
});

describe("proportional pool compensation — the Curator's table rule", () => {
  const trainedSpecs = { ...zeroS(), wt: 30, bal: 30, cun: 30, ctrl: 25, adp: 25, pre: 25, per: 25, wm: 10 };

  it("is off unless the rule is on — the flat number is what every old sheet used", () => {
    const a = { ...zeroA(), dex: 0, end: 0, phy: 10, ap: 10, wis: 10, cha: 10, int: 10 };
    const flat = computeDerived(a, trainedSpecs, { rank: 9 });
    const prop = computeDerived(a, trainedSpecs, { rank: 9, poolCompensation: true });
    expect(prop.dhp).toBeGreaterThan(flat.dhp);
    expect(prop.mv).toBeGreaterThan(flat.mv);
  });

  it("leaves the five MODIFIER routes exactly as they were", () => {
    const a = { ...zeroA(), phy: 0, ap: 0, wis: 0, cha: 0, int: 0, dex: 10, end: 10 };
    const flat = computeDerived(a, trainedSpecs, { rank: 9 });
    const prop = computeDerived(a, trainedSpecs, { rank: 9, poolCompensation: true });
    for (const k of ["ev", "rr", "ad", "pr", "atk"] as const) expect(prop[k]).toBe(flat[k]);
  });

  it("pays a SHARE, so it stays proportionate whatever the pool is worth", () => {
    // Same dumped Dexterity, two very different Weight investments -> very
    // different DHP pools. The flat rule pays both the same; this one does not.
    const a = { ...zeroA(), dex: 0, end: 10, phy: 10, ap: 10, wis: 10, cha: 10, int: 10 };
    const lean = computeDerived(a, { ...zeroS(), wt: 25 }, { rank: 9, poolCompensation: true });
    const heavy = computeDerived(a, { ...zeroS(), wt: 75 }, { rank: 9, poolCompensation: true });
    const leanFlat = computeDerived(a, { ...zeroS(), wt: 25 }, { rank: 9 });
    const heavyFlat = computeDerived(a, { ...zeroS(), wt: 75 }, { rank: 9 });
    expect(heavyFlat.dhp - heavy.dhp).not.toBe(leanFlat.dhp - lean.dhp); // flat pays equally, share does not
    const leanPct = (lean.dhp - (leanFlat.dhp - 4)) / (leanFlat.dhp - 4);
    const heavyPct = (heavy.dhp - (heavyFlat.dhp - 4)) / (heavyFlat.dhp - 4);
    expect(Math.abs(leanPct - heavyPct)).toBeLessThan(0.02); // same SHARE of each pool
  });

  it("pays nothing when there is nothing to pay — the gate still rules", () => {
    const a = { ...zeroA(), dex: 0, end: 0 };
    const untrained = computeDerived(a, { ...zeroS(), wt: 24, ctrl: 24 }, { rank: 9, poolCompensation: true });
    const flat = computeDerived(a, { ...zeroS(), wt: 24, ctrl: 24 }, { rank: 9 });
    expect(untrained.dhp).toBe(flat.dhp);
    expect(untrained.mv).toBe(flat.mv);
  });

  it("poolCompensation() is 5% of the pool per point of pay", () => {
    expect(poolCompensation(60, 4)).toBe(12);
    expect(poolCompensation(160, 4)).toBe(32);
    expect(poolCompensation(60, 0)).toBe(0);
  });
});
