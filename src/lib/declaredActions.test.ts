import { afterEach, describe, expect, it } from "vitest";
import {
  bakedCipherPageContent,
  bakedGenusPageContent,
  bakedInceptPageContent,
  bakedSpeciesPageContent,
} from "./bakedCodexPages";
import { parseCodexEntry } from "./codexParse";
import { parseInceptPage, parseSpeciesDefinitionPage } from "./gameData";
import { parseAbilityActions } from "../game/abilityActions";
import { effectLine, parseAbilityEffects } from "../game/abilityEffects";
import {
  bakedCiphers,
  bakedInceptPools,
  bakedSpecies,
  GENUS_DOMAIN_NAMES,
  getGenusDomain,
  getSpecies,
  registerCodexGameData,
  speciesInnate,
  usableCiphers,
  usableRacial,
  type CipherAbility,
  type GenusAbility,
  type Incept,
} from "../game/wte";

// The page a Curator would write. Every line is a shape abilityEffects declares,
// so a grammar change that stopped reading one of them fails HERE rather than
// silently carrying an unreadable block through five catalogs.
const BLOCK = [
  "- Cost: 6 SS",
  "- Save (target): Physical Save — Recovery, DV 18",
  "- Fail: Damage: 3d10 Cold, half on success",
  "- Fail: Condition: Slowed, 2 rounds",
  "- Ruling: brittle objects shatter — Curator adjudicates",
].join("\n");

const EFFECT = "The air freezes solid around the target and holds it there.";

const genusPage = (actions?: string): string =>
  bakedGenusPageContent(
    { name: "Cryo Lock", id: "wte.genus.cryo-lock", ss: 6, effect: EFFECT, actions } as GenusAbility,
    "Elemental"
  );

const cipherPage = (actions?: string): string =>
  bakedCipherPageContent(
    { name: "CRYO LOCK", id: "wte.cipher.cryo-lock", ss: 6, tier: "online", effect: EFFECT, actions } as CipherAbility,
    "science"
  );

const inceptPage = (actions?: string): string =>
  bakedInceptPageContent("hyomen", { name: "Frozen Blood", weight: "Medium", effect: EFFECT, actions } as Incept);

/** parseCodexEntry answers with the whole CodexEntry union, and a Creature page
 *  carries neither an effect nor a block. Narrow once here so each test reads
 *  the two fields it is actually about. */
function abilityEntry(md: string, stem: string) {
  const entry = parseCodexEntry(md, stem);
  if (!entry || entry.type === "creature") throw new Error(`not an ability page: ${stem}`);
  return entry;
}

describe("the `## Actions` grammar this data path carries", () => {
  it("is read whole by the parser the consumers use", () => {
    const effects = parseAbilityEffects(BLOCK);
    expect(effects.errors).toEqual([]);
    expect(effects.steps.map((s) => s.verb)).toEqual(["cost", "save", "damage", "condition", "ruling"]);
  });
});

