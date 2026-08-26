// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StoredCodexPage } from "./codexPageRepo";
import { activeCodexConditions, resolveCondition, setCodexConditions } from "../game/conditions";
import { codexSkipped } from "../game/codexService";
import {
  campaignCodexRevision,
  clearRoomCodex,
  installRoomCodex,
  type CampaignCodexPage,
  type CampaignCodexSnapshot,
} from "./campaignCodex";
import { DEFAULT_RULES } from "./campaignRules";
import { loadCodexGameData } from "./gameData";
import { setActiveCampaignId } from "./repo";

vi.mock("./codexPageRepo", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./codexPageRepo")>();
  return { ...actual, listCodexPages: vi.fn<() => Promise<StoredCodexPage[]>>(async () => []) };
});

const CAMPAIGN = "condition-table";

function page(overrides: Partial<CampaignCodexPage> & { stem: string; content: string }): CampaignCodexPage {
  return {
    id: `campaign.${CAMPAIGN}.condition.${overrides.stem}`,
    title: overrides.stem,
    kind: "condition",
    visibility: "player",
    pulled: true,
    source: "campaign",
    ownerId: CAMPAIGN,
    ...overrides,
  };
}

async function join(pages: CampaignCodexPage[]): Promise<void> {
  const snapshot: CampaignCodexSnapshot = {
    schema: 1,
    campaignId: CAMPAIGN,
    campaignName: "Condition Table",
    revision: campaignCodexRevision(pages, DEFAULT_RULES, []),
    generatedAt: 1,
    rules: { ...DEFAULT_RULES },
    ruleLayers: [],
    pages,
  };
  installRoomCodex(snapshot);
  await loadCodexGameData();
}

beforeEach(() => {
  clearRoomCodex();
  setCodexConditions([]);
  setActiveCampaignId(null);
  delete window.__TAURI__;
});

afterEach(() => {
  clearRoomCodex();
  setCodexConditions([]);
  setActiveCampaignId(null);
  vi.restoreAllMocks();
});

describe("campaign snapshot Condition compilation", () => {
  it("compiles a joined Curator's condition page into the lookup a tag resolves through", async () => {
    await join([
      page({
        stem: "blighted",
        content: `# Blighted

| Type | Condition |
| Stacking | stack |

## Effect
Chaotic energy fouls the target from the inside; each stack bites deeper.`,
      }),
    ]);

    // The point of the whole registry: a table can define a condition the
    // shipped setting never had, and the app knows what it means.
    expect(resolveCondition("blighted")).toMatchObject({
      name: "Blighted",
      stacking: "stack",
      scope: "campaign",
    });
  });

  it("lets a campaign fork win the name the official rule holds", async () => {
    await join([
      page({
        id: "wte.condition.slowed",
        stem: "condition-slowed",
        source: "official",
        ownerId: undefined,
        content: `# Slowed

| Type | Condition |
| ID | wte.condition.slowed |
| Stacking | refresh |

## Effect
Movement is halved.`,
      }),
      page({
        stem: "slowed-house-rule",
        overrides: "wte.condition.slowed",
        content: `# Slowed

| Type | Condition |
| Stacking | extend |

## Effect
At this table two applications add their rounds together.`,
      }),
    ]);

    expect(resolveCondition("Slowed")).toMatchObject({ scope: "campaign", stacking: "extend" });
  });

  it("skips one unreadable condition page instead of blanking the catalogs beside it", async () => {
    // An invalid Roll Formula stops the whole load, because a formula is
    // arithmetic every roll runs through. A condition is a lookup: reporting it
    // and moving on is the proportionate answer, and the tag simply stays
    // undefined until the Curator fixes the page.
    await join([
      page({
        stem: "nonsense",
        content: `# Nonsense

| Type | Condition |
| Stacking | sometimes |

## Effect
Unclear.`,
      }),
      page({
        stem: "burning",
        content: `# Burning

| Type | Condition |
| Stacking | stack |

## Effect
Each stack deals its own fire damage at the start of the target's turn.`,
      }),
    ]);

    expect(resolveCondition("Burning")).toMatchObject({ stacking: "stack" });
    expect(resolveCondition("Nonsense")).toBeNull();
    expect(codexSkipped()).toEqual(
      expect.arrayContaining([expect.objectContaining({ stem: "nonsense", reason: expect.stringContaining("invalid Condition") })])
    );
  });

  it("clears the registry when a campaign with no mechanic pages is loaded", async () => {
    await join([
      page({
        stem: "anchored",
        content: `# Anchored

| Type | Condition |
| Stacking | refresh |

## Effect
Movement is removed, and anchoring is never voluntary.`,
      }),
    ]);
    expect(activeCodexConditions()).toHaveLength(1);

    await join([]);

    // Switching to a table that defines nothing must not leave the previous
    // table's conditions in force — the same failure the formula registry had.
    expect(activeCodexConditions()).toEqual([]);
    expect(resolveCondition("Anchored")).toBeNull();
  });

  it("clears the registry on the early return a campaign with no pages at all takes", async () => {
    // The empty-snapshot case above still walks the whole loader. A campaign
    // that yields NO pages returns early instead, before the registry is
    // installed, so that branch has to reset the conditions on its own — and it
    // is the branch a Curator reaches by leaving a room and opening a table
    // whose pages are all unpulled or Curator-only.
    await join([
      page({
        stem: "anchored",
        content: `# Anchored

| Type | Condition |
| Stacking | refresh |

## Effect
Movement is removed, and anchoring is never voluntary.`,
      }),
    ]);
    expect(resolveCondition("Anchored")).not.toBeNull();

    clearRoomCodex();
    setActiveCampaignId("empty-table");
    await loadCodexGameData();

    expect(activeCodexConditions()).toEqual([]);
    expect(resolveCondition("Anchored")).toBeNull();
  });
});
