import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parseBackgroundsDirectory, parseSpeciesDefinitionPage, parseSpeciesPage } from "./gameData";
import { ATTRIBUTES, getSpecies, registerCodexGameData } from "../game/wte";

const page = (bonuses: string) => `# Test Species

| Type | Species |
| Name | Test Species |
| Family | Humanity |
| Bonuses | ${bonuses} |
| Size | moderate |
`;

describe("Codex species bonuses", () => {
  it("reads the current STR spelling", () => {
    expect(parseSpeciesPage(page("STR +2, END +1"), "test")?.bonuses).toMatchObject({ phy: 2, end: 1 });
  });

  it("still reads PHY — every Codex page and homebrew pack written before v0.8.37 says PHY", () => {
    expect(parseSpeciesPage(page("PHY +2, END +1"), "test")?.bonuses).toMatchObject({ phy: 2, end: 1 });
  });

  it("reads either spelling in the reversed '+2 STR' form", () => {
    expect(parseSpeciesPage(page("+3 STR"), "test")?.bonuses).toMatchObject({ phy: 3 });
    expect(parseSpeciesPage(page("+3 PHY"), "test")?.bonuses).toMatchObject({ phy: 3 });
  });

  it("keeps negatives and leaves 'none' empty", () => {
    expect(parseSpeciesPage(page("STR -2, DEX +1"), "test")?.bonuses).toMatchObject({ phy: -2, dex: 1 });
    expect(parseSpeciesPage(page("None"), "test")?.bonuses).toEqual({});
  });
});

describe("partial Species campaign overlays", () => {
  afterEach(() => registerCodexGameData({}));

  it("keeps Hyomen variants, genetic values, eminence, and innate selection when rows are omitted", () => {
    registerCodexGameData({});
    const official = getSpecies("hyomen")!;
    const definition = parseSpeciesDefinitionPage(`# Hyomen Rebalanced

| Type | Species |
| ID | campaign.ashen-sun.species.hyomen |
| Overrides | wte.species.hyomen |
| Name | Hyomen Rebalanced |
| Bonuses | STR +3 |`, "Hyomen");
    expect(definition).not.toBeNull();

    registerCodexGameData({ species: [definition!] });
    expect(getSpecies("hyomen")).toMatchObject({
      name: "Hyomen Rebalanced",
      bonuses: { phy: 3 },
      dom: official.dom,
      rec: official.rec,
      eminence: official.eminence,
      innateSelect: official.innateSelect,
      innate: official.innate,
      variants: official.variants,
    });
  });

  it("honors the extended rows when they are explicitly represented", () => {
    const definition = parseSpeciesDefinitionPage(`# Hyomen Rebalanced

| Type | Species |
| Overrides | wte.species.hyomen |
| Name | Hyomen Rebalanced |
| Dominance | 12 |
| Recessiveness | 34 |
| Eminence Nature | Feral +9 |
| Innate Select | 1 |

## Variants
`, "Hyomen");
    registerCodexGameData({ species: [definition!] });
    expect(getSpecies("hyomen")).toMatchObject({ dom: 12, rec: 34, eminence: "Feral +9", innateSelect: 1, variants: [] });
  });
});

describe("attribute display names", () => {
  it("shows Strength, not Physical — the key on saved sheets stays `phy`", () => {
    const str = ATTRIBUTES.find((a) => a.key === "phy");
    expect(str?.label).toBe("Strength");
    expect(str?.short).toBe("STR");
  });
});

describe("bundled official character data", () => {
  it("parses the shipped Backgrounds directory that now feeds every campaign", () => {
    const markdown = fs.readFileSync(path.resolve(__dirname, "../rules/Backgrounds.md"), "utf8");
    const backgrounds = parseBackgroundsDirectory(markdown);

    expect(backgrounds.length).toBeGreaterThan(10);
    expect(backgrounds).toContainEqual(expect.objectContaining({
      name: "Nexus Ascendency",
      attrBonus: expect.objectContaining({ wis: 2 }),
      specBonus: expect.objectContaining({ mf: 2, ctrl: 1, ins: 1 }),
    }));
  });
});
