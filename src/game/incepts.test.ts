import { describe, expect, it } from "vitest";
import { SPECIES, getIncept, inceptPool, inceptPoolBlurb, inceptsForSpecies, wrydeTier, wrydeTierFor, WRYDE_MUTATIONS, WRYDE_TABLE_PCT, WRYDE_WEIGHT_ROLLS, wrydeAt, rollWryde } from "./wte";
import { INCEPT_FOCUS_COST, GENUS_FOCUS_MAX, focusBudget, focusSpent, focusRemaining, inceptCost, costOfIncept, unlockIncept, emptySpend } from "./synapticFocus";

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
    // Guards the retirement, not the shape. Asserting a CLOSED key set made this
    // fail the moment Incepts gained Roll Axis grants, which is a legitimate
    // addition — so it now names what may appear and rejects everything else.
    const allowed = new Set(["name", "weight", "effect", "memory", "grants"]);
    for (const sp of SPECIES) {
      for (const i of inceptsForSpecies(sp.id)) {
        for (const key of Object.keys(i)) {
          expect(allowed, `${i.name} carries unexpected "${key}"`).toContain(key);
        }
        expect(i).not.toHaveProperty("dom");
        expect(i).not.toHaveProperty("rec");
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

  it("prices an incept by its Weight Class", () => {
    expect(inceptCost("Light")).toBe(3);
    expect(inceptCost("Medium")).toBe(3);
    expect(inceptCost("Heavy")).toBe(5);
    expect(inceptCost(undefined)).toBe(INCEPT_FOCUS_COST); // unknown bills at baseline
    // Looked up from the data, so a sheet can never disagree with the rules.
    expect(costOfIncept("Seraphic Mandate", "seraph")).toBe(5); // Heavy
    expect(costOfIncept("Spatial Anchor", "seraph")).toBe(3); // Light
  });

  it("a rank-9 Seraph can still take their whole pool — the two Heavies bite", () => {
    const pool = inceptsForSpecies("seraph");
    let s = emptySpend();
    for (const i of pool) s = unlockIncept(s, i.name, 9, "seraph");
    expect(s.incepts).toHaveLength(6);
    // 2 Light + 2 Medium + 2 Heavy = 3+3+3+3+5+5 = 22, not the old flat 18.
    expect(focusSpent(s, "seraph")).toBe(22);
    expect(focusRemaining(9, s, "seraph")).toBe(8); // 8 left for genus, was 12
  });

  it("Heavy incepts cost more than maxing a genus outright", () => {
    expect(costOfIncept("Seraphic Mandate", "seraph")).toBeGreaterThan(GENUS_FOCUS_MAX);
  });

  it("a rank-0 character cannot afford a Heavy incept at all", () => {
    expect(focusBudget(0)).toBe(3);
    const s = unlockIncept(emptySpend(), "Seraphic Mandate", 0, "seraph");
    expect(s.incepts).toEqual([]); // needs 5, has 3
    // ...but a Light one is exactly affordable.
    expect(unlockIncept(emptySpend(), "Spatial Anchor", 0, "seraph").incepts).toEqual(["Spatial Anchor"]);
  });

  it("Hyomen's eleven still overrun the budget — all Light and Medium, no Heavies", () => {
    const pool = inceptsForSpecies("hyomen");
    expect(pool.every((i) => i.weight !== "Heavy")).toBe(true);
    let s = emptySpend();
    for (const i of pool) s = unlockIncept(s, i.name, 9, "hyomen");
    expect(s.incepts.length).toBe(10); // 33 needed, 30 available
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

describe("the Wryde Mutation Table", () => {
  it("carries the seven published types with their exact percentages", () => {
    expect(WRYDE_MUTATIONS.map((m) => [m.name, m.pct])).toEqual([
      ["Stagnant", 40], ["Radioactive", 15], ["Growth", 20], ["Mental Fog", 10],
      ["Harder Anatomy", 5], ["Sentient", 3], ["Corrupt", 7],
    ]);
  });

  it("totals exactly 100 — the original 5-point gap was folded into Corrupt", () => {
    expect(WRYDE_TABLE_PCT).toBe(100);
    expect(WRYDE_MUTATIONS.find((m) => m.name === "Corrupt")!.pct).toBe(7);
  });

  it("maps rolls to the right band", () => {
    expect(wrydeAt(1).name).toBe("Stagnant");
    expect(wrydeAt(40).name).toBe("Stagnant");
    expect(wrydeAt(41).name).toBe("Radioactive");
    expect(wrydeAt(55).name).toBe("Radioactive");
    expect(wrydeAt(56).name).toBe("Growth");
    expect(wrydeAt(75).name).toBe("Growth");
    expect(wrydeAt(85).name).toBe("Mental Fog");
    expect(wrydeAt(90).name).toBe("Harder Anatomy");
    expect(wrydeAt(93).name).toBe("Sentient");
    expect(wrydeAt(94).name).toBe("Corrupt");
    expect(wrydeAt(100).name).toBe("Corrupt");
  });

  it("rolls once for Light, twice for Medium, three times for Heavy", () => {
    expect(WRYDE_WEIGHT_ROLLS).toEqual({ Light: 1, Medium: 2, Heavy: 3 });
  });

  it("keeps the MOST chaotic of the rolls", () => {
    // 1 = Stagnant, 94 = Corrupt. Order of the rolls must not matter.
    expect(rollWryde("Heavy", [1, 94, 1]).name).toBe("Corrupt");
    expect(rollWryde("Heavy", [94, 1, 1]).name).toBe("Corrupt");
    expect(rollWryde("Medium", [1, 60]).name).toBe("Growth");
    expect(rollWryde("Light", [1]).name).toBe("Stagnant");
  });

  it("clamps a nonsense roll instead of falling off the table", () => {
    expect(rollWryde("Light", [0]).name).toBe("Stagnant");
    expect(rollWryde("Light", [999]).name).toBe("Corrupt");
    expect(rollWryde("not-a-weight", [50]).name).toBe("Radioactive");
  });

  it("escalates with weight — a Heavy incept rarely sits cosmetic", () => {
    const share = (w: string) => {
      let stagnant = 0;
      for (let i = 0; i < 4000; i++) if (rollWryde(w).name === "Stagnant") stagnant++;
      return stagnant / 4000;
    };
    const light = share("Light");
    const heavy = share("Heavy");
    expect(light).toBeGreaterThan(0.33); // ~40%
    expect(heavy).toBeLessThan(0.12); // ~6.4%
    expect(heavy).toBeLessThan(light);
  });
});
