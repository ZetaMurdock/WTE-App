import { describe, expect, it } from "vitest";
import { SPECIES, getIncept, inceptPool, inceptPoolBlurb, inceptsForSpecies, wrydeTier, wrydeTierFor } from "./wte";
import { INCEPT_FOCUS_COST, focusBudget, unlockIncept, emptySpend } from "./synapticFocus";

describe("incept pools", () => {
  it("every species has a pool, and nothing is orphaned", () => {
    for (const s of SPECIES) {
      expect(inceptsForSpecies(s.id).length, `${s.id} pool`).toBeGreaterThan(0);
      expect(inceptPoolBlurb(s.id), `${s.id} blurb`).not.toBe("");
    }
    expect(SPECIES).toHaveLength(9);
  });

  it("holds all 62 incepts with the counts the source has", () => {
    const counts = Object.fromEntries(SPECIES.map((s) => [s.id, inceptsForSpecies(s.id).length]));
    expect(counts).toEqual({
      hyomen: 11, voaulton: 6, mirga: 7, oriyu: 5, insectoid: 5,
      subdermin: 6, inderi: 10, seraph: 6, stygians: 6,
    });
    expect(SPECIES.reduce((t, s) => t + inceptsForSpecies(s.id).length, 0)).toBe(62);
  });

  it("every incept is well-formed", () => {
    for (const sp of SPECIES) {
      for (const i of inceptsForSpecies(sp.id)) {
        expect(i.name.trim(), `${sp.id} name`).not.toBe("");
        expect(["Light", "Medium", "Heavy"], `${i.name} weight`).toContain(i.weight);
        expect(i.effect.length, `${i.name} effect`).toBeGreaterThan(20);
      }
    }
  });

  it("no longer carries Dominance / Recessiveness — retired from the model", () => {
    for (const sp of SPECIES) {
      for (const i of inceptsForSpecies(sp.id)) {
        expect(Object.keys(i).sort()).toEqual(i.memory ? ["effect", "memory", "name", "weight"] : ["effect", "name", "weight"]);
      }
    }
  });

  it("names are unique inside each pool", () => {
    for (const s of SPECIES) {
      const names = inceptsForSpecies(s.id).map((i) => i.name.toLowerCase());
      expect(new Set(names).size, `${s.id} duplicates`).toBe(names.length);
    }
  });

  it("only Mirga incepts carry a Memory line — all seven of them", () => {
    for (const s of SPECIES) {
      const withMemory = inceptsForSpecies(s.id).filter((i) => i.memory);
      expect(withMemory.length, `${s.id} memory`).toBe(s.id === "mirga" ? 7 : 0);
    }
  });

  it("spot-checks the author's Weight Classes", () => {
    expect(getIncept("seraph", "Seraphic Mandate")!.weight).toBe("Heavy");
    expect(getIncept("seraph", "Spatial Anchor")!.weight).toBe("Light");
    expect(getIncept("stygians", "Shadow Hive Link")!.weight).toBe("Heavy");
    expect(getIncept("insectoid", "Swarm Anatomy")!.weight).toBe("Heavy");
  });

  it("reads as corrected prose — the typos were intentionally cleaned up", () => {
    expect(getIncept("hyomen", "Imperfect Resistance")!.effect).not.toContain("a a Decimal");
    expect(getIncept("hyomen", "Weapon Specialist")!.effect).not.toContain("damage .");
    expect(getIncept("stygians", "Shadow Fracture")!.effect).toContain("creature's shadow");
  });

  it("preserves the three Synaptic Focus cross-references", () => {
    expect(getIncept("subdermin", "Earth Mold")!.effect).toContain("For every two SF levels");
    expect(getIncept("mirga", "Identity Theft")!.effect).toContain("SF 4 for reflect");
    expect(getIncept("hyomen", "Talent Holder")!.effect).toContain("extra SF point whenever you rank up");
  });

  it("is case-insensitive on lookup and safe on nonsense", () => {
    expect(getIncept("seraph", "spatial anchor")?.name).toBe("Spatial Anchor");
    expect(getIncept("seraph", "Nope")).toBeUndefined();
    expect(inceptsForSpecies("not-a-species")).toEqual([]);
    expect(inceptsForSpecies(undefined)).toEqual([]);
  });
});

describe("the unlockable pool", () => {
  it("is the species list plus the two innates you declined", () => {
    const named = inceptsForSpecies("seraph").map((i) => i.name);
    const withSeeds = inceptPool("seraph", ["Spatial Rupture"]);
    expect(withSeeds.length).toBeGreaterThanOrEqual(named.length);
    for (const n of named) expect(withSeeds).toContain(n);
  });

  it("never lists the same name twice", () => {
    const pool = inceptPool("stygians", ["Shadowing Aura"]);
    expect(new Set(pool.map((n) => n.toLowerCase())).size).toBe(pool.length);
  });
});

describe("incepts against the Focus budget", () => {
  it("a rank-0 character can afford exactly one incept and nothing else", () => {
    expect(focusBudget(0)).toBe(INCEPT_FOCUS_COST);
    const s = unlockIncept(emptySpend(), "Spatial Anchor", 0);
    expect(s.incepts).toEqual(["Spatial Anchor"]);
    // Budget is now spent — a second is refused.
    expect(unlockIncept(s, "Reality Fold", 0)).toBe(s);
  });

  it("a rank-9 Seraph could unlock their entire six-incept pool with points to spare", () => {
    const pool = inceptsForSpecies("seraph");
    let s = emptySpend();
    for (const i of pool) s = unlockIncept(s, i.name, 9);
    expect(s.incepts).toHaveLength(6);
    expect(focusBudget(9) - 6 * INCEPT_FOCUS_COST).toBe(12); // 12 left for genus
  });

  it("Hyomen's eleven cost more than the rank-9 budget allows", () => {
    const pool = inceptsForSpecies("hyomen");
    expect(pool.length * INCEPT_FOCUS_COST).toBeGreaterThan(focusBudget(9));
    let s = emptySpend();
    for (const i of pool) s = unlockIncept(s, i.name, 9);
    expect(s.incepts.length).toBe(10); // 30 budget / 3 = 10, the eleventh is refused
  });
});

describe("Wryde tiers — Weight Class sets how chaotic the mutation is", () => {
  it("scales Light -> Medium -> Heavy", () => {
    expect(wrydeTier("Light").tier).toBe(1);
    expect(wrydeTier("Medium").tier).toBe(2);
    expect(wrydeTier("Heavy").tier).toBe(3);
    expect(wrydeTier("Heavy").label).toBe("Chaotic");
  });

  it("falls back to the calmest tier on junk rather than throwing", () => {
    expect(wrydeTier(undefined).tier).toBe(1);
    expect(wrydeTier("nonsense").tier).toBe(1);
  });

  it("a character's Wryde tier is set by their HEAVIEST unlocked incept", () => {
    // Spatial Anchor is Light; Seraphic Mandate is Heavy.
    expect(wrydeTierFor("seraph", ["Spatial Anchor"]).tier).toBe(1);
    expect(wrydeTierFor("seraph", ["Spatial Anchor", "Antimatter Resonance"]).tier).toBe(2);
    expect(wrydeTierFor("seraph", ["Spatial Anchor", "Seraphic Mandate"]).tier).toBe(3);
  });

  it("an unlocked-nothing character sits at the calmest tier", () => {
    expect(wrydeTierFor("seraph", []).tier).toBe(1);
    expect(wrydeTierFor("seraph", ["Not A Real Incept"]).tier).toBe(1);
  });
});
