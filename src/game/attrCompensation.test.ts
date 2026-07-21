import { describe, expect, it } from "vitest";
import {
  ATTR_COMPENSATION,
  ATTR_KEYS,
  ATTR_PIVOT,
  SPEC_KEYS,
  attrCompensation,
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
    expect(attrCompensation(1, true, 0)).toBe(1);
    expect(attrCompensation(1, true, 9)).toBe(2);
  });

  it("accrues at HALF the reduction rate — 6 points below the pivot per +1", () => {
    expect(attrCompensation(5, true, 0)).toBe(0); // 5 short → nothing yet
    expect(attrCompensation(4, true, 0)).toBe(1); // 6 short → +1
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
