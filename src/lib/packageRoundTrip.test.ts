// @vitest-environment happy-dom
//
// Phase 2E: a campaign package that actually carries the campaign.
//
// The headline test is the round trip with a NON-EMPTY package — the previous
// version exported `pages: []` unconditionally and never wrote pkg.pages on
// import, so a package round-tripped "successfully" while losing every house
// rule the table played by.
import { describe, expect, it } from "vitest";
import {
  PACKAGE_VERSION,
  PackageVersionError,
  NotAPackageError,
  parsePackage,
  serializePackage,
  remapConceptId,
  ruleLayerProblem,
  type CampaignPackage,
} from "./campaignPackage";
import { pageBelongsTo, pageIsUnownedHouseRule, readField, reownPage, reownPages } from "./campaignPages";
import type { RuleLayer } from "../game/ruleLayers";

const OLD = "8a93a397-4c21-4a6e-9d0b-1f2e3a4b5c6d";
const NEW = "e25cc744-1111-2222-3333-444455556666";

const housePage = [
  "# Ashen Lark",
  "",
  "| Field | Value |",
  "|---|---|",
  "| Type | Genus |",
  `| ID | campaign.${OLD}.genus.ashen-lark |`,
  "| Overrides | wte.genus.lark |",
  "| SS | 2 |",
  "",
  "Effect: The Ashen Sun version.",
].join("\n");

function fullPackage(): CampaignPackage {
  return {
    wte: "campaign",
    version: PACKAGE_VERSION,
    exportedAt: 1,
    campaign: { id: OLD, name: "Ashen Sun", createdAt: 1, updatedAt: 2, archived: false },
    characters: [],
    notes: [],
    sequences: [],
    scenes: [],
    encounters: [],
    assets: [],
    kv: [],
    rules: { attrBudget: true, attrBudgetPoints: 82, specTotal: 240, poolCompensation: true, paradigmAffinity: true },
    pages: [{ stem: "Ashen_Lark", content: housePage }],
    ruleLayers: [
      { id: "L1", targetId: `campaign.${OLD}.genus.ashen-lark`, scope: "campaign", owner: OLD, op: "add", value: 2, note: "surcharge" },
    ],
  };
}

describe("the envelope refuses what it cannot fully understand", () => {
  it("round-trips a package unchanged", () => {
    const pkg = fullPackage();
    expect(parsePackage(JSON.parse(serializePackage(pkg)))).toEqual(pkg);
  });

  it("keeps the pages, campaign rules and rule layers through serialisation", () => {
    const back = parsePackage(JSON.parse(serializePackage(fullPackage())));
    expect(back.pages).toHaveLength(1);
    expect(back.rules).toEqual(fullPackage().rules);
    expect(back.ruleLayers).toHaveLength(1);
  });

  it("imports a v3 page-and-layer package and supplies default campaign rules", () => {
    const { rules: _rules, ...legacyV3 } = fullPackage();
    const back = parsePackage({ ...legacyV3, version: 3 });
    expect(back.pages).toHaveLength(1);
    expect(back.ruleLayers).toHaveLength(1);
    expect(back.rules).toEqual({
      attrBudget: false,
      attrBudgetPoints: 70,
      specTotal: 200,
      poolCompensation: false, paradigmAffinity: true
    });
  });

  it("refuses a package from a newer build rather than dropping what it cannot read", () => {
    const pkg = { ...fullPackage(), version: PACKAGE_VERSION + 1 };
    expect(() => parsePackage(pkg)).toThrow(PackageVersionError);
  });

  it("is labelled 4, so an older build refuses it rather than dropping campaign rules", () => {
    // A build only rejects packages NEWER than it knows. A v3 build would accept
    // a v3-labelled file and silently discard the new CampaignRules field.
    expect(fullPackage().version).toBe(4);
  });

  it("refuses a file that is not a package at all", () => {
    expect(() => parsePackage({ hello: "world" })).toThrow(NotAPackageError);
    expect(() => parsePackage(null)).toThrow(NotAPackageError);
  });
});

describe("a campaign's pages belong to it, in writing", () => {
  it("recognises a page this campaign owns", () => {
    expect(pageBelongsTo(housePage, OLD)).toBe(true);
  });

  it("does not claim another campaign's page", () => {
    expect(pageBelongsTo(housePage, NEW)).toBe(false);
  });

  it("does not claim an official page", () => {
    const official = "# Lark\n\n| Type | Genus |\n| ID | wte.genus.lark |\n";
    expect(pageBelongsTo(official, OLD)).toBe(false);
  });

  it("flags a house rule that never recorded its owner", () => {
    const orphan = "# Homebrew\n\n| Type | Genus |\n| Overrides | wte.genus.lark |\n";
    expect(pageIsUnownedHouseRule(orphan)).toBe(true);
    expect(pageBelongsTo(orphan, OLD)).toBe(false);
  });

  it("does not flag a page that deliberately stands alone", () => {
    const standalone = "# Mine\n\n| Type | Genus |\n| Overrides | none |\n";
    expect(pageIsUnownedHouseRule(standalone)).toBe(false);
  });
});

