// @vitest-environment happy-dom
//
// A campaign carrying pages of a kind the receiving build has never heard of
// must still agree with that build on the campaign's revision.
//
// The revision is how two peers decide whether they are holding the same rules.
// If a page of a NEW kind hashes differently on an old build — because it was
// dropped from the hash, or because the two builds derive different ids for it —
// then the host publishes `c28-xyz`, the player recomputes `c27-abc`, and
// `parseCampaignCodexSnapshot` rejects the document. The table splits, and it
// splits for a reason nobody can see: the player's app is simply older.
//
// The Conditions registry is the first kind added since that machinery existed,
// so this is where the guarantee gets nailed down. Every assertion here is
// really about ANY future kind; `condition` is the current witness.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StoredCodexPage } from "./codexPageRepo";

vi.mock("./codexPageRepo", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./codexPageRepo")>();
  return { ...actual, listCodexPages: vi.fn() };
});

import { listCodexPages } from "./codexPageRepo";
import {
  buildCampaignCodexSnapshot,
  campaignCodexRevision,
  parseCampaignCodexSnapshot,
  type CampaignCodexPage,
} from "./campaignCodex";

const CAMPAIGN_ID = "campaign-alpha";

function conditionPage(stem: string, rows: string[] = []): StoredCodexPage {
  return {
    id: "",
    campaignId: "",
    stem,
    kind: "",
    title: stem,
    content: [
      `# ${stem}`,
      "",
      "| Type | Condition |",
      ...rows,
      "| Stacking | refresh |",
      "| Visibility | player |",
      "",
      "## Effect",
      "The target is slowed to a crawl.",
    ].join("\n"),
    visibility: "player",
    aliases: [],
    updatedAt: 1,
  };
}

/**
 * The same document as seen by a build that has never heard of this kind.
 *
 * An old build reads exactly these fields off the wire and recomputes the hash
 * from them — `parseCampaignCodexSnapshot` does it field by field, and the kind
 * is carried through as an opaque string. Rebuilding the array here is that
 * build's view, so a revision computed from it is what the old peer will get.
 */
function asReceivedByAnOlderBuild(pages: CampaignCodexPage[]): CampaignCodexPage[] {
  return pages.map((page) => ({
    id: page.id,
    stem: page.stem,
    title: page.title,
    kind: page.kind,
    label: page.label,
    content: page.content,
    visibility: page.visibility,
    pulled: page.pulled,
    source: page.source,
    ownerId: page.ownerId,
    overrides: page.overrides,
    updatedAt: page.updatedAt,
  }));
}

beforeEach(() => {
  localStorage.clear();
  delete window.__TAURI__;
  vi.mocked(listCodexPages).mockReset().mockResolvedValue([]);
});

describe("a page of an unknown kind does not split the table", () => {
  it("derives the same identity for an unpinned condition page as a build without the kind", async () => {
    // `officialFallbackKind` deliberately does NOT know `condition`, so both
    // builds land on `wte.page.<stem>`. Adding `condition` to that map would be
    // the split: the new build would derive `wte.condition.slowed` while every
    // older peer derived `wte.page.slowed`, and the two hashes would disagree
    // for identical bytes. Shipped condition pages pin their own id instead,
    // which every build already parses because `condition` has always been a
    // valid IdKind.
    vi.mocked(listCodexPages).mockResolvedValue([conditionPage("slowed")]);

    const snapshot = await buildCampaignCodexSnapshot(CAMPAIGN_ID);

    expect(snapshot.pages[0]).toMatchObject({ id: "wte.page.slowed", kind: "condition" });
  });

  it("keeps a pinned condition id, which older builds parse unchanged", async () => {
    vi.mocked(listCodexPages).mockResolvedValue([
      conditionPage("condition-slowed", ["| ID | wte.condition.slowed |"]),
    ]);

    const snapshot = await buildCampaignCodexSnapshot(CAMPAIGN_ID);

    expect(snapshot.pages[0].id).toBe("wte.condition.slowed");
  });

  it("computes the same revision on a build that does not know the kind", async () => {
    vi.mocked(listCodexPages).mockResolvedValue([
      conditionPage("condition-slowed", ["| ID | wte.condition.slowed |"]),
      conditionPage("condition-burning", ["| ID | wte.condition.burning |"]),
      conditionPage("house-tag"),
    ]);

    const snapshot = await buildCampaignCodexSnapshot(CAMPAIGN_ID, "Alpha Table", { playerOnly: true });
    const older = campaignCodexRevision(
      asReceivedByAnOlderBuild(snapshot.pages),
      snapshot.rules,
      snapshot.ruleLayers
    );

    expect(older).toBe(snapshot.revision);
  });

  it("accepts the wire document and keeps every unknown-kind page in it", async () => {
    vi.mocked(listCodexPages).mockResolvedValue([
      conditionPage("condition-slowed", ["| ID | wte.condition.slowed |"]),
      conditionPage("condition-burning", ["| ID | wte.condition.burning |"]),
    ]);

    const snapshot = await buildCampaignCodexSnapshot(CAMPAIGN_ID, "Alpha Table", { playerOnly: true });
    // Through JSON, because that is how the document actually arrives.
    const received = parseCampaignCodexSnapshot(JSON.parse(JSON.stringify(snapshot)), CAMPAIGN_ID);

    expect(received).not.toBeNull();
    expect(received!.revision).toBe(snapshot.revision);
    expect(received!.pages.map((page) => page.id)).toEqual([
      "wte.condition.slowed",
      "wte.condition.burning",
    ]);
    // The kind survives as written. A receiver that silently normalized it to
    // "page" would validate its own document and reject the host's.
    expect(received!.pages.every((page) => page.kind === "condition")).toBe(true);
  });

  it("hashes unknown-kind pages rather than skipping them", async () => {
    // The other way this could have been made consistent is to exclude unknown
    // kinds from the hash on both sides. It is not what the code does, and this
    // pins the choice: dropping a condition page has to move the revision, or a
    // Curator could rewrite every condition at the table and no player would be
    // told to resync.
    const pages = [
      conditionPage("condition-slowed", ["| ID | wte.condition.slowed |"]),
      conditionPage("condition-burning", ["| ID | wte.condition.burning |"]),
    ];
    vi.mocked(listCodexPages).mockResolvedValue(pages);
    const both = await buildCampaignCodexSnapshot(CAMPAIGN_ID, "Alpha Table", { playerOnly: true });

    vi.mocked(listCodexPages).mockResolvedValue([pages[0]]);
    const one = await buildCampaignCodexSnapshot(CAMPAIGN_ID, "Alpha Table", { playerOnly: true });

    expect(one.revision).not.toBe(both.revision);
  });
});
