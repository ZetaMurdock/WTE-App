import { describe, expect, it } from "vitest";
import { SPECIES, getSpecies, speciesInnate, usableRacial, inceptSeeds } from "./wte";

describe("species catalog (rebuilt from the wiki pages)", () => {
  it("carries all nine species with genetics + eminence", () => {
    expect(SPECIES.map((s) => s.id)).toEqual([
      "hyomen", "voaulton", "mirga", "oriyu", "insectoid", "subdermin", "inderi", "seraph", "stygians",
    ]);
    for (const s of SPECIES) {
      expect(s.innate).toHaveLength(4);
      expect(s.innateSelect).toBe(2); // every species chooses 2 of 4
      expect(s.dom).toBeGreaterThan(0);
      expect(s.eminence).toBeTruthy();
      expect(s.variants.length).toBeGreaterThan(0);
    }
  });

  it("matches the published Dom/Rec + Eminence for the extremes", () => {
    expect(getSpecies("seraph")).toMatchObject({ dom: 45, rec: 5, eminence: "Civilized +40" });
    expect(getSpecies("insectoid")).toMatchObject({ dom: 24, rec: 40, eminence: "Civilized +15" });
    expect(getSpecies("hyomen")).toMatchObject({ dom: 45, rec: 10, eminence: "Civilized +30" });
    expect(getSpecies("stygians")).toMatchObject({ eminence: "Feral +20" });
  });

  it("innate abilities carry their full effect prose from the pages", () => {
    const hyomen = speciesInnate("hyomen");
    expect(hyomen.map((a) => a.name)).toEqual(["Prodigal Mind", "Omen", "Indomitable Will", "Peak Evolution"]);
    expect(hyomen.find((a) => a.name === "Omen")?.effect).toContain("causal thread");
    expect(hyomen.find((a) => a.name === "Peak Evolution")?.effect).toContain("Subjugated");
    const oriyu = speciesInnate("oriyu");
    expect(oriyu.map((a) => a.name)).toEqual(["Vesul Enkludtiu", "Vesul Exovertntiu", "Unravel Spacia", "Dyn Formn"]);
    expect(oriyu[0].effect.length).toBeGreaterThan(50);
  });

  it("the new variants resolve as racial abilities with effects", () => {
    const neo = usableRacial("hyomen", "Neo-Humans");
    expect(neo.some((a) => a.name === "Awakened Visualization")).toBe(true);
    expect(neo.find((a) => a.name === "Genetic Control")?.effect).toContain("Mutation Capacity");
    // The Annunaki head-shape option still grants its extra ability.
    const annun = usableRacial("stygians", "Annunaki", "Elongated Head");
    expect(annun.some((a) => a.name === "Precognition")).toBe(true);
  });

  it("every variant ability has real effect text (no bare-name stubs)", () => {
    for (const s of SPECIES) {
      for (const v of s.variants) {
        for (const a of v.abilities) {
          expect(a.effect.length).toBeGreaterThan(10);
        }
      }
    }
  });

  it("Stygians carry the full page: Dom 20 / Rec 35, four variants, real innate prose", () => {
    expect(getSpecies("stygians")).toMatchObject({ dom: 20, rec: 35, eminence: "Feral +20" });
    const styg = getSpecies("stygians")!;
    expect(styg.variants.map((v) => v.name)).toEqual(["Xeno", "Greys", "Annunaki", "Sbeindlaer"]);
    const innate = speciesInnate("stygians");
    expect(innate.find((a) => a.name === "Interstitial Intrusion")?.effect).toContain("Stinous");
    expect(innate.find((a) => a.name === "Locked in Time")?.effect).toContain("Inspiration");
  });

  it("choose-2-of-4: usableRacial keeps only the chosen innates + variant abilities", () => {
    const chosen = ["Prodigal Mind", "Peak Evolution"];
    const active = usableRacial("hyomen", "Neo-Humans", undefined, chosen);
    const innateNames = active.filter((a) => ["Prodigal Mind", "Omen", "Indomitable Will", "Peak Evolution"].includes(a.name));
    expect(innateNames.map((a) => a.name).sort()).toEqual(["Peak Evolution", "Prodigal Mind"]);
    expect(active.some((a) => a.name === "Omen")).toBe(false); // unselected → not active
    expect(active.some((a) => a.name === "Awakened Visualization")).toBe(true); // variant still granted
    // The 2 unselected are the Incept seeds.
    expect(inceptSeeds("hyomen", chosen).map((a) => a.name).sort()).toEqual(["Indomitable Will", "Omen"]);
  });

  it("no innateChoice = all four active (legacy characters unaffected)", () => {
    const all = usableRacial("hyomen", undefined, undefined, undefined);
    expect(all.filter((a) => a.source === "racial")).toHaveLength(4);
    expect(inceptSeeds("hyomen", undefined)).toEqual([]);
  });
});
