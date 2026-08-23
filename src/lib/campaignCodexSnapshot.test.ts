// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StoredCodexPage } from "./codexPageRepo";

vi.mock("./codexPageRepo", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./codexPageRepo")>();
  return { ...actual, listCodexPages: vi.fn() };
});

import { listCodexPages } from "./codexPageRepo";
import {
  buildCampaignCodexSnapshot,
  cachedCampaignCodexSnapshot,
  invalidatePageFileCache,
} from "./campaignCodex";

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

  it.each(["constructor", "toString", "__proto__"])(
    "keeps the prototype-like kind %s under a valid generic page id",
    async (kind) => {
      vi.mocked(listCodexPages).mockResolvedValue([storedPage("prototype-key", kind)]);

      const snapshot = await buildCampaignCodexSnapshot(CAMPAIGN_ID);

      expect(snapshot.pages).toHaveLength(1);
      expect(snapshot.pages[0].id).toBe("wte.page.prototype-key");
      expect(snapshot.pages[0].id).not.toMatch(/function|\[object/i);
    }
  );
});

describe("built-in pages stay on the Curator's side", () => {
  it("ships the compiled catalog to the Curator, separate from stored pages", async () => {
    const snapshot = await buildCampaignCodexSnapshot(CAMPAIGN_ID, "Alpha");
    expect(snapshot.pages).toHaveLength(0);
    expect(snapshot.builtIn?.length).toBeGreaterThan(0);
    expect(snapshot.builtIn?.every((page) => page.builtIn && !page.pulled)).toBe(true);
    expect(snapshot.builtIn?.some((page) => page.id === "wte.species.oriyu")).toBe(true);
  });

  it("sends none of it to a player", async () => {
    // The player's own installation holds the same compiled data. Shipping it
    // would be duplication, and it encodes no decision this campaign made.
    const wire = await buildCampaignCodexSnapshot(CAMPAIGN_ID, "Alpha", { playerOnly: true });
    expect(wire.builtIn).toEqual([]);
    expect(wire.pages.some((page) => page.builtIn)).toBe(false);
  });

  it("does not let the compiled catalog move the revision", async () => {
    // Otherwise every app update that touched a lineage would look to every
    // joined table like the Curator had rewritten their rules.
    const curator = await buildCampaignCodexSnapshot(CAMPAIGN_ID, "Alpha");
    const wire = await buildCampaignCodexSnapshot(CAMPAIGN_ID, "Alpha", { playerOnly: true });
    expect(curator.revision).toBe(wire.revision);
  });
});

describe("reading the page files", () => {
  function tauriWith(invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>) {
    window.__TAURI__ = { core: { invoke } } as never;
  }

  beforeEach(() => {
    invalidatePageFileCache();
  });

  it("reads every page in one call instead of one call per page", async () => {
    // 321 pages meant 321 IPC round trips, each re-walking the rules directory
    // to resolve a single stem. This is the whole reason the panel was slow.
    const calls: string[] = [];
    tauriWith(async (cmd) => {
      calls.push(cmd);
      if (cmd === "wte_load_all_pages") {
        return [["Alpha", "# Alpha"], ["Beta", "# Beta"]];
      }
      throw new Error(`unexpected ${cmd}`);
    });

    const snapshot = await buildCampaignCodexSnapshot(CAMPAIGN_ID, "Alpha");
    expect(calls).toEqual(["wte_load_all_pages"]);
    expect(snapshot.pages.map((p) => p.stem).sort()).toEqual(["Alpha", "Beta"]);
  });

  it("falls back to per-page loads against a binary without the batch command", async () => {
    // A dev session or a partial update can leave a newer frontend talking to an
    // older binary; losing the entire Codex would be a bad way to find out.
    const calls: string[] = [];
    tauriWith(async (cmd, args) => {
      calls.push(cmd);
      if (cmd === "wte_load_all_pages") throw new Error("unknown command");
      if (cmd === "wte_list_pages") return ["Alpha", "Beta"];
      if (cmd === "wte_load_page") return `# ${String(args?.path)}`;
      throw new Error(`unexpected ${cmd}`);
    });

    const snapshot = await buildCampaignCodexSnapshot(CAMPAIGN_ID, "Alpha");
    expect(calls).toEqual(["wte_load_all_pages", "wte_list_pages", "wte_load_page", "wte_load_page"]);
    expect(snapshot.pages.map((p) => p.stem).sort()).toEqual(["Alpha", "Beta"]);
  });

  it("does not re-read the files for a second build", async () => {
    let reads = 0;
    tauriWith(async (cmd) => {
      if (cmd === "wte_load_all_pages") {
        reads++;
        return [["Alpha", "# Alpha"]];
      }
      throw new Error(`unexpected ${cmd}`);
    });

    await buildCampaignCodexSnapshot(CAMPAIGN_ID, "Alpha");
    await buildCampaignCodexSnapshot(CAMPAIGN_ID, "Alpha");
    expect(reads).toBe(1);
  });

  it("shares one read between builds that race", async () => {
    let reads = 0;
    tauriWith(async (cmd) => {
      if (cmd === "wte_load_all_pages") {
        reads++;
        return [["Alpha", "# Alpha"]];
      }
      throw new Error(`unexpected ${cmd}`);
    });

    // The dashboard and the game-data loader both build on mount.
    await Promise.all([
      buildCampaignCodexSnapshot(CAMPAIGN_ID, "Alpha"),
      buildCampaignCodexSnapshot(CAMPAIGN_ID, "Alpha"),
    ]);
    expect(reads).toBe(1);
  });

  it("re-reads once a page change is announced", async () => {
    let body = "# Alpha";
    let reads = 0;
    tauriWith(async (cmd) => {
      if (cmd === "wte_load_all_pages") {
        reads++;
        return [["Alpha", body]];
      }
      throw new Error(`unexpected ${cmd}`);
    });

    await buildCampaignCodexSnapshot(CAMPAIGN_ID, "Alpha");
    body = "# Alpha Revised";
    window.dispatchEvent(new Event("wte-pages-changed"));
    const after = await buildCampaignCodexSnapshot(CAMPAIGN_ID, "Alpha");
    expect(reads).toBe(2);
    expect(after.pages[0].title).toBe("Alpha Revised");
  });

  it("keeps the last manifest available to paint immediately", async () => {
    tauriWith(async (cmd) => {
      if (cmd === "wte_load_all_pages") return [["Alpha", "# Alpha"]];
      throw new Error(`unexpected ${cmd}`);
    });

    // A campaign no earlier test has built, so "nothing cached yet" is real.
    const fresh = "campaign-never-built";
    expect(cachedCampaignCodexSnapshot(fresh)).toBeNull();
    const built = await buildCampaignCodexSnapshot(fresh, "Alpha");
    expect(cachedCampaignCodexSnapshot(fresh)?.revision).toBe(built.revision);
    // A different campaign has its own, and must never borrow this one's.
    expect(cachedCampaignCodexSnapshot("some-other-campaign")).toBeNull();
  });
});
