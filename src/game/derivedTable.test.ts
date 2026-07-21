import { describe, expect, it } from "vitest";
import { ATTR_KEYS, SPEC_KEYS, computeDerived, effectiveSpecialties, parseEquipMods, type Attributes, type Specialties } from "./wte";

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

  it("Control feeds Movement, Synaptic Space and Action Density", () => {
    const ctrl = computeDerived(zeroA(), { ...zeroS(), ctrl: 30 }, {}).raw;
    const base = computeDerived(zeroA(), zeroS(), {}).raw;
    expect(ctrl.mv).toBeGreaterThan(base.mv);
    expect(ctrl.ss).toBeGreaterThan(base.ss);
    expect(ctrl.ad).toBeGreaterThan(base.ad);
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

  it("equipment/module specialty bonuses raise the effective value AND flow into derived", () => {
    // A module written "Weight +9, Control +3" parses into specialty mods…
    const mods = parseEquipMods("Weight +9, Control +3");
    expect(mods.spec).toMatchObject({ wt: 9, ctrl: 3 });
    // …which raise the shown effective specialty value…
    expect(effectiveSpecialties(zeroS(), mods.spec).wt).toBe(9);
    // …and land in the derived formulas exactly like trained points would.
    const base = computeDerived(zeroA(), zeroS(), {}).raw;
    const modded = computeDerived(zeroA(), zeroS(), { equip: mods }).raw;
    const trained = computeDerived(zeroA(), { ...zeroS(), wt: 9, ctrl: 3 }, {}).raw;
    expect(modded).toEqual(trained); // gear points ≡ trained points
    expect(modded.atk).toBeGreaterThan(base.atk); // Weight feeds Attack Power
    expect(modded.dhp).toBeGreaterThan(base.dhp); // and DHP
    expect(modded.ev).toBeLessThan(base.ev); // and drags Evasion (−1 per 3)
  });

  it("each attribute drags its opposite derived stat (the dichotomy web)", () => {
    const base = computeDerived(zeroA(), zeroS(), {}).raw;
    // A single attribute at 30 → −10 to exactly its opposite, nothing it feeds.
    const drag = (attr: string): Partial<Record<keyof typeof base, number>> => {
      const r = computeDerived({ ...zeroA(), [attr]: 30 }, zeroS(), {}).raw;
      const out: Record<string, number> = {};
      for (const k of Object.keys(base) as (keyof typeof base)[]) out[k] = r[k] - base[k];
      return out;
    };
    expect(drag("int").atk).toBe(-10); // Intelligence → Attack Power
    expect(drag("dex").dhp).toBe(-10); // Dexterity → DHP
    expect(drag("end").mv).toBeLessThan(0); // Endurance → Movement (END also FEEDS dhp/rr, so those rise)
    expect(drag("phy").ev).toBe(-10); // Strength → Evasion
    expect(drag("ap").rr).toBeLessThan(0); // Action Priority → Recovery Rate
    expect(drag("wis").ad).toBe(-10); // Wisdom → Action Density
    expect(drag("cha").pr).toBe(-10); // Charisma → Perception Range
  });

  it("no attribute reduces a derived stat it also feeds", () => {
    const base = computeDerived(zeroA(), zeroS(), {}).raw;
    // Strength feeds ATK and drags EV — ATK must not fall when STR rises.
    const str = computeDerived({ ...zeroA(), phy: 30 }, zeroS(), {}).raw;
    expect(str.atk).toBeGreaterThan(base.atk);
    expect(str.ev).toBeLessThan(base.ev);
  });

  it("every reduction runs at −1 per 3 points", () => {
    // DHP with 30 Balance loses exactly 10 off the unreduced value.
    const a = { ...zeroA(), end: 20 };
    const s = { ...zeroS(), wt: 25 };
    const clean = computeDerived(a, s, {}).raw.dhp;
    expect(computeDerived(a, { ...s, bal: 30 }, {}).raw.dhp).toBe(clean - 10);
  });
});