describe("a declared block reaches the catalogs intact", () => {
  it("rides a Genus page without touching its effect prose", () => {
    const entry = abilityEntry(genusPage(BLOCK), "genus-cryo-lock");
    expect(entry.type).toBe("genus");
    expect(entry.actions).toBe(BLOCK);
    // The bug this section exists to prevent: canonSection returning null for an
    // unrecognised heading left `cur` on the previous section, so every step
    // bullet appended to the effect text of the ability above it.
    expect(entry.effect).toBe(EFFECT);
  });

  it("arms no phantom prose action", () => {
    // parseAbilityActions reads EFFECT prose. Steps that leaked into it would
    // become roll buttons nobody authored — the same block, counted twice.
    const declared = abilityEntry(genusPage(BLOCK), "genus-cryo-lock");
    const proseOnly = abilityEntry(genusPage(), "genus-cryo-lock");
    expect(parseAbilityActions(declared.effect)).toEqual(parseAbilityActions(proseOnly.effect));
  });

  it("is opened by a heading and never by a sentence that starts with the word", () => {
    // "Actions:" is ordinary English, and the other section names are legal
    // inline (`Effect: …`). Letting this one open a section inline swept every
    // line after it out of `effect` — on a page declaring no steps at all, which
    // is most of the corpus and every page a table wrote before Phase 1.
    const prose = "Actions: spend the Focus, then move. The residue lingers.";
    const entry = abilityEntry(genusPage().replace(EFFECT, `${EFFECT}\n${prose}`), "genus-cryo-lock");
    expect(entry.actions).toBeUndefined();
    expect(entry.effect).toBe(`${EFFECT}\n${prose}`);
  });

  it("rides a Cipher page beside the Rank/Component header", () => {
    const entry = abilityEntry(cipherPage(BLOCK), "cipher-cryo-lock");
    expect(entry.type).toBe("cipher");
    expect(entry.actions).toBe(BLOCK);
    expect(entry.effect).toBe(EFFECT);
  });

  it("rides an Incept page beside its Grants", () => {
    const back = parseInceptPage(inceptPage(BLOCK), "incept-hyomen-frozen-blood");
    expect(back!.incept.actions).toBe(BLOCK);
    expect(back!.incept.effect).toBe(EFFECT);
  });

  it("rides a species page per ability, since one page carries them all", () => {
    const species = bakedSpecies().find((s) => s.id === "hyomen")!;
    const authored = {
      ...species,
      innateAbilities: undefined,
      variants: [
        {
          name: "Frostborn",
          note: "A lineage of the deep cold.",
          abilities: [{ name: "Cryo Lock", effect: EFFECT, actions: BLOCK }],
          options: [{ label: "Rimed", ability: { name: "Rime Skin", effect: "Frost sheathes you.", actions: "- Cost: 2 SS" } }],
        },
      ],
    };
    // The innate list is emitted from `innate` names plus the wiki export, so a
    // declared block on an innate has to be authored onto the parsed record.
    const md = bakedSpeciesPageContent(authored).replace(
      "- **Prodigal Mind** —",
      "- **Frozen Blood** — Your blood runs cold.\n  - Cost: 6 SS\n  - Fail: Condition: Slowed, 2 rounds\n- **Prodigal Mind** —"
    );
    const back = parseSpeciesDefinitionPage(md, "species-hyomen")!.species;

    const innate = back.innateAbilities!.find((a) => a.name === "Frozen Blood")!;
    expect(innate.actions).toBe("- Cost: 6 SS\n- Fail: Condition: Slowed, 2 rounds");
    expect(innate.effect).toBe("Your blood runs cold.");
    // A nested bullet must not be swallowed by the variant NOTE, which is where
    // every unrecognised line under a variant used to end up.
    const variant = back.variants.find((v) => v.name === "Frostborn")!;
    expect(variant.abilities[0].actions).toBe(BLOCK);
    expect(variant.note).toBe("A lineage of the deep cold.");
    expect(variant.options![0].ability.actions).toBe("- Cost: 2 SS");
  });
});

describe("a declared block reaches the sheet and the VTT", () => {
  afterEach(() => registerCodexGameData({}));

  it("travels with an innate through the registry onto UsableAbility", () => {
    const definition = parseSpeciesDefinitionPage(
      `# Hyomen

| Type | Species |
| ID | campaign.table.species.hyomen |
| Overrides | wte.species.hyomen |
| Name | Hyomen |

## Innate
- **Frozen Blood** — Your blood runs cold.
  - Cost: 6 SS
  - Fail: Condition: Slowed, 2 rounds
`,
      "species-hyomen"
    )!;
    registerCodexGameData({ species: [definition] });

    expect(getSpecies("hyomen")!.innateAbilities![0].actions).toBe(
      "- Cost: 6 SS\n- Fail: Condition: Slowed, 2 rounds"
    );
    expect(speciesInnate("hyomen")[0].actions).toBeTruthy();
    expect(usableRacial("hyomen")[0].actions).toBe("- Cost: 6 SS\n- Fail: Condition: Slowed, 2 rounds");
  });

  it("travels with a cipher onto UsableAbility", () => {
    const [paradigmId, ciphers] = Object.entries(bakedCiphers())[0];
    const official = ciphers[0];
    registerCodexGameData({ ciphers: { [paradigmId]: [{ ...official, actions: BLOCK }] } });
    expect(usableCiphers(paradigmId, [official.name])[0].actions).toBe(BLOCK);
  });
});

