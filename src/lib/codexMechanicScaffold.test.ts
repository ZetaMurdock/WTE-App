import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PARADIGMS, SPECIES, SPECIES_SIZE, type CodexBackground } from "../game/wte";
import { customizePageForCampaign, readField } from "./pageIdentity";
import { parseBackgroundsDirectory, parseParadigmPage, parseSpeciesDefinitionPage } from "./gameData";
import {
  inferCodexSectionLabel,
  prepareCampaignCustomization,
  type MechanicScaffoldCatalog,
} from "./codexMechanicScaffold";

function rule(name: string): string {
  return fs.readFileSync(path.resolve(__dirname, `../rules/${name}.md`), "utf8");
}

function realCatalog(): MechanicScaffoldCatalog {
  const backgrounds = parseBackgroundsDirectory(rule("Backgrounds"));
  return { species: SPECIES, paradigms: PARADIGMS, backgrounds, speciesSizes: SPECIES_SIZE };
}

describe("official article campaign-mechanics scaffolds", () => {
  it("turns the real Hyomen lore article into a populated semantic Species override", () => {
    const prepared = prepareCampaignCustomization({
      stem: "Hyomen",
      content: rule("Hyomen"),
      catalog: realCatalog(),
    });

    expect(prepared).toMatchObject({ label: "Species", kind: "Species", scaffolded: true });
    expect(prepared.content).toContain("## Campaign Mechanics (Character Sheet & VTT)");
    expect(prepared.content).toContain("| Type | Species |");
    expect(prepared.content).toContain("| Dominance | 45 |");
    expect(prepared.content).toContain("| Recessiveness | 10 |");
    expect(prepared.content).toContain("| Eminence | Civilized +30 |");
    expect(prepared.content).toContain("| Innate Select | 2 |");

    const fork = customizePageForCampaign({
      content: prepared.content,
      stem: "Hyomen",
      campaignId: "Ashen Sun",
    });
    expect(fork.id).toBe("campaign.ashen-sun.species.hyomen");
    expect(fork.overrides).toBe("wte.species.hyomen");
    expect(readField(fork.content, "Overrides")).toBe("wte.species.hyomen");

    const parsed = parseSpeciesDefinitionPage(fork.content, "Hyomen");
    expect(parsed?.species).toMatchObject({ id: "hyomen", name: "Hyomen", dom: 45, rec: 10, innateSelect: 2 });
  });

  it("turns the real Science article into the current Paradigm definition", () => {
    const prepared = prepareCampaignCustomization({
      stem: "Science",
      content: rule("Science"),
      catalog: realCatalog(),
    });
    const fork = customizePageForCampaign({ content: prepared.content, stem: "Science", campaignId: "Ashen Sun" });
    const parsed = parseParadigmPage(fork.content, "Science");

    expect(prepared).toMatchObject({ label: "Paradigm", kind: "Paradigm", scaffolded: true });
    expect(fork).toMatchObject({
      id: "campaign.ashen-sun.paradigm.science",
      overrides: "wte.paradigm.science",
    });
    expect(parsed).toEqual(PARADIGMS.find((item) => item.id === "science"));
  });

  it("uses the real Background directory record for an individual legacy article", () => {
    const catalog = realCatalog();
    const expected = catalog.backgrounds.find((background) => background.name === "The Derived") as CodexBackground;
    expect(expected).toBeTruthy();

    const prepared = prepareCampaignCustomization({
      stem: "The_Derived",
      content: rule("The_Derived"),
      catalog,
    });
    const fork = customizePageForCampaign({ content: prepared.content, stem: "The_Derived", campaignId: "Ashen Sun" });

    expect(prepared).toMatchObject({ label: "Background", kind: "Background", scaffolded: true });
    expect(prepared.content).toContain("| Bonuses |");
    expect(fork.id).toBe("campaign.ashen-sun.background.the-derived");
    expect(fork.overrides).toBe("wte.background.the-derived");
  });

  it("does not duplicate an already structured page", () => {
    const content = "# Hyomen\n\n| Type | Species |\n| Name | Hyomen |";
    const prepared = prepareCampaignCustomization({ stem: "Hyomen", content, catalog: realCatalog() });
    expect(prepared).toMatchObject({ label: "Species", kind: "Species", scaffolded: false, content });
  });

  it("records the exact official manifest id when a legacy article is forked", () => {
    const prepared = prepareCampaignCustomization({
      stem: "Hyomen",
      content: rule("Hyomen"),
      catalog: realCatalog(),
    });
    const fork = customizePageForCampaign({
      content: prepared.content,
      stem: "Hyomen",
      campaignId: "Ashen Sun",
      officialId: "wte.page.hyomen",
    });

    expect(fork.id).toBe("campaign.ashen-sun.species.hyomen");
    expect(fork.overrides).toBe("wte.page.hyomen");
    expect(readField(fork.content, "Overrides")).toBe("wte.page.hyomen");
  });
});

describe("official section inference", () => {
  it("classifies exact catalog articles and their directory pages without classifying lookalikes", () => {
    const catalog = realCatalog();
    expect(inferCodexSectionLabel({ stem: "Hyomen", content: rule("Hyomen"), catalog })).toBe("Species");
    expect(inferCodexSectionLabel({ stem: "Science", content: rule("Science"), catalog })).toBe("Paradigm");
    expect(inferCodexSectionLabel({ stem: "Nexus_Ascendency", content: rule("Nexus_Ascendency"), catalog })).toBe("Background");
    expect(inferCodexSectionLabel({ stem: "Species_Compendium", content: rule("Species_Compendium"), catalog })).toBe("Species");
    expect(inferCodexSectionLabel({ stem: "What_is_a_Paradigm", content: rule("What_is_a_Paradigm"), catalog })).toBe("Paradigm");
    expect(inferCodexSectionLabel({ stem: "Science_Ciphers", content: "# Science Ciphers", catalog })).toBeUndefined();
  });

  it("keeps an explicit section choice ahead of inference", () => {
    expect(inferCodexSectionLabel({ stem: "Hyomen", content: rule("Hyomen"), label: "Lineages", catalog: realCatalog() })).toBe("Lineages");
  });

  it("does not treat Object prototype names as inferred sections", () => {
    const catalog: MechanicScaffoldCatalog = { species: [], paradigms: [], backgrounds: [] };
    expect(inferCodexSectionLabel({ stem: "Constructor", content: rule("Constructor"), kind: "Page", catalog })).toBeUndefined();
    expect(inferCodexSectionLabel({ stem: "Unrelated", content: "# Unrelated", kind: "constructor", catalog })).toBeUndefined();
  });
});
