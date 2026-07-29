// @vitest-environment happy-dom
//
// Per-campaign Codex page storage.
//
// The property this table exists for: two campaigns can hold DIFFERENT versions
// of the same page. With one file per stem, the second table's rewrite simply
// overwrote the first table's, and there was no way to notice.
import { beforeEach, describe, expect, it, vi } from "vitest";

interface Row {
  id: string;
  campaign_id: string;
  stem: string;
  kind: string | null;
  title: string;
  content: string;
  visibility: string | null;
  aliases: string | null;
  overrides: string | null;
  updated_at: number;
}

let rows: Row[] = [];
let hasTable = true;

const fakeDb = {
  select: async <T>(sql: string, args: unknown[] = []): Promise<T> => {
    if (/sqlite_master/.test(sql)) return (hasTable ? [{ name: "codex_pages" }] : []) as unknown as T;
    if (/campaign_id = \$1 OR campaign_id = \$2/.test(sql)) {
      return rows.filter((r) => r.campaign_id === args[0] || r.campaign_id === args[1]) as unknown as T;
    }
    if (/WHERE campaign_id = \$1/.test(sql)) return rows.filter((r) => r.campaign_id === args[0]) as unknown as T;
    return rows as unknown as T;
  },
  execute: async (sql: string, args: unknown[] = []) => {
    if (/^INSERT INTO codex_pages/.test(sql)) {
      const [id, campaign_id, stem, kind, title, content, visibility, aliases, overrides, updated_at] = args as [
        string, string, string, string | null, string, string, string, string, string | null, number,
      ];
      const next: Row = { id, campaign_id, stem, kind, title, content, visibility, aliases, overrides, updated_at };
      const at = rows.findIndex((r) => r.id === id);
      if (at >= 0) rows[at] = next;
      else rows.push(next);
    } else if (/DELETE FROM codex_pages WHERE id/.test(sql)) {
      rows = rows.filter((r) => r.id !== args[0]);
    } else if (/DELETE FROM codex_pages WHERE campaign_id/.test(sql)) {
      rows = rows.filter((r) => r.campaign_id !== args[0]);
    }
    return { rowsAffected: 1 };
  },
};

vi.mock("./db", () => ({ getDb: async () => fakeDb, sqlAvailable: () => true }));

const {
  GLOBAL_OWNER,
  ForeignPageError,
  listCodexPages,
  listOwnedCodexPages,
  saveCodexPage,
  deleteCodexPage,
  deleteCampaignCodexPages,
  __resetCodexPageRepo,
} = await import("./codexPageRepo");

const A = "8a93a397-4c21-4a6e-9d0b-1f2e3a4b5c6d";
const B = "e25cc744-1111-2222-3333-444455556666";

const page = (over: Partial<Parameters<typeof saveCodexPage>[0]> = {}) => ({
  id: "wte.genus.lark",
  campaignId: GLOBAL_OWNER,
  stem: "Lark",
  title: "Lark",
  content: "# Lark",
  visibility: "player" as const,
  aliases: [],
  updatedAt: 1,
  ...over,
});

beforeEach(() => {
  rows = [];
  hasTable = true;
  __resetCodexPageRepo();
});

describe("two campaigns can hold different versions of one page", () => {
  it("stores a per-campaign version beside the global one", async () => {
    await saveCodexPage(page());
    await saveCodexPage(page({ id: `campaign.${A}.genus.lark`, campaignId: A, content: "# Lark (Ashen Sun)" }));
    await saveCodexPage(page({ id: `campaign.${B}.genus.lark`, campaignId: B, content: "# Lark (Other table)" }));
    expect(rows).toHaveLength(3);
  });

  it("shows each campaign only its own version", async () => {
    await saveCodexPage(page());
    await saveCodexPage(page({ id: `campaign.${A}.genus.lark`, campaignId: A, content: "# A" }));
    await saveCodexPage(page({ id: `campaign.${B}.genus.lark`, campaignId: B, content: "# B" }));

    const forA = await listCodexPages(A);
    expect(forA.filter((p) => p.stem === "Lark")).toHaveLength(1);
    expect(forA.find((p) => p.stem === "Lark")!.content).toBe("# A");

    const forB = await listCodexPages(B);
    expect(forB.find((p) => p.stem === "Lark")!.content).toBe("# B");
  });

  it("a campaign version SHADOWS the global one rather than sitting beside it", async () => {
    // Two versions of one page in one list is an ambiguity the resolver would
    // have to refuse, and here the answer is obvious.
    await saveCodexPage(page());
    await saveCodexPage(page({ id: `campaign.${A}.genus.lark`, campaignId: A, content: "# A" }));
    expect((await listCodexPages(A)).filter((p) => p.stem === "Lark")).toHaveLength(1);
  });

  it("leaves the global page in force for a campaign that has not replaced it", async () => {
    await saveCodexPage(page());
    await saveCodexPage(page({ id: `campaign.${A}.genus.lark`, campaignId: A, content: "# A" }));
    expect((await listCodexPages(B)).find((p) => p.stem === "Lark")!.content).toBe("# Lark");
  });

  it("exports only what a campaign actually owns", async () => {
    await saveCodexPage(page());
    await saveCodexPage(page({ id: `campaign.${A}.genus.lark`, campaignId: A }));
    const owned = await listOwnedCodexPages(A);
    expect(owned).toHaveLength(1);
    expect(owned[0].campaignId).toBe(A);
  });
});

