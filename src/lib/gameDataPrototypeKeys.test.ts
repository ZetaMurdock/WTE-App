// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import {
  ciphersForParadigm,
  genusForParadigm,
  registerCodexGameData,
  usableRacial,
} from "../game/wte";
import {
  campaignCodexRevision,
  clearRoomCodex,
  installRoomCodex,
  type CampaignCodexPage,
  type CampaignCodexSnapshot,
} from "./campaignCodex";
import { DEFAULT_RULES } from "./campaignRules";
import { loadCodexGameData } from "./gameData";

const CAMPAIGN = "prototype-keys";

function page(kind: string, stem: string, content: string): CampaignCodexPage {
  return {
    id: `campaign.${CAMPAIGN}.${kind}.${stem}`,
    stem,
    title: stem,
    kind,
    content,
    visibility: "player",
    pulled: true,
    source: "campaign",
    ownerId: CAMPAIGN,
  };
}

afterEach(() => {
  clearRoomCodex();
  registerCodexGameData({});
});

describe("Codex mechanic dictionaries", () => {
  it("treats constructor as authored data for domains, paradigms, and species ids", async () => {
    const pages = [
      page("paradigm", "constructor", `# Constructor Paradigm

| Type | Paradigm |
| ID | campaign.prototype-keys.paradigm.constructor |
| Name | Constructor Paradigm |
| Domains | constructor |`),
      page("species", "constructor", `# Constructor Species

| Type | Species |
| ID | campaign.prototype-keys.species.constructor |
| Name | Constructor Species |
| Family | Humanity |
| Innate | Campaign Innate |`),
      page("genus", "constructor-genus", `# Constructor Genus

| Type | Genus |
| ID | campaign.prototype-keys.genus.constructor-genus |
| Name | Constructor Genus |
| Domain | constructor |
| SS | 1 |`),
      page("cipher", "constructor-cipher", `# Constructor Cipher

| Type | Cipher |
| Name | Constructor Cipher |
| Paradigm | constructor |
| SS | 2 |`),
    ];
    const snapshot: CampaignCodexSnapshot = {
      schema: 1,
      campaignId: CAMPAIGN,
      campaignName: "Prototype Keys",
      revision: campaignCodexRevision(pages, DEFAULT_RULES, []),
      generatedAt: 1,
      rules: { ...DEFAULT_RULES },
      ruleLayers: [],
      pages,
    };
    installRoomCodex(snapshot);

    await expect(loadCodexGameData()).resolves.toBeUndefined();
    expect(genusForParadigm("constructor").flatMap((group) => group.abilities).map((ability) => ability.name))
      .toContain("Constructor Genus");
    expect(ciphersForParadigm("constructor").map((ability) => ability.name)).toContain("Constructor Cipher");
    expect(usableRacial("constructor").map((ability) => ability.name)).toContain("Campaign Innate");
  });
});
