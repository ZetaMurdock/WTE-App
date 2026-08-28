// Permanent identity for ciphers and innates.
//
// Before this, a cipher was known only by its NAME and by where it sat in a
// loadout, so an applied outcome could not be correlated back to the ability
// that produced it across a rename or a reorder — the two things a Curator and
// a player respectively do all the time. Genus solved it with a stamped id and
// aliases; these assertions hold ciphers and innates to the same standard.
import { afterEach, describe, expect, it } from "vitest";
import { ID_KINDS, parseId, slugify } from "./codexId";
import { buildAbilityCatalog, collectAbilityRecords } from "./abilityCatalog";
import {
  bakedCiphers,
  bakedSpeciesInnate,
  bakedSpecies,
  CIPHER_DATA_BY_ID,
  INNATE_DATA_BY_ID,
  inceptSeeds,
  registerCodexGameData,
  speciesInnate,
  usableCiphers,
  usableRacial,
} from "./wte";

const CIPHERS = Object.entries(bakedCiphers());
const ALL_CIPHERS = CIPHERS.flatMap(([, list]) => list);

describe("every official cipher carries a permanent id", () => {
  it("stamps one on all 148", () => {
    expect(ALL_CIPHERS).toHaveLength(148);
    expect(ALL_CIPHERS.filter((c) => c.id)).toHaveLength(ALL_CIPHERS.length);
  });

  // The stamped value is not free: bakedCodexPages.ts derived it on the fly, so
  // anything but this exact string rewrites 148 built-in pages and moves the
  // campaign revision hash for every table that changed nothing.
  it("stamps exactly the id the built-in pages already computed", () => {
    for (const cipher of ALL_CIPHERS) {
      expect(cipher.id, cipher.name).toBe(`wte.cipher.${slugify(cipher.name)}`);
    }
  });

  it("parses as a well-formed wte-scoped Codex id", () => {
    for (const cipher of ALL_CIPHERS) {
      expect(parseId(cipher.id!), cipher.name).toMatchObject({ scope: "wte", kind: "cipher" });
    }
  });

  it("is unique across every paradigm", () => {
    const ids = ALL_CIPHERS.map((c) => c.id!);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("is reachable through CIPHER_DATA_BY_ID", () => {
    expect(CIPHER_DATA_BY_ID.size).toBe(ALL_CIPHERS.length);
    for (const cipher of ALL_CIPHERS) {
      expect(CIPHER_DATA_BY_ID.get(cipher.id!)?.name, cipher.name).toBe(cipher.name);
    }
  });
});

describe("every official innate carries a permanent id", () => {
  const SPECIES_IDS = bakedSpecies().map((s) => s.id);
  const ALL_INNATE = SPECIES_IDS.flatMap((id) => [...bakedSpeciesInnate(id)]);

  it("stamps a species-qualified id on each", () => {
    expect(ALL_INNATE.length).toBeGreaterThan(0);
    for (const id of SPECIES_IDS) {
      for (const innate of bakedSpeciesInnate(id)) {
        expect(innate.id, `${id}/${innate.name}`).toBe(`wte.innate.${slugify(id)}-${slugify(innate.name)}`);
        expect(parseId(innate.id!), innate.name).toMatchObject({ scope: "wte", kind: "innate" });
      }
    }
  });

  // Hyomen and Insectoid both ship a "Peak Evolution", and they are not the same
  // ability. The species qualifier is what keeps them apart.
  it("keeps same-named innates on different lineages distinct", () => {
    const ids = ALL_INNATE.map((a) => a.id!);
    expect(new Set(ids).size).toBe(ids.length);
    expect(INNATE_DATA_BY_ID.get("wte.innate.hyomen-peak-evolution")).toBeDefined();
    expect(INNATE_DATA_BY_ID.get("wte.innate.insectoid-peak-evolution")).toBeDefined();
  });

  it("survives the Species-record name match that supplies the effect", () => {
    for (const species of bakedSpecies()) {
      const baked = new Map(bakedSpeciesInnate(species.id).map((a) => [a.name.toLowerCase(), a.id]));
      for (const resolved of speciesInnate(species.id)) {
        const expected = baked.get(resolved.name.toLowerCase());
        if (expected) expect(resolved.id, `${species.id}/${resolved.name}`).toBe(expected);
      }
    }
  });
});

describe("permanent ids reach the rows play actually uses", () => {
  const science = bakedCiphers()["science"];

  it("rides along on a resolved cipher", () => {
    const [first] = science;
    const [row] = usableCiphers("science", [first.name]);
    expect(row.name).toBe(first.name);
    expect(row.id).toBe(first.id);
  });

  it("rides along on a resolved innate", () => {
    const rows = usableRacial("hyomen");
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(row.id, row.name).toMatch(/^wte\.innate\.hyomen-/);
  });

  it("leaves a loadout entry nothing answers to without one", () => {
    const [row] = usableCiphers("science", ["NOT A CIPHER"]);
    expect(row.name).toBe("NOT A CIPHER");
    expect(row.id).toBeUndefined();
    expect(row.ss).toBe(0);
  });

  // A migrated loadout holds ids, not names. Without this it renders as a row of
  // raw `wte.cipher.*` strings costing 0 SS.
  it("resolves a loadout that stored the id instead of the name", () => {
    const [first] = science;
    const [row] = usableCiphers("science", [first.id!]);
    expect(row.name).toBe(first.name);
    expect(row.id).toBe(first.id);
    expect(row.ss).toBe(first.ss ?? 0);
  });
});

describe("a former name keeps resolving", () => {
  // No shipped cipher or innate has been renamed through `aliases` yet —
  // CIPHER_RENAMES predates identity and is a separate hand-kept table. These
  // drive the mechanism through the overlay so the first real rename is not
  // also the first time the path runs.
  afterEach(() => registerCodexGameData({}));

  it("resolves a cipher loadout holding the pre-rename name", () => {
    registerCodexGameData({
      ciphers: {
        science: [
          { name: "TESSELLATE", id: "wte.cipher.tessellate", aliases: ["TESSELATE"], ss: 12, tier: "online", type: "Bonus Action", effect: "Tiles." },
        ],
      },
    });
    const [row] = usableCiphers("science", ["TESSELATE"]);
    // The CURRENT name, not the stored one: an alias hit is a resolution, and a
    // row that kept displaying the dead name teaches the player the wrong word.
    expect(row.name).toBe("TESSELLATE");
    expect(row.id).toBe("wte.cipher.tessellate");
    expect(row.ss).toBe(12);
  });

  it("counts an aliased innate as chosen, on both sides of the 2-of-4 split", () => {
    registerCodexGameData({
      species: [
        {
          species: {
            ...bakedSpecies().find((s) => s.id === "hyomen")!,
            innateAbilities: [
              { name: "Peak Evolution", id: "wte.innate.hyomen-peak-evolution", aliases: ["Apex Growth"], effect: "Ascends." },
              { name: "Omen", id: "wte.innate.hyomen-omen", effect: "Marks." },
            ],
          },
          provided: ["innateAbilities"],
        },
      ],
    });
    // usableRacial and inceptSeeds partition ONE list. An ability the two
    // disagree about is simultaneously active and available as an Incept seed.
    const active = usableRacial("hyomen", undefined, undefined, ["Apex Growth"]);
    expect(active.map((a) => a.name)).toEqual(["Peak Evolution"]);
    expect(active[0].id).toBe("wte.innate.hyomen-peak-evolution");
    expect(inceptSeeds("hyomen", ["Apex Growth"]).map((a) => a.name)).toEqual(["Omen"]);
  });

  it("matches an innate choice stored as the permanent id", () => {
    const active = usableRacial("hyomen", undefined, undefined, ["wte.innate.hyomen-omen"]);
    expect(active.map((a) => a.name)).toEqual(["Omen"]);
    expect(inceptSeeds("hyomen", ["wte.innate.hyomen-omen"]).map((a) => a.name)).not.toContain("Omen");
  });
});

// A species innate has had a permanent id since identity landed; the abilities a
// lineage VARIANT grants had none at all — every one reported ID=(none). So an
// outcome applied by a Spatian's Evolved Body could not be correlated back
// across a rename, `Invoke: Telepathy` could not say which Telepathy it meant,
// and a page had no way to address one of these abilities at all.
describe("every variant ability carries a permanent id", () => {
  // Every row usableRacial can hand back that came off a variant: the ability
  // list AND the creation-time options, because an option's ability is a third
  // kind of row and is reached by a different choice.
  const ROWS = bakedSpecies().flatMap((species) =>
    species.variants.flatMap((variant) => [
      ...variant.abilities.map((ability) => ({ species, variant, ability, option: undefined as string | undefined })),
      ...(variant.options ?? []).map((o) => ({ species, variant, ability: o.ability, option: o.label })),
    ])
  );

  it("stamps one on all 75", () => {
    expect(ROWS).toHaveLength(75);
    expect(ROWS.filter((r) => r.ability.id)).toHaveLength(ROWS.length);
  });

  // speciesInnate.json's scheme with the qualifiers a variant needs, not a
  // second scheme: species, then variant, then — for an option — the label.
  it("stamps species + variant (+ option label) + name, the way an innate id is built", () => {
    for (const { species, variant, ability, option } of ROWS) {
      const parts = [species.id, variant.name, ...(option ? [option] : []), ability.name].map(slugify);
      expect(ability.id, `${species.id}/${variant.name}/${ability.name}`).toBe(`wte.innate.${parts.join("-")}`);
    }
  });

  it("parses as a well-formed wte-scoped Codex id", () => {
    for (const { ability } of ROWS) {
      expect(parseId(ability.id!), ability.name).toMatchObject({ scope: "wte", kind: "innate" });
    }
  });

  // `innate` is an ID_KIND every shipped build already validates. A NEW kind
  // would make an older peer's parseId return null for any page pinned to one,
  // and that peer would then reject the whole Codex snapshot — the table splits
  // for a reason nobody can see. The scheme therefore adds no kind.
  it("uses a kind older builds already accept", () => {
    expect(ID_KINDS).toContain("innate");
  });

  // Stygians ships Telepathy twice — the Greys' and the Annunaki "Humanoid Head"
  // option's — and they are reached by different creation choices. A
  // species+name key, the exact shape innate ids use, collides on this pair.
  it("keeps the two Stygian Telepathies apart", () => {
    const ids = ROWS.filter((r) => r.ability.name === "Telepathy").map((r) => r.ability.id);
    expect(ids).toEqual([
      "wte.innate.stygians-greys-telepathy",
      "wte.innate.stygians-annunaki-humanoid-head-telepathy",
    ]);
  });

  it("is unique across every lineage, variant and option", () => {
    const ids = ROWS.map((r) => r.ability.id!);
    expect(new Set(ids).size).toBe(ids.length);
  });

  // Putting the Annunaki options in the catalog gave `Telepathy` two records.
  // `claim` is first-wins, so the bare name keeps meaning the Greys' ability —
  // but that rests on Greys preceding Annunaki in variants.json, which nothing
  // else states. Reordering that array silently repoints every existing
  // `Invoke: Telepathy` at the Annunaki's rules under an unchanged label, so
  // the RESOLUTION is pinned here rather than the array order.
  it("keeps the bare name Telepathy pointing at the Greys' ability", () => {
    const catalog = buildAbilityCatalog(collectAbilityRecords());
    expect(catalog.lookup("Telepathy")?.id).toBe("wte.innate.stygians-greys-telepathy");
    // And each id still reaches its own, which is the point of stamping them.
    expect(catalog.lookup("wte.innate.stygians-greys-telepathy")?.name).toBe("Telepathy");
    expect(catalog.lookup("wte.innate.stygians-annunaki-humanoid-head-telepathy")?.name).toBe("Telepathy");
  });

  // Innates and variant abilities share the `wte.innate.` prefix, so they share
  // ONE id space: a variant id equal to an innate id would silently make two
  // different abilities the same concept.
  it("never collides with a species innate id", () => {
    const innate = new Set(bakedSpecies().flatMap((s) => bakedSpeciesInnate(s.id).map((a) => a.id!)));
    for (const { ability } of ROWS) expect(innate.has(ability.id!), ability.id).toBe(false);
  });

  // Asserted against the CATALOG, not a map built for the occasion: the catalog
  // is what `Invoke:` and every page reference actually call, so this proves the
  // ids are reachable by the path production uses rather than by a second index
  // nothing else reads.
  it("resolves through the ability catalog every reference goes through", () => {
    const catalog = buildAbilityCatalog(collectAbilityRecords());
    for (const { ability } of ROWS) {
      expect(catalog.lookup(ability.id!)?.name, ability.id).toBe(ability.name);
    }
    // A species innate stays out of the variant space and vice versa: "is this
    // id a Spatian's Evolved Body?" must not come back yes for a 2-of-4 innate.
    expect(INNATE_DATA_BY_ID.has("wte.innate.hyomen-spatians-evolved-body")).toBe(false);
    expect(catalog.lookup("wte.innate.hyomen-spatians-evolved-body")?.name).toBe("Evolved Body");
  });
});

describe("a variant ability id reaches the rows play uses", () => {
  it("rides along on usableRacial, for a variant ability and for an option", () => {
    const rows = usableRacial("stygians", "Annunaki", "Humanoid Head");
    const byName = new Map(rows.map((r) => [r.name, r.id]));
    expect(byName.get("Melam Manifestation")).toBe("wte.innate.stygians-annunaki-melam-manifestation");
    expect(byName.get("Telepathy")).toBe("wte.innate.stygians-annunaki-humanoid-head-telepathy");
    // Every row, not only the two named — an unstamped row is one an applied
    // outcome can be filed under nothing but a display name.
    for (const row of rows) expect(row.id, row.name).toBeTruthy();
  });

  // The point of an id on a duplicated name: `Invoke: Telepathy` can only ever
  // mean one of the two, and until now nothing could say which.
  it("lets an invocation name the Telepathy it means", () => {
    const catalog = buildAbilityCatalog(collectAbilityRecords());
    const greys = catalog.lookup("wte.innate.stygians-greys-telepathy");
    const annunaki = catalog.lookup("wte.innate.stygians-annunaki-humanoid-head-telepathy");
    expect(greys?.name).toBe("Telepathy");
    expect(annunaki?.name).toBe("Telepathy");
    expect(greys).not.toBe(annunaki);
    // The bare name still resolves exactly as it did — ids are additive, and a
    // page that writes `Telepathy` must not start failing to resolve.
    expect(catalog.lookup("Telepathy")).toBe(greys);
  });

  // Aliases are honoured where genus honours them — the flat catalog, current
  // names claimed before any former one. The id survives a rename; the alias
  // keeps the old word resolving. Nothing shipped has been renamed yet, so this
  // drives the path rather than leaving the first real rename to try it.
  it("resolves a renamed variant ability by its former name, and by its id", () => {
    const catalog = buildAbilityCatalog([
      { id: "wte.innate.hyomen-spatians-evolved-body", name: "Adaptive Body", aliases: ["Evolved Body"], kind: "innate" },
    ]);
    expect(catalog.lookup("Evolved Body")?.name).toBe("Adaptive Body");
    expect(catalog.lookup("wte.innate.hyomen-spatians-evolved-body")?.name).toBe("Adaptive Body");
  });
});
