// What a page is allowed to name, and which record it gets.
//
// The assertions that matter here are the ones about PRECEDENCE. A catalog that
// merely finds something is useless — every one of these cases finds something,
// and the bug is that it finds the wrong thing.
import { describe, expect, it } from "vitest";
import { buildAbilityCatalog, collectAbilityRecords, officialAbilityCatalog, type CatalogAbility } from "./abilityCatalog";

const rec = (over: Partial<CatalogAbility> & { name: string }): CatalogAbility => ({
  kind: "cipher",
  ...over,
});

describe("resolution order", () => {
  it("takes the permanent id over anything a name could match", () => {
    // A renamed page keeps its id, and a DIFFERENT page has since taken the old
    // name. Resolving by name would hand the invoker the impostor.
    const catalog = buildAbilityCatalog([
      rec({ id: "wte.cipher.weaponize", name: "Armed Intent", aliases: ["Weaponize"] }),
      rec({ id: "wte.cipher.weaponize-mk2", name: "Weaponize" }),
    ]);
    expect(catalog.lookup("wte.cipher.weaponize")?.name).toBe("Armed Intent");
    expect(catalog.lookup("wte.cipher.weaponize-mk2")?.name).toBe("Weaponize");
  });

  it("gives a name to the ability that CURRENTLY bears it, never to an alias", () => {
    // The exact collision speciesInnate documents: one ability's former name is
    // another's current name. The living ability owns it, because running the
    // wrong rules under the right label is the failure nobody at the table sees.
    const catalog = buildAbilityCatalog([
      rec({ id: "wte.cipher.old", name: "Spyder", aliases: ["Animation"] }),
      rec({ id: "wte.cipher.new", name: "Animation" }),
    ]);
    expect(catalog.lookup("Animation")?.id).toBe("wte.cipher.new");
    expect(catalog.lookup("Spyder")?.id).toBe("wte.cipher.old");
  });

  it("still resolves a former name nothing else claims, so a rename does not break an invoker", () => {
    const catalog = buildAbilityCatalog([rec({ id: "wte.genus.molecular-divergence", name: "Molecular Divergence", aliases: ["Teleport"] })]);
    expect(catalog.lookup("Teleport")?.id).toBe("wte.genus.molecular-divergence");
  });

  it("folds case, because the corpus SHOUTS its cipher names and a block will not", () => {
    const catalog = buildAbilityCatalog([rec({ id: "wte.cipher.weaponize", name: "WEAPONIZE" })]);
    expect(catalog.lookup("Weaponize")?.id).toBe("wte.cipher.weaponize");
    expect(catalog.lookup("  weaponize  ")?.id).toBe("wte.cipher.weaponize");
  });

  it("answers null rather than guessing, which is what makes a lint finding possible", () => {
    const catalog = buildAbilityCatalog([rec({ id: "wte.cipher.weaponize", name: "WEAPONIZE" })]);
    expect(catalog.lookup("Weaponise")).toBeNull();
    expect(catalog.lookup("")).toBeNull();
  });
});

describe("the live catalog", () => {
  it("resolves the three abilities S4 — THE LAST WAR names, by their permanent ids", () => {
    // The invocations this whole feature exists for. If these three stop
    // resolving, the corpus's own worked example is broken.
    const catalog = officialAbilityCatalog();
    expect(catalog.lookup("WEAPONIZE")?.id).toBe("wte.cipher.weaponize");
    expect(catalog.lookup("HOLLOW SHELL")?.id).toBe("wte.cipher.hollow-shell");
    expect(catalog.lookup("TRIXT LINK")?.id).toBe("wte.cipher.trixt-link");
  });

  it("reaches every kind of ability, not only the one the invoker happens to be", () => {
    const kinds = new Set(collectAbilityRecords().map((record) => record.kind));
    expect(kinds).toContain("cipher");
    expect(kinds).toContain("genus");
    expect(kinds).toContain("innate");
  });

  it("indexes each record once however many paradigms can reach it", () => {
    const records = collectAbilityRecords();
    expect(new Set(records).size).toBe(records.length);
  });

  it("hands the invoked page's own block through, so there is something to run", () => {
    // ECHO CHAIN is the shipped cipher that carries an `## Actions` block, and
    // an invocation is worth nothing if the block does not travel with it.
    const echo = officialAbilityCatalog().lookup("wte.cipher.echo-chain");
    expect(echo?.actions).toContain("Save (enemies)");
  });
});
