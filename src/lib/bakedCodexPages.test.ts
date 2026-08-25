import { describe, expect, it } from "vitest";
import {
  bakedCodexPages,
  bakedInceptPageContent,
  bakedParadigmPageContent,
  bakedSpeciesPageContent,
  findBakedCodexPage,
} from "./bakedCodexPages";
import { parseInceptPage, parseParadigmPage, parseSpeciesDefinitionPage } from "./gameData";
import { bakedInceptPools, bakedParadigms, bakedSpecies, bakedSpeciesInnate, bakedSpeciesSize } from "../game/wte";

// A built-in page exists so a Curator can fork it. If the generator and the
// parser disagree by even one field, "Customize" hands them a page that quietly
// deletes part of the lineage the moment they save it — which is strictly worse
// than having no page to fork at all. So: every species, every field.
describe("built-in pages round-trip through the page parser", () => {
  for (const species of bakedSpecies()) {
    it(`${species.name} parses back to its compiled record`, () => {
      const md = bakedSpeciesPageContent(species);
      const parsed = parseSpeciesDefinitionPage(md, `species-${species.id}`);
      expect(parsed).not.toBeNull();
      const back = parsed!.species;

      expect(back.id).toBe(species.id);
      expect(back.name).toBe(species.name);
      expect(back.family).toBe(species.family);
      expect(back.bonuses).toEqual(species.bonuses);
      expect(back.innate).toEqual(species.innate);
      expect(back.dom).toBe(species.dom);
      expect(back.rec).toBe(species.rec);
      expect(back.eminence).toBe(species.eminence);
      expect(back.innateSelect).toBe(species.innateSelect);
      expect(back.note).toBe(species.note);
    });

    it(`${species.name} keeps every variant, ability and option`, () => {
      const parsed = parseSpeciesDefinitionPage(
        bakedSpeciesPageContent(species),
        `species-${species.id}`
      )!.species;

      expect(parsed.variants.map((v) => v.name)).toEqual(species.variants.map((v) => v.name));
      for (const [i, variant] of species.variants.entries()) {
        const back = parsed.variants[i];
        expect(back.abilities).toEqual(variant.abilities);
        // Creation-time choices used to be dropped by the parser entirely and
        // reappear glued onto the end of the variant's note.
        expect(back.options ?? []).toEqual(variant.options ?? []);
        if (variant.note) expect(back.note).toBe(variant.note);
      }
    });

    it(`${species.name} carries its innate effect text, not just names`, () => {
      const parsed = parseSpeciesDefinitionPage(
        bakedSpeciesPageContent(species),
        `species-${species.id}`
      )!;
      expect(parsed.provided).toContain("innateAbilities");
      const baked = bakedSpeciesInnate(species.id);
      expect(parsed.species.innateAbilities).toEqual(
        species.innate.map((name) => ({
          name,
          effect: baked.find((a) => a.name.toLowerCase() === name.toLowerCase())?.effect ?? "",
        }))
      );
    });
  }

  for (const paradigm of bakedParadigms()) {
    it(`${paradigm.name} parses back to its compiled record`, () => {
      const back = parseParadigmPage(bakedParadigmPageContent(paradigm), `paradigm-${paradigm.id}`);
      expect(back).toEqual(paradigm);
    });
  }

  it("declares only the fields it actually wrote", () => {
    // Hyomen has no attribute bonuses. The row still has to be present and say
    // "None", or the fork would silently inherit rather than state the rule.
    const hyomen = bakedSpecies().find((s) => s.id === "hyomen")!;
    const md = bakedSpeciesPageContent(hyomen);
    expect(md).toContain("| Bonuses | None |");
    const provided = parseSpeciesDefinitionPage(md, "species-hyomen")!.provided;
    for (const field of ["family", "bonuses", "innate", "note", "dom", "rec", "eminence", "innateSelect", "variants"]) {
      expect(provided).toContain(field);
    }
  });

  it("emits a size row that matches the compiled default", () => {
    for (const species of bakedSpecies()) {
      const size = bakedSpeciesSize(species.id);
      if (!size) continue;
      expect(bakedSpeciesPageContent(species)).toContain(`| Size | ${size} |`);
    }
  });
});

