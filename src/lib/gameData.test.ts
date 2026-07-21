import { describe, expect, it } from "vitest";
import { parseSpeciesPage } from "./gameData";
import { ATTRIBUTES } from "../game/wte";

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

describe("attribute display names", () => {
  it("shows Strength, not Physical — the key on saved sheets stays `phy`", () => {
    const str = ATTRIBUTES.find((a) => a.key === "phy");
    expect(str?.label).toBe("Strength");
    expect(str?.short).toBe("STR");
  });
});