// The governing rule, both halves of it.
//
// An ability that declares nothing must be byte-for-byte what it was before
// Phase 1 existed — that is most of the corpus, and those tables are playing by
// rules this feature must not have touched. An ability that DOES declare a block
// is held to the opposite standard: legal by construction, re-emittable without
// loss, and never bought at the cost of the prose beside it.

/** One built-in ability, the page it bakes to, and the page the SAME record
 *  bakes to with its block stripped. The pair is what makes "the field is inert
 *  when absent" and "the field adds only its own section" checkable. */
interface Baked {
  label: string;
  actions?: string | null;
  effect?: string | null;
  page: string;
  blank: string;
  /** How to read the page back — the three catalogs use two different parsers. */
  read: (md: string) => { effect?: string | null; actions?: string };
}

function builtInAbilityPages(): Baked[] {
  const out: Baked[] = [];
  for (const domain of GENUS_DOMAIN_NAMES) {
    for (const ability of getGenusDomain(domain)?.abilities ?? []) {
      out.push({
        label: `${domain} · ${ability.name}`,
        actions: ability.actions,
        effect: ability.effect,
        page: bakedGenusPageContent(ability, domain),
        blank: bakedGenusPageContent({ ...ability, actions: undefined }, domain),
        read: (md) => abilityEntry(md, "genus-x"),
      });
    }
  }
  for (const [paradigmId, ciphers] of Object.entries(bakedCiphers())) {
    for (const cipher of ciphers) {
      out.push({
        label: `${paradigmId} · ${cipher.name}`,
        actions: cipher.actions,
        effect: cipher.effect,
        page: bakedCipherPageContent(cipher, paradigmId),
        blank: bakedCipherPageContent({ ...cipher, actions: undefined }, paradigmId),
        read: (md) => abilityEntry(md, "cipher-x"),
      });
    }
  }
  for (const [speciesId, pool] of Object.entries(bakedInceptPools())) {
    for (const incept of pool.incepts) {
      out.push({
        label: `${speciesId} · ${incept.name}`,
        actions: incept.actions,
        effect: incept.effect,
        page: bakedInceptPageContent(speciesId, incept),
        blank: bakedInceptPageContent(speciesId, { ...incept, actions: undefined }),
        read: (md) => parseInceptPage(md, "incept-x")!.incept,
      });
    }
  }
  return out;
}

