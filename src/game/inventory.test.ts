import { describe, it, expect } from "vitest";
import { normalizeSlots, bodySlotMap, isConsumable } from "./inventory";

describe("normalizeSlots", () => {
  it("maps BOTH_ARMS to both fixed arm slots", () => {
    expect(normalizeSlots("BOTH_ARMS")).toEqual({ fixed: ["R_ARM", "L_ARM"], flexibleArm: false });
  });
  it("treats either-arm phrasings as flexible", () => {
    expect(normalizeSlots("R_ARM or L_ARM").flexibleArm).toBe(true);
    expect(normalizeSlots("R_ARM (or L_ARM)").flexibleArm).toBe(true);
  });
  it("maps single anatomy slots and pools", () => {
    expect(normalizeSlots("HEAD").fixed).toEqual(["HEAD"]);
    expect(normalizeSlots("r_arm").fixed).toEqual(["R_ARM"]); // case-insensitive
    expect(normalizeSlots("UTILITY").pool).toBe("UTILITY");
    expect(normalizeSlots("MODULE").pool).toBe("MODULE");
  });
  it("returns empty for unknown / missing slots", () => {
    expect(normalizeSlots(undefined)).toEqual({ fixed: [], flexibleArm: false });
    expect(normalizeSlots("SOMETHING_ELSE").fixed).toEqual([]);
  });
});

describe("bodySlotMap (against the baked Codex catalog)", () => {
  it("fills both arms with a BOTH_ARMS weapon and pools UTILITY gear", () => {
    const m = bodySlotMap(["Mantis Blades"], ["EMP Field"]);
    expect(m.anatomy.R_ARM.map((o) => o.name)).toContain("Mantis Blades");
    expect(m.anatomy.L_ARM.map((o) => o.name)).toContain("Mantis Blades");
    expect(m.pools.UTILITY.map((o) => o.name)).toContain("EMP Field");
    expect(m.conflicts).toEqual([]);
  });

  it("flags a slot holding 2+ items as a conflict", () => {
    const m = bodySlotMap(["Mantis Blades", "Hypercharge Genus-Modified Railgun"], []);
    expect(m.conflicts).toContain("R_ARM");
    expect(m.conflicts).toContain("L_ARM");
  });

  it("places a flexible-arm weapon on exactly one arm", () => {
    const m = bodySlotMap(["Projectile Launch System (Implant)"], []);
    expect(m.anatomy.R_ARM.length + m.anatomy.L_ARM.length).toBe(1);
  });

  it("routes unknown items to unassigned", () => {
    const m = bodySlotMap(["Not A Real Weapon"], []);
    expect(m.unassigned.map((o) => o.name)).toContain("Not A Real Weapon");
  });
});

describe("isConsumable", () => {
  it("detects consumable categories", () => {
    expect(isConsumable("Consumable")).toBe(true);
    expect(isConsumable("Consumable (Grenade)")).toBe(true);
    expect(isConsumable("Utility")).toBe(false);
    expect(isConsumable(undefined)).toBe(false);
  });
});
