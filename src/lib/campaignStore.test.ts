// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";

interface Row {
  campaign_id: string;
  scope: string;
  key: string;
  value: string;
  updated_at: number;
}
let rows: Row[] = [];
let failNextWrite = false;

let tableExists = true;

const fakeDb = {
  select: async <T>(sql: string, args: unknown[] = []): Promise<T> => {
    if (/sqlite_master/.test(sql)) return (tableExists ? [{ name: "campaign_kv" }] : []) as unknown as T;
    if (/AND scope = \$2 AND key = \$3/.test(sql)) {
      return rows.filter((r) => r.campaign_id === args[0] && r.scope === args[1] && r.key === args[2]) as unknown as T;
    }
    if (/AND scope = \$2/.test(sql)) {
      return rows.filter((r) => r.campaign_id === args[0] && r.scope === args[1]) as unknown as T;
    }
    return rows.filter((r) => r.campaign_id === args[0]) as unknown as T;
  },
  execute: async (sql: string, args: unknown[] = []) => {
    if (failNextWrite) {
      failNextWrite = false;
      throw new Error("disk full");
    }
    if (/INSERT OR REPLACE INTO campaign_kv/.test(sql)) {
      const [campaign_id, scope, key, value, updated_at] = args as [string, string, string, string, number];
      const i = rows.findIndex((r) => r.campaign_id === campaign_id && r.scope === scope && r.key === key);
      const row = { campaign_id, scope, key, value, updated_at };
      if (i >= 0) rows[i] = row;
      else rows.push(row);
    } else if (/DELETE FROM campaign_kv/.test(sql)) {
      rows = rows.filter((r) => !(r.campaign_id === args[0] && r.scope === args[1] && r.key === args[2]));
    }
    return { rowsAffected: 1, lastInsertId: 0 };
  },
};

vi.mock("./db", () => ({ getDb: async () => fakeDb, sqlAvailable: () => true }));
vi.mock("./appToast", () => ({ pushToast: vi.fn() }));

const { kvGet, kvSet, kvAll, migrateCampaignToDb, migrationStatus, campaignStoreReady, __resetCampaignStoreCache } =
  await import("./campaignStore");

beforeEach(() => {
  rows = [];
  failNextWrite = false;
  tableExists = true;
  localStorage.clear();
  __resetCampaignStoreCache();
});

describe("the campaign store round-trips", () => {
  it("stores and reads a value", async () => {
    await kvSet("c1", "desk", "notes", [{ title: "A note" }]);
    expect(await kvGet("c1", "desk", "notes")).toEqual([{ title: "A note" }]);
  });

  it("keeps campaigns apart", async () => {
    await kvSet("c1", "desk", "notes", ["mine"]);
    await kvSet("c2", "desk", "notes", ["theirs"]);
    expect(await kvGet("c1", "desk", "notes")).toEqual(["mine"]);
    expect(await kvGet("c2", "desk", "notes")).toEqual(["theirs"]);
  });

  it("returns null for something absent rather than a blank", async () => {
    expect(await kvGet("c1", "desk", "nope")).toBeNull();
  });

  it("returns null for a damaged blob rather than an empty value a write could persist", async () => {
    rows.push({ campaign_id: "c1", scope: "desk", key: "notes", value: "{broken", updated_at: 1 });
    expect(await kvGet("c1", "desk", "notes")).toBeNull();
  });

  it("lists everything for a campaign, for the exporter", async () => {
    await kvSet("c1", "desk", "notes", [1]);
    await kvSet("c1", "folders", "characters", [2]);
    const all = await kvAll("c1");
    expect(all).toHaveLength(2);
    expect(all.map((x) => x.scope).sort()).toEqual(["desk", "folders"]);
  });
});