describe("an ability that declares nothing is untouched", () => {
  it("carries no Actions section and bakes exactly as a record with no field would", () => {
    for (const ability of builtInAbilityPages()) {
      if (ability.actions) continue;
      expect(ability.page, ability.label).not.toContain("## Actions");
      expect(ability.page, ability.label).toBe(ability.blank);
    }
  });

  it("emits the same page whether the field is absent, empty or null", () => {
    // The realistic bug is not a missing branch, it is an EMPTY one: a parsed
    // section of "" or a null column emitting a bare heading that then reads
    // back as an ability which declares no steps at all.
    for (const blank of [undefined, null, "", "\n  \n"]) {
      expect(genusPage(blank as undefined)).toBe(genusPage());
      expect(cipherPage(blank as undefined)).toBe(cipherPage());
      expect(inceptPage(blank as undefined)).toBe(inceptPage());
    }
  });

  it("parses back with no block rather than an empty one", () => {
    expect(abilityEntry(genusPage(), "genus-cryo-lock").actions).toBeUndefined();
    expect(abilityEntry(cipherPage(), "cipher-cryo-lock").actions).toBeUndefined();
    expect(parseInceptPage(inceptPage(), "incept-x")!.incept.actions).toBeUndefined();
    // A heading with nothing under it declares nothing, and must be
    // indistinguishable from a page that never carried one.
    expect(abilityEntry(`${genusPage().trimEnd()}\n\n## Actions\n`, "genus-cryo-lock").actions).toBeUndefined();
  });

  it("leaves an undeclared species ability free of nested bullets", () => {
    for (const species of bakedSpecies()) {
      const md = bakedSpeciesPageContent(species);
      const back = parseSpeciesDefinitionPage(md, `species-${species.id}`)!.species;
      for (const ability of back.innateAbilities ?? []) {
        if (speciesInnate(species.id).find((a) => a.name === ability.name)?.actions) continue;
        expect(ability.actions, ability.name).toBeUndefined();
      }
      for (const variant of back.variants) {
        for (const ability of variant.abilities) expect(ability.actions, ability.name).toBeUndefined();
        for (const option of variant.options ?? []) expect(option.ability.actions, option.label).toBeUndefined();
      }
    }
  });
});

describe("the abilities that DO declare a block", () => {
  const declared = () => builtInAbilityPages().filter((a) => a.actions);

  it("exist — the seeded corpus is not silently empty", () => {
    // Every check below is vacuously true over an empty list, so a refactor that
    // dropped `actions` on the way out of the catalogs would pass all of them.
    expect(declared().length).toBeGreaterThanOrEqual(15);
  });

  it("declares only steps the grammar can read", () => {
    // The first blocks anybody sees are these. A shipped block with an error in
    // it teaches the syntax wrong to every Curator who forks the page.
    for (const ability of declared()) {
      expect(parseAbilityEffects(ability.actions).errors, ability.label).toEqual([]);
    }
  });

  it("re-emits its own block byte for byte", () => {
    // The Mechanics editor rebuilds a page from the parsed model. A step it
    // could not write back the way it was authored is a step it deletes.
    for (const ability of declared()) {
      const steps = parseAbilityEffects(ability.actions).steps;
      expect(steps.map(effectLine).join("\n"), ability.label).toBe(String(ability.actions).trim());
    }
  });

  it("adds its Actions section and nothing else to the page", () => {
    for (const ability of declared()) {
      const section = `\n\n## Actions\n\n${String(ability.actions).trim()}`;
      expect(ability.page.replace(section, ""), ability.label).toBe(ability.blank);
    }
  });

  it("leaves the ability's prose exactly as it was", () => {
    // The bug this catches is canonSection dropping a step bullet into the
    // section above it: the block would arrive AND the effect text would grow a
    // tail of "- Cost: 5 SS" lines, which the prose parser then reads as rolls.
    for (const ability of declared()) {
      const back = ability.read(ability.page);
      const bare = ability.read(ability.blank);
      expect(back.actions, ability.label).toBe(String(ability.actions).trim());
      expect(back.effect, ability.label).toBe(bare.effect);
      expect(parseAbilityActions(back.effect), ability.label).toEqual(parseAbilityActions(bare.effect));
    }
  });

  it("carries a declared innate onto its Species page and back off it", () => {
    // speciesInnate() and the Species page are two different routes to the same
    // ability. The page was taking only the effect, so a declared innate reached
    // the sheet while a Curator who forked the page got it with the steps deleted.
    for (const species of bakedSpecies()) {
      const declaredInnates = speciesInnate(species.id).filter((a) => a.actions);
      if (!declaredInnates.length) continue;
      const back = parseSpeciesDefinitionPage(bakedSpeciesPageContent(species), `species-${species.id}`)!.species;
      for (const innate of declaredInnates) {
        const found = back.innateAbilities?.find((a) => a.name === innate.name);
        expect(found?.actions, `${species.id} · ${innate.name}`).toBe(innate.actions);
      }
    }
  });
});
