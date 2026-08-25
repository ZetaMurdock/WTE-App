// Permanent identity for ciphers and innates.
//
// Before this, a cipher was known only by its NAME and by where it sat in a
// loadout, so an applied outcome could not be correlated back to the ability
// that produced it across a rename or a reorder — the two things a Curator and
// a player respectively do all the time. Genus solved it with a stamped id and
// aliases; these assertions hold ciphers and innates to the same standard.
import { afterEach, describe, expect, it } from "vitest";
import { parseId, slugify } from "./codexId";
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