describe("migration copies without destroying", () => {
  it("copies a localStorage value into the database", async () => {
    localStorage.setItem("wte-desk-notes:c1", JSON.stringify([{ title: "Prep" }]));
    const r = await migrateCampaignToDb("c1");
    expect(r.copied).toContain("desk/notes");
    expect(await kvGet("c1", "desk", "notes")).toEqual([{ title: "Prep" }]);
  });

  it("LEAVES THE ORIGINAL IN PLACE — the migration is a copy, not a move", async () => {
    const original = JSON.stringify([{ title: "Prep" }]);
    localStorage.setItem("wte-desk-notes:c1", original);
    await migrateCampaignToDb("c1");
    // If anything about this migration is wrong, the source is still recoverable.
    expect(localStorage.getItem("wte-desk-notes:c1")).toBe(original);
  });

  it("does not copy the same key twice", async () => {
    localStorage.setItem("wte-desk-notes:c1", JSON.stringify(["first"]));
    await migrateCampaignToDb("c1");
    // Simulate the user editing the OLD key afterwards; it must not overwrite.
    localStorage.setItem("wte-desk-notes:c1", JSON.stringify(["stale edit"]));
    const second = await migrateCampaignToDb("c1");
    expect(second.copied).not.toContain("desk/notes");
    expect(await kvGet("c1", "desk", "notes")).toEqual(["first"]);
  });

  it("never clobbers a value already in the database", async () => {
    await kvSet("c1", "desk", "notes", ["newer, from the db"]);
    localStorage.setItem("wte-desk-notes:c1", JSON.stringify(["older, from localStorage"]));
    await migrateCampaignToDb("c1");
    expect(await kvGet("c1", "desk", "notes")).toEqual(["newer, from the db"]);
  });

  it("skips keys that were never there", async () => {
    const r = await migrateCampaignToDb("c1");
    expect(r.copied).toEqual([]);
    expect(r.failed).toEqual([]);
    expect(r.skipped.length).toBeGreaterThan(0);
  });

  it("RETRIES a failed key next time instead of stranding it", async () => {
    // The bug the old campaign migration had: one success permanently disabled the
    // whole thing, so anything after a failure could never be imported.
    localStorage.setItem("wte-desk-notes:c1", JSON.stringify(["prep"]));
    failNextWrite = true;
    const first = await migrateCampaignToDb("c1");
    expect(first.failed.map((f) => f.key)).toContain("desk/notes");
    expect(await kvGet("c1", "desk", "notes")).toBeNull();

    const second = await migrateCampaignToDb("c1");
    expect(second.copied).toContain("desk/notes");
    expect(await kvGet("c1", "desk", "notes")).toEqual(["prep"]);
  });

  it("one failing key does not stop the others", async () => {
    localStorage.setItem("wte-desk-notes:c1", JSON.stringify(["notes"]));
    localStorage.setItem("wte-desk-cal:c1", JSON.stringify(["calendar"]));
    failNextWrite = true; // kills the first write only
    const r = await migrateCampaignToDb("c1");
    expect(r.failed).toHaveLength(1);
    expect(r.copied.length).toBeGreaterThan(0);
  });

  it("copies the global keys too, so a DB backup carries the armory", async () => {
    localStorage.setItem("wte-armory-weapons", JSON.stringify([{ name: "Custom Blade" }]));
    const r = await migrateCampaignToDb("c1");
    expect(r.copied).toContain("armory/weapons");
  });

  it("reports status for the diagnostics screen", async () => {
    localStorage.setItem("wte-desk-notes:c1", JSON.stringify(["x"]));
    expect(migrationStatus("c1").find((s) => s.key === "desk/notes")?.migrated).toBe(false);
    await migrateCampaignToDb("c1");
    expect(migrationStatus("c1").find((s) => s.key === "desk/notes")?.migrated).toBe(true);
  });

  it("does nothing without a campaign id", async () => {
    const r = await migrateCampaignToDb("");
    expect(r).toEqual({ copied: [], skipped: [], failed: [] });
  });
});

describe("without the Phase 2 schema, the store ships inert", () => {
  // Migration v5 is deferred, so campaign_kv does not exist on a fresh v0.8.61
  // install. Every operation must no-op rather than throw — the localStorage
  // guards in localJson still protect the data where it currently sits.
  it("reports that it is not ready", async () => {
    tableExists = false;
    __resetCampaignStoreCache();
    expect(await campaignStoreReady()).toBe(false);
  });

  it("reads return null instead of throwing", async () => {
    tableExists = false;
    __resetCampaignStoreCache();
    await expect(kvGet("c1", "desk", "notes")).resolves.toBeNull();
  });

  it("writes are a silent no-op instead of throwing", async () => {
    tableExists = false;
    __resetCampaignStoreCache();
    await expect(kvSet("c1", "desk", "notes", [1])).resolves.toBeUndefined();
    expect(rows).toHaveLength(0);
  });

  it("kvAll returns empty, so the package exporter still works", async () => {
    tableExists = false;
    __resetCampaignStoreCache();
    await expect(kvAll("c1")).resolves.toEqual([]);
  });

  it("the migration does nothing and reports nothing failed", async () => {
    tableExists = false;
    __resetCampaignStoreCache();
    localStorage.setItem("wte-desk-notes:c1", JSON.stringify(["prep"]));
    const r = await migrateCampaignToDb("c1");
    expect(r).toEqual({ copied: [], skipped: [], failed: [] });
    // Critically: the source is untouched, so nothing is stranded.
    expect(localStorage.getItem("wte-desk-notes:c1")).toBe(JSON.stringify(["prep"]));
  });
});