describe("built-in page catalog", () => {
  it("covers every compiled species and paradigm exactly once", () => {
    const pages = bakedCodexPages();
    expect(pages.filter((p) => p.kind === "species").map((p) => p.id)).toEqual(
      bakedSpecies().map((s) => `wte.species.${s.id}`)
    );
    expect(pages.filter((p) => p.kind === "paradigm").map((p) => p.id)).toEqual(
      bakedParadigms().map((p) => `wte.paradigm.${p.id}`)
    );
    expect(new Set(pages.map((p) => p.id)).size).toBe(pages.length);
    expect(new Set(pages.map((p) => p.stem)).size).toBe(pages.length);
  });

  it("is official, visible, flagged built-in and never pulled", () => {
    for (const page of bakedCodexPages()) {
      expect(page.source).toBe("official");
      expect(page.builtIn).toBe(true);
      // Pulling these would re-parse compiled data back over itself; any drift
      // between generator and parser would become a live rules change.
      expect(page.pulled).toBe(false);
      expect(page.visibility).toBe("player");
    }
  });

  it("resolves by id and by stem", () => {
    expect(findBakedCodexPage({ id: "wte.species.stygians" })?.title).toBe("Stygians");
    expect(findBakedCodexPage({ stem: "paradigm-warfare" })?.title).toBe("Warfare");
    expect(findBakedCodexPage({ id: "wte.species.nope" })).toBeUndefined();
    expect(findBakedCodexPage({})).toBeUndefined();
  });

  it("surfaces the variants that had no page at all", () => {
    // The three the Curator reported seeing in character creation with nowhere
    // to edit them. Salaris and Trevant are SubDermin variants; Qerran is Oriyu.
    const text = bakedCodexPages().map((p) => p.content).join("\n");
    for (const name of ["Salaris", "Trevant", "Qerran"]) {
      expect(text).toContain(`### ${name}`);
    }
  });
});

describe("built-in Incept pages", () => {
  const pools = Object.entries(bakedInceptPools());

  it("covers every compiled Incept", () => {
    const pages = bakedCodexPages().filter((p) => p.kind === "incept");
    const total = pools.reduce((n, [, pool]) => n + pool.incepts.length, 0);
    expect(pages).toHaveLength(total);
    expect(new Set(pages.map((p) => p.id)).size).toBe(total);
    expect(new Set(pages.map((p) => p.stem)).size).toBe(total);
  });

  for (const [speciesId, pool] of pools) {
    for (const incept of pool.incepts) {
      it(`${speciesId} · ${incept.name} parses back to its compiled record`, () => {
        const md = bakedInceptPageContent(speciesId, incept);
        const back = parseInceptPage(md, `incept-${speciesId}`);
        expect(back).not.toBeNull();
        expect(back!.speciesId).toBe(speciesId);
        expect(back!.incept.name).toBe(incept.name);
        // Weight drives Synaptic Focus cost AND the Wryde chaos tier, so a
        // round trip that lost it would silently reprice and de-risk the Incept.
        expect(back!.incept.weight).toBe(incept.weight);
        expect(back!.incept.memory).toBe(incept.memory);
        expect(back!.incept.grants ?? []).toEqual(incept.grants ?? []);
      });
    }
  }

  it("keeps the Memory line the Mirga Incepts carry", () => {
    const mirga = bakedInceptPools()["mirga"].incepts.find((i) => i.memory);
    expect(mirga).toBeDefined();
    expect(bakedInceptPageContent("mirga", mirga!)).toContain("| Memory |");
  });

  it("omits the Grants section for an Incept with nothing executable yet", () => {
    const md = bakedInceptPageContent("hyomen", { name: "Prose Only", weight: "Light", effect: "Words." });
    expect(md).not.toContain("## Grants");
    expect(parseInceptPage(md, "x")!.incept.grants).toBeUndefined();
  });

  it("round-trips every grant kind through the page", () => {
    const md = bakedInceptPageContent("hyomen", {
      name: "Full Kit",
      weight: "Heavy",
      effect: "Everything at once.",
      grants: [
        { kind: "advantage", on: { axis: "physical", direction: "check", path: "power" }, target: "self" },
        { kind: "disadvantage", on: { axis: "physical", direction: "save", path: "evasion" }, target: "target" },
        { kind: "damage", expr: "3d10", damageType: "Entropy" },
        { kind: "restore", expr: "1d50", resource: "ss" },
        { kind: "cost", expr: "10", resource: "focus" },
      ],
    });
    const back = parseInceptPage(md, "x")!;
    expect(back.incept.grants).toHaveLength(5);
    expect(back.incept.grants![1]).toEqual({
      kind: "disadvantage", on: { axis: "physical", direction: "save", path: "evasion" }, target: "target",
    });
    expect(back.incept.effect).toBe("Everything at once.");
  });
});
