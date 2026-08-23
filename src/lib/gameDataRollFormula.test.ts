// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseRollFormulaPage, setCodexRollFormulas } from "../game/rollFormula";
import { attributeRollProfile, rollAttribute } from "../game/wte";
import {
  campaignCodexRevision,
  clearRoomCodex,
  installRoomCodex,
  type CampaignCodexPage,
  type CampaignCodexSnapshot,
} from "./campaignCodex";
import { DEFAULT_RULES } from "./campaignRules";
import { loadCodexGameData } from "./gameData";

const CAMPAIGN = "formula-table";

beforeEach(() => {
  clearRoomCodex();
  setCodexRollFormulas([]);
  delete window.__TAURI__;
});

afterEach(() => {
  clearRoomCodex();
  setCodexRollFormulas([]);
  vi.restoreAllMocks();
});

describe("campaign snapshot Roll Formula compilation", () => {
  it("compiles the joined Curator's pulled formula into the player's roll pipeline", async () => {
    const pages: CampaignCodexPage[] = [{
      id: "campaign.formula-table.formula.attribute-check",
      stem: "attribute-check",
      title: "Attribute Check",
      kind: "roll-formula",
      content: `# Attribute Check

| Type | Roll Formula |
| Target | Attribute |
| Die | 10 |
| Modifier | score - 12 |`,
      visibility: "player",
      pulled: true,
      source: "campaign",
      ownerId: CAMPAIGN,
    }];
    const snapshot: CampaignCodexSnapshot = {
      schema: 1,
      campaignId: CAMPAIGN,
      campaignName: "Formula Table",
      revision: campaignCodexRevision(pages, DEFAULT_RULES, []),
      generatedAt: 1,
      rules: { ...DEFAULT_RULES },
      ruleLayers: [],
      pages,
    };
    installRoomCodex(snapshot);

    await loadCodexGameData();
    vi.spyOn(Math, "random").mockReturnValue(0); // d10 = 1
    const roll = rollAttribute("Strength", 5);

    expect(roll.detail).toMatchObject({ die: 10, modifier: -7 });
    expect(roll.result).toBe(-6);
  });

  it("rejects an invalid visible formula before replacing the last coherent registry", async () => {
    const baseline = parseRollFormulaPage(`# Baseline

| Type | Roll Formula |
| Target | Attribute |
| Die | 6 |
| Modifier | -4 |`, "baseline");
    if (!baseline?.ok) throw new Error("baseline formula did not parse");
    setCodexRollFormulas([baseline.formula]);

    const pages: CampaignCodexPage[] = [{
      id: "campaign.formula-table.formula.invalid",
      stem: "invalid-formula",
      title: "Invalid Formula",
      kind: "roll-formula",
      content: `# Invalid Formula

| Type | Roll Formula |
| Target | Attribute |
| Die | 20 |
| Modifier | score + browserSecret |`,
      visibility: "player",
      pulled: true,
      source: "campaign",
      ownerId: CAMPAIGN,
    }];
    installRoomCodex({
      schema: 1,
      campaignId: CAMPAIGN,
      campaignName: "Formula Table",
      revision: campaignCodexRevision(pages, DEFAULT_RULES, []),
      generatedAt: 2,
      rules: { ...DEFAULT_RULES },
      ruleLayers: [],
      pages,
    });

    await expect(loadCodexGameData()).rejects.toThrow(/Unknown variable "browsersecret"/);
    vi.spyOn(Math, "random").mockReturnValue(0); // retained d6 = 1
    expect(rollAttribute("Strength", 20)).toMatchObject({ result: -3, detail: { die: 6, modifier: -4 } });
  });

  it("resolves same-layer formula conflicts by stable id instead of page enumeration order", async () => {
    const formulaPage = (suffix: string, modifier: number): CampaignCodexPage => ({
      id: `campaign.formula-table.formula.${suffix}`,
      stem: `attribute-${suffix}`,
      title: `Attribute ${suffix}`,
      kind: "roll-formula",
      content: `# Attribute ${suffix}

| Type | Roll Formula |
| ID | campaign.formula-table.formula.${suffix} |
| Target | Attribute |
| Die | 20 |
| Modifier | ${modifier} |`,
      visibility: "player",
      pulled: true,
      source: "campaign",
      ownerId: CAMPAIGN,
    });
    const alpha = formulaPage("alpha", -1);
    const omega = formulaPage("omega", -9);
    const install = async (pages: CampaignCodexPage[]) => {
      const next: CampaignCodexSnapshot = {
        schema: 1,
        campaignId: CAMPAIGN,
        campaignName: "Formula Table",
        revision: campaignCodexRevision(pages, DEFAULT_RULES, []),
        generatedAt: 3,
        rules: { ...DEFAULT_RULES },
        ruleLayers: [],
        pages,
      };
      installRoomCodex(next);
      await loadCodexGameData();
      return attributeRollProfile(10).modifier;
    };

    expect(await install([omega, alpha])).toBe(-9);
    clearRoomCodex();
    expect(await install([alpha, omega])).toBe(-9);
  });
});