describe("importing as a copy remaps every reference", () => {
  it("moves a page's id onto the new campaign", () => {
    const moved = reownPage(housePage, OLD, NEW);
    expect(moved).toContain(`campaign.${NEW}.genus.ashen-lark`);
    expect(moved).not.toContain(OLD);
  });

  it("keeps the slug, so references between imported records still line up", () => {
    expect(reownPage(housePage, OLD, NEW)).toContain("genus.ashen-lark");
  });

  it("leaves the page's actual content alone", () => {
    const moved = reownPage(housePage, OLD, NEW);
    expect(moved).toContain("| Overrides | wte.genus.lark |");
    expect(moved).toContain("Effect: The Ashen Sun version.");
    expect(moved).toContain("| SS | 2 |");
  });

  it("does not touch a page owned by some third campaign", () => {
    const theirs = housePage.replace(OLD, "cccccccc-0000-0000-0000-000000000000");
    expect(reownPage(theirs, OLD, NEW)).toBe(theirs);
  });

  it("moves a campaign-scoped rule target with it", () => {
    expect(remapConceptId(`campaign.${OLD}.genus.ashen-lark`, OLD, NEW)).toBe(`campaign.${NEW}.genus.ashen-lark`);
  });

  it("leaves an OFFICIAL rule target exactly where it is", () => {
    // wte.genus.lark means the same thing in every campaign; rewriting it would
    // point the layer at a concept that does not exist.
    expect(remapConceptId("wte.genus.lark", OLD, NEW)).toBe("wte.genus.lark");
  });

  it("leaves everything alone in merge mode", () => {
    expect(remapConceptId(`campaign.${OLD}.genus.x`, OLD, OLD)).toBe(`campaign.${OLD}.genus.x`);
    expect(reownPages([{ stem: "P", content: housePage }], OLD, OLD)[0].content).toBe(housePage);
  });

  it("survives the whole page set at once", () => {
    const out = reownPages([{ stem: "A", content: housePage }, { stem: "B", content: housePage }], OLD, NEW);
    expect(out.every((p) => p.content.includes(NEW))).toBe(true);
  });
});

describe("incoming rule layers are checked, not trusted", () => {
  const good: RuleLayer = { id: "L", targetId: "wte.genus.lark", scope: "campaign", owner: OLD, op: "add", value: 1 };

  it("accepts a sound one", () => {
    expect(ruleLayerProblem(good)).toBeNull();
  });

  it("refuses an operation this build does not know", () => {
    expect(ruleLayerProblem({ ...good, op: "obliterate" as RuleLayer["op"] })).toMatch(/operation/);
  });

  it("refuses a scope this build does not know", () => {
    expect(ruleLayerProblem({ ...good, scope: "galaxy" as RuleLayer["scope"] })).toMatch(/scope/);
  });

  it("refuses a value that is not a number", () => {
    expect(ruleLayerProblem({ ...good, value: "3" as unknown as number })).toMatch(/not a number/);
    expect(ruleLayerProblem({ ...good, value: NaN })).toMatch(/not a number/);
  });

  it("refuses a scoped layer with no owner, which could never apply", () => {
    expect(ruleLayerProblem({ ...good, owner: undefined })).toMatch(/belongs to/);
  });

  it("refuses one that does not say what it applies to", () => {
    expect(ruleLayerProblem({ ...good, targetId: "" })).toMatch(/what it applies to/);
  });
});

describe("an owned page is routed to the store, not to disk", () => {
  // The routing decides whether two campaigns can hold different versions of one
  // page at all. It is driven by reading the page's ID row, and a mangled regex
  // there would send every page to disk while every test still passed — so this
  // asserts the read itself.
  it("reads the ID row out of a real page", () => {
    expect(readField(housePage, "ID")).toBe(`campaign.${OLD}.genus.ashen-lark`);
  });

  it("reads the other identity rows too", () => {
    expect(readField(housePage, "Overrides")).toBe("wte.genus.lark");
    expect(readField(housePage, "Type")).toBe("Genus");
  });

  it("returns nothing for a row the page does not have", () => {
    expect(readField(housePage, "Visibility")).toBeUndefined();
  });

  it("still reads the ID after the page is re-owned for a copy", () => {
    // If this came back undefined the imported page would be filed as global,
    // and the copy would quietly share the original's pages.
    expect(readField(reownPage(housePage, OLD, NEW), "ID")).toBe(`campaign.${NEW}.genus.ashen-lark`);
  });

  it("does not mistake an official page for an owned one", () => {
    const official = "# Lark\n\n| Type | Genus |\n| ID | wte.genus.lark |\n";
    expect(readField(official, "ID")).toBe("wte.genus.lark");
  });
});
