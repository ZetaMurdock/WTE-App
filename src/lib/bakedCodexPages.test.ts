import { describe, expect, it } from "vitest";
import {
  bakedCipherPageContent,
  bakedCodexPages,
  bakedGenusPageContent,
  bakedInceptPageContent,
  bakedParadigmPageContent,
  bakedSpeciesPageContent,
  findBakedCodexPage,
} from "./bakedCodexPages";
import { parseCodexEntry, splitCipherEffect } from "./codexParse";
import { parseInceptPage, parseParadigmPage, parseSpeciesDefinitionPage } from "./gameData";
import {
  bakedCiphers,
  bakedInceptPools,
  bakedParadigms,
  bakedSpecies,
  bakedSpeciesInnate,
  bakedSpeciesSize,
  GENUS_DOMAIN_NAMES,
  getGenusDomain,
} from "../game/wte";
import { slugify } from "../game/codexId";

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
      // A declared `## Actions` block rides with the effect: the page is the
      // only copy a forked campaign gets, so an innate that loses its steps here
      // loses them for that table permanently.
      expect(parsed.species.innateAbilities).toEqual(
        species.innate.map((name) => {
          const from = baked.find((a) => a.name.toLowerCase() === name.toLowerCase());
          return { name, effect: from?.effect ?? "", actions: from?.actions };
        })
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

// Genus and Cipher pages fork into ordinary campaign ability pages, so the
// parser that reads THOSE is parseCodexEntry — the round-trip that matters is
// baked page → entry, field for field, effect byte for byte. A cipher's
// "Rank: … · Component: …" header is split into rows on emission and
// reassembled on parse, so effect equality here proves that seam too.
describe("built-in ability pages round-trip through parseCodexEntry", () => {
  for (const domain of GENUS_DOMAIN_NAMES) {
    it(`${domain} Genus abilities parse back to their compiled records`, () => {
      for (const ability of getGenusDomain(domain)!.abilities) {
        const entry = parseCodexEntry(bakedGenusPageContent(ability, domain), `genus-${slugify(ability.name)}`);
        expect(entry, ability.name).toMatchObject({ type: "genus", name: ability.name, domain });
        if (entry?.type !== "genus") continue;
        expect(entry.id, `${ability.name} id`).toBe(ability.id);
        expect(entry.ss ?? null, `${ability.name} ss`).toBe(ability.ss ?? null);
        expect(entry.effect ?? null, `${ability.name} effect`).toBe(ability.effect ?? null);
        expect(entry.activation ?? null, `${ability.name} activation`).toBe(ability.activation ?? null);
        expect(entry.range ?? null, `${ability.name} range`).toBe(ability.range ?? null);
        expect(entry.target ?? null, `${ability.name} target`).toBe(ability.target ?? null);
        expect(entry.limit ?? null, `${ability.name} limit`).toBe(ability.limit ?? null);
        expect(entry.classification ?? null, `${ability.name} classification`).toBe(ability.classification ?? null);
      }
    });
  }

  for (const [paradigmId, ciphers] of Object.entries(bakedCiphers())) {
    it(`${paradigmId} ciphers parse back to their compiled records`, () => {
      for (const cipher of ciphers) {
        const entry = parseCodexEntry(bakedCipherPageContent(cipher, paradigmId), `cipher-${slugify(cipher.name)}`);
        expect(entry, cipher.name).toMatchObject({ type: "cipher", name: cipher.name, paradigm: paradigmId });
        if (entry?.type !== "cipher") continue;
        expect(entry.id, `${cipher.name} id`).toBe(`wte.cipher.${slugify(cipher.name)}`);
        expect(entry.tier ?? null, `${cipher.name} tier`).toBe(cipher.tier ?? null);
        expect(entry.ss ?? null, `${cipher.name} ss`).toBe(cipher.ss ?? null);
        expect(entry.activation ?? null, `${cipher.name} activation`).toBe(cipher.type ?? null);
        // The header travels as Rank/Component rows; the effect keeps the body.
        // gameData recomposes them — asserted byte-for-byte piecewise here and
        // end-to-end by the campaignCodex fork tests.
        const split = cipher.effect ? splitCipherEffect(cipher.effect) : null;
        expect(entry.effect ?? null, `${cipher.name} effect body`).toBe(split ? split.body : cipher.effect ?? null);
        expect(entry.rank ?? null, `${cipher.name} rank`).toBe(split?.rank ?? null);
        expect(entry.component ?? null, `${cipher.name} component`).toBe(split?.component ?? null);
        if (split) {
          expect(`Rank: ${split.rank} · Component: ${split.component} ${split.body}`, `${cipher.name} recompose`).toBe(cipher.effect);
        }
      }
    });
  }
});

// Stamping permanent ids into ciphers.json is a data change to files these
// pages are generated FROM. If the stamped value differed from what the
// generator used to derive on the fly, all 148 cipher pages would come out
// different — and a campaign's revision hash would move for every table that
// changed nothing. Generating each page from a stripped copy is the direct
// statement of that invariant.
describe("stamped ids leave the built-in pages exactly as they were", () => {
  function unstamped<T extends { id?: string }>(value: T): T {
    const copy = { ...value };
    delete copy.id;
    return copy;
  }

  it("emits the same cipher page with and without the stamp", () => {
    for (const [paradigmId, ciphers] of Object.entries(bakedCiphers())) {
      for (const cipher of ciphers) {
        expect(cipher.id, cipher.name).toBeTruthy();
        expect(bakedCipherPageContent(cipher, paradigmId), cipher.name).toBe(
          bakedCipherPageContent(unstamped(cipher), paradigmId)
        );
      }
    }
  });

  it("emits the same catalog entry — id, stem, title and content", () => {
    const pages = bakedCodexPages().filter((p) => p.kind === "cipher");
    const byId = new Map(pages.map((p) => [p.id, p]));
    for (const [paradigmId, ciphers] of Object.entries(bakedCiphers())) {
      for (const cipher of ciphers) {
        const page = byId.get(`wte.cipher.${slugify(cipher.name)}`);
        expect(page, cipher.name).toBeDefined();
        expect(page!.stem).toBe(`cipher-${slugify(cipher.name)}`);
        expect(page!.title).toBe(cipher.name);
        expect(page!.content).toBe(bakedCipherPageContent(unstamped(cipher), paradigmId));
      }
    }
  });

  // The innate ids ride in speciesInnate.json, which the Species pages read for
  // effect prose only. A stamp leaking into that emission would rewrite nine
  // more pages.
  it("keeps the innate bullets free of the stamp", () => {
    for (const species of bakedSpecies()) {
      const md = bakedSpeciesPageContent(species);
      expect(md, species.name).not.toContain("wte.innate.");
      for (const innate of bakedSpeciesInnate(species.id)) {
        expect(innate.id, `${species.id}/${innate.name}`).toBeTruthy();
      }
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
    expect(pages.filter((p) => p.kind === "genus")).toHaveLength(
      GENUS_DOMAIN_NAMES.reduce((n, d) => n + (getGenusDomain(d)?.abilities.length ?? 0), 0)
    );
    expect(pages.filter((p) => p.kind === "cipher")).toHaveLength(
      Object.values(bakedCiphers()).reduce((n, list) => n + list.length, 0)
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
