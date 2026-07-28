import { describe, expect, it } from "vitest";
import {
  ID_SCOPES,
  compareScope,
  isCodexId,
  lookupKeys,
  makeId,
  overriddenId,
  parseId,
  rename,
  sameConcept,
  scopeRank,
  slugify,
} from "./codexId";

describe("slugify is deterministic and lossy in a predictable way", () => {
  it("lowercases and hyphenates", () => {
    expect(slugify("Vector Swing")).toBe("vector-swing");
    expect(slugify("Synaptic  Space")).toBe("synaptic-space");
  });

  it("strips accents so spellings agree", () => {
    expect(slugify("Voaültön")).toBe("voaulton");
    expect(slugify("Aeor Índeri")).toBe("aeor-inderi");
  });

  it("drops apostrophes rather than turning them into separators", () => {
    // "AI'N" must not become "ai-n".
    expect(slugify("AI'N")).toBe("ain");
    expect(slugify("Curator’s Note")).toBe("curators-note");
  });

  it("collapses punctuation and trims the edges", () => {
    expect(slugify("(IN) G-Force System")).toBe("in-g-force-system");
    expect(slugify("  —Staggered—  ")).toBe("staggered");
    expect(slugify("A_O_E — After Oracle Era")).toBe("a-o-e-after-oracle-era");
  });

  it("gives the same answer every time for the same input", () => {
    const n = "Trans-modification / Reverse";
    expect(slugify(n)).toBe(slugify(n));
  });

  it("returns empty for a name with nothing usable in it", () => {
    expect(slugify("!!!")).toBe("");
    expect(slugify("")).toBe("");
  });
});

describe("ids are built and parsed symmetrically", () => {
  it("builds an official id", () => {
    expect(makeId("genus", "Vector Swing")).toBe("wte.genus.vector-swing");
    expect(makeId("stat", "Synaptic Space")).toBe("wte.stat.synaptic-space");
  });

  it("builds a campaign-scoped id", () => {
    expect(makeId("ability", "Gravitic Blood", { scope: "campaign", owner: "Ashen Sun" })).toBe(
      "campaign.ashen-sun.ability.gravitic-blood"
    );
  });

  it("refuses a name with no usable characters instead of making a broken id", () => {
    expect(() => makeId("genus", "???")).toThrow(/no usable characters/);
  });

  it("refuses a scoped id with no owner", () => {
    expect(() => makeId("ability", "X", { scope: "campaign" })).toThrow(/needs an owner/);
  });

  it("round-trips every scope", () => {
    for (const scope of ID_SCOPES) {
      const id = scope === "wte" ? makeId("genus", "Lark") : makeId("genus", "Lark", { scope, owner: "Owner Name" });
      const p = parseId(id);
      expect(p, id).not.toBeNull();
      expect(p!.scope).toBe(scope);
      expect(p!.kind).toBe("genus");
      expect(p!.slug).toBe("lark");
      if (scope !== "wte") expect(p!.owner).toBe("owner-name");
    }
  });

  it("rejects malformed ids rather than guessing", () => {
    for (const bad of [
      "",
      "genus.lark",
      "wte.lark",
      "wte.notakind.lark",
      "nope.genus.lark",
      "wte.genus.",
      "campaign.genus.lark", // scoped but missing the owner segment
      "campaign.owner.notakind.lark",
      "wte.genus.lark.extra",
    ]) {
      expect(parseId(bad), bad).toBeNull();
      expect(isCodexId(bad), bad).toBe(false);
    }
  });

  it("accepts well-formed ids", () => {
    expect(isCodexId("wte.condition.staggered")).toBe(true);
    expect(isCodexId("pack.red-choir.creature.wraith")).toBe(true);
  });
});

describe("layers resolve in a defined order", () => {
  it("ranks official weakest and session strongest", () => {
    expect(scopeRank("wte")).toBeLessThan(scopeRank("pack"));
    expect(scopeRank("pack")).toBeLessThan(scopeRank("campaign"));
    expect(scopeRank("campaign")).toBeLessThan(scopeRank("character"));
    expect(scopeRank("character")).toBeLessThan(scopeRank("session"));
  });

  it("says a campaign override beats the official rule", () => {
    expect(compareScope("campaign.ashen-sun.stat.focus", "wte.stat.focus")).toBeGreaterThan(0);
  });

  it("says a temporary session effect beats a campaign override", () => {
    expect(compareScope("session.null-storm.stat.focus", "campaign.ashen-sun.stat.focus")).toBeGreaterThan(0);
  });

  it("recognises the same concept across layers", () => {
    expect(sameConcept("wte.genus.vector-swing", "campaign.ashen-sun.genus.vector-swing")).toBe(true);
    expect(sameConcept("wte.genus.vector-swing", "wte.cipher.vector-swing")).toBe(false);
    expect(sameConcept("wte.genus.lark", "wte.genus.reflect")).toBe(false);
  });

  it("names the official definition a scoped id overrides", () => {
    expect(overriddenId("campaign.ashen-sun.stat.synaptic-focus")).toBe("wte.stat.synaptic-focus");
    // An official definition overrides nothing.
    expect(overriddenId("wte.stat.synaptic-focus")).toBeNull();
  });
});

describe("renaming does not break references — the point of the whole module", () => {
  it("keeps the id and files the old name as an alias", () => {
    const before = { id: makeId("genus", "Vector Swing"), name: "Vector Swing" };
    const after = rename(before, "Vector Redirection");
    // This is the guarantee: every character and creature referencing the id is
    // untouched by the rename.
    expect(after.id).toBe(before.id);
    expect(after.name).toBe("Vector Redirection");
    expect(after.aliases).toContain("Vector Swing");
  });

  it("still resolves by the old name afterwards", () => {
    const after = rename({ id: "wte.genus.vector-swing", name: "Vector Swing" }, "Vector Redirection");
    expect(lookupKeys(after)).toContain("vector swing");
    expect(lookupKeys(after)).toContain("vector redirection");
  });

  it("accumulates aliases across several renames", () => {
    let x = { id: "wte.genus.a", name: "First" };
    x = rename(x, "Second");
    x = rename(x, "Third");
    expect(x.name).toBe("Third");
    expect(x.aliases).toEqual(expect.arrayContaining(["First", "Second"]));
  });

  it("is a no-op for an empty or unchanged name", () => {
    const x = { id: "wte.genus.a", name: "Same" };
    expect(rename(x, "Same")).toBe(x);
    expect(rename(x, "   ")).toBe(x);
  });

  it("does not list the current name as one of its own aliases", () => {
    let x = { id: "wte.genus.a", name: "One" };
    x = rename(x, "Two");
    x = rename(x, "One"); // renamed back
    expect(x.name).toBe("One");
    expect(x.aliases).not.toContain("One");
  });
});

describe("lookup keys cover everything a resolver should match", () => {
  it("includes the id, the name and every alias", () => {
    const keys = lookupKeys({
      id: "wte.condition.staggered",
      name: "Staggered",
      aliases: ["Off Balance", "Reeling"],
    });
    expect(keys).toContain("wte.condition.staggered");
    expect(keys).toContain("staggered");
    expect(keys).toContain("off balance");
    expect(keys).toContain("off-balance");
    expect(keys).toContain("reeling");
  });

  it("does not repeat itself when a name already equals its slug", () => {
    const keys = lookupKeys({ id: "wte.genus.lark", name: "lark" });
    expect(keys.filter((k) => k === "lark")).toHaveLength(1);
  });
});