describe("the store refuses a page it would be re-owning", () => {
  it("rejects a page whose id names a different campaign", async () => {
    await expect(
      saveCodexPage(page({ id: `campaign.${B}.genus.lark`, campaignId: A }))
    ).rejects.toBeInstanceOf(ForeignPageError);
    expect(rows).toHaveLength(0);
  });

  it("rejects a campaign-scoped id stored globally", async () => {
    await expect(
      saveCodexPage(page({ id: `campaign.${A}.genus.lark`, campaignId: GLOBAL_OWNER }))
    ).rejects.toBeInstanceOf(ForeignPageError);
  });

  it("accepts one whose id names its own campaign", async () => {
    await saveCodexPage(page({ id: `campaign.${A}.genus.lark`, campaignId: A }));
    expect(rows).toHaveLength(1);
  });

  it("accepts an official id stored globally", async () => {
    await saveCodexPage(page());
    expect(rows).toHaveLength(1);
  });
});

describe("visibility fails closed", () => {
  it("treats an unreadable visibility as Curator-only", async () => {
    // A page whose setting cannot be read might be the hidden one, and showing
    // it is the mistake that cannot be undone.
    rows.push({ ...(page() as unknown as Row), campaign_id: "", visibility: "nonsense", aliases: null, overrides: null, kind: null, updated_at: 1 });
    expect((await listCodexPages(A))[0].visibility).toBe("curator");
  });

  it("reads a stated visibility as stated", async () => {
    await saveCodexPage(page({ visibility: "curator" }));
    expect((await listCodexPages(A))[0].visibility).toBe("curator");
    await saveCodexPage(page({ visibility: "player" }));
    expect((await listCodexPages(A))[0].visibility).toBe("player");
  });

  it("survives a malformed alias list without losing the page", async () => {
    await saveCodexPage(page({ aliases: ["Old Name"] }));
    rows[0].aliases = "{not json";
    const back = await listCodexPages(A);
    expect(back).toHaveLength(1);
    expect(back[0].aliases).toEqual([]);
  });
});

describe("a database without the table is a supported state", () => {
  it("reports no stored pages rather than failing", async () => {
    hasTable = false;
    __resetCodexPageRepo();
    expect(await listCodexPages(A)).toEqual([]);
    expect(await listOwnedCodexPages(A)).toEqual([]);
  });

  it("refuses to save, and says why, rather than silently dropping the page", async () => {
    hasTable = false;
    __resetCodexPageRepo();
    await expect(saveCodexPage(page())).rejects.toThrow(/no Codex page store/);
  });

  it("does not treat deleting from a missing table as a failure", async () => {
    hasTable = false;
    __resetCodexPageRepo();
    await expect(deleteCodexPage("x")).resolves.toBeUndefined();
  });
});

describe("undoing a copy import", () => {
  it("removes every page the campaign owned and nothing else", async () => {
    await saveCodexPage(page());
    await saveCodexPage(page({ id: `campaign.${A}.genus.lark`, campaignId: A }));
    await saveCodexPage(page({ id: `campaign.${B}.genus.lark`, campaignId: B }));
    await deleteCampaignCodexPages(A);
    expect(rows.map((r) => r.campaign_id).sort()).toEqual(["", B]);
  });
});
