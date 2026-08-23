// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StoredCodexPage } from "./codexPageRepo";

vi.mock("./codexPageRepo", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./codexPageRepo")>();
  return { ...actual, listCodexPages: vi.fn() };
});

import { listCodexPages } from "./codexPageRepo";
import { buildCampaignCodexSnapshot } from "./campaignCodex";

const CAMPAIGN_ID = "campaign-alpha";

function storedPage(
  stem: string,
  type: string,
  content = `# ${stem}\n\n| Type | ${type} |`
): StoredCodexPage {
  return {
    id: "",
    campaignId: "",
    stem,
    kind: type,
    title: stem,
    content,
    visibility: "player",
    aliases: [],
    updatedAt: 1,
  };
}

beforeEach(() => {
  localStorage.clear();
  delete window.__TAURI__;
  vi.mocked(listCodexPages).mockReset().mockResolvedValue([]);
});

describe("campaign Codex snapshot preflight", () => {
  it("refuses a pulled player-visible Roll Formula that the shared parser rejects", async () => {
    vi.mocked(listCodexPages).mockResolvedValue([
      storedPage("unsafe-attribute", "Roll Formula", `# Unsafe Attribute

| Type | Roll Formula |
| Target | Attribute |
| Die | 20 |
| Modifier | score + unknownVariable |`),
    ]);

    await expect(
      buildCampaignCodexSnapshot(CAMPAIGN_ID, "Alpha Table", { playerOnly: true })
    ).rejects.toThrow(/Roll Formula page .* is invalid:.*unknownVariable/i);
  });

  it("does not preflight a Curator-only formula that is excluded from the player snapshot", async () => {
    vi.mocked(listCodexPages).mockResolvedValue([
      {
        ...storedPage("curator-formula", "Roll Formula", `# Curator Formula

| Type | Roll Formula |
| Target | Attribute |
| Die | 20 |
| Modifier | unknownVariable |`),
        visibility: "curator",
      },
    ]);

    await expect(
      buildCampaignCodexSnapshot(CAMPAIGN_ID, "Alpha Table", { playerOnly: true })
    ).resolves.toMatchObject({ pages: [] });
  });
});

describe("official fallback identities", () => {
  it("derives semantic ids for mechanic kinds and keeps generic lore under page", async () => {
    vi.mocked(listCodexPages).mockResolvedValue([
      storedPage("lineage", "Species"),
      storedPage("seer", "Paradigm"),
      storedPage("scout", "Background"),
      storedPage("arc-blade", "Weapon"),
      storedPage("utility-rig", "Equipment"),
      storedPage("field-kit", "Gear"),
      storedPage("attribute-roll", "Roll Formula", `# Attribute Roll

| Type | Roll Formula |
| Target | Attribute |
| Die | 20 |
| Modifier | score |`),
      storedPage("chronicle", "Lore"),
    ]);

    const snapshot = await buildCampaignCodexSnapshot(CAMPAIGN_ID);
    const ids = Object.fromEntries(snapshot.pages.map((page) => [page.stem, page.id]));

    expect(ids).toEqual({
      lineage: "wte.species.lineage",
      seer: "wte.paradigm.seer",
      scout: "wte.background.scout",
      "arc-blade": "wte.weapon.arc-blade",
      "utility-rig": "wte.gear.utility-rig",
      "field-kit": "wte.gear.field-kit",
      "attribute-roll": "wte.formula.attribute-roll",
      chronicle: "wte.page.chronicle",
    });
  });
});
