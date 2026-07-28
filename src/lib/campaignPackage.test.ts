// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";

interface Row {
  [k: string]: unknown;
  id: string;
}
const tables: Record<string, Row[]> = { campaigns: [], characters: [], scenes: [], encounters: [], assets: [], notes: [], codex_sequences: [], campaign_kv: [] };

function tableOf(sql: string): string {
  const m = /(?:INTO|FROM)\s+(\w+)/i.exec(sql);
  return m ? m[1] : "";
}

const fakeDb = {
  select: async <T>(sql: string, args: unknown[] = []): Promise<T> => {
    if (/sqlite_master/.test(sql)) return [{ name: "campaign_kv" }] as unknown as T;
    const t = tableOf(sql);
    const rows = tables[t] ?? [];
    if (/WHERE campaign_id = \$1 AND scope = \$2 AND key = \$3/.test(sql)) {
      return rows.filter((r) => r.campaign_id === args[0] && r.scope === args[1] && r.key === args[2]) as unknown as T;
    }
    if (/WHERE campaign_id = \$1/.test(sql)) return rows.filter((r) => r.campaign_id === args[0]) as unknown as T;
    if (/WHERE id = \$1/.test(sql)) return rows.filter((r) => r.id === args[0]) as unknown as T;
    return rows as unknown as T;
  },
  execute: async (sql: string, args: unknown[] = []) => {
    const t = tableOf(sql);
    tables[t] ??= [];
    if (/^DELETE/i.test(sql)) return { rowsAffected: 0, lastInsertId: 0 };
    const id = String(args[0]);
    const row: Row = { id };
    if (t === "campaigns") Object.assign(row, { name: args[1], system: args[2], created_at: args[3], updated_at: args[4], archived: args[5] });
    else if (t === "characters") Object.assign(row, { campaign_id: args[1], name: args[2], data: args[3] });
    else if (t === "scenes") Object.assign(row, { campaign_id: args[1], name: args[2], active: args[3], data: args[4] });
    else if (t === "encounters") Object.assign(row, { campaign_id: args[1], name: args[2], scene_id: args[3], data: args[4] });
    else if (t === "assets") Object.assign(row, { campaign_id: args[1], kind: args[2], name: args[3], uri: args[4] });
    else if (t === "notes") Object.assign(row, { campaign_id: args[1], title: args[2], body: args[3] });
    else if (t === "codex_sequences") Object.assign(row, { campaign_id: args[1], data: args[2] });
    else if (t === "campaign_kv") {
      row.id = `${args[0]}:${args[1]}:${args[2]}`;
      Object.assign(row, { campaign_id: args[0], scope: args[1], key: args[2], value: args[3] });
    }
    const i = tables[t].findIndex((r) => r.id === row.id);
    if (i >= 0) tables[t][i] = row;
    else tables[t].push(row);
    return { rowsAffected: 1, lastInsertId: 0 };
  },
};

vi.mock("./db", () => ({ getDb: async () => fakeDb, sqlAvailable: () => true }));
vi.mock("./appToast", () => ({ pushToast: vi.fn(), reportSaveFailure: async (p: Promise<unknown>) => p }));

const {
  PACKAGE_VERSION,
  PackageVersionError,
  NotAPackageError,
  buildPackage,
  parsePackage,
  planImport,
  importPackage,
  packageFilename,
  serializePackage,
} = await import("./campaignPackage");

const campaign = { id: "c-ashen", name: "Ashen Sun", createdAt: 1, updatedAt: 2, archived: false };

beforeEach(() => {
  for (const k of Object.keys(tables)) tables[k] = [];
  tables.campaigns.push({ id: "c-ashen", name: "Ashen Sun", campaign_id: null });
  tables.characters.push({ id: "ch1", campaign_id: "c-ashen", name: "Inquisitor One", data: JSON.stringify({ rank: 4, morality: 80 }) });
  tables.scenes.push({ id: "sc1", campaign_id: "c-ashen", name: "The Belt", active: 1, data: "{}" });
  tables.campaign_kv.push({ id: "c-ashen:desk:notes", campaign_id: "c-ashen", scope: "desk", key: "notes", value: JSON.stringify([{ title: "Prep" }]) });
});

describe("a package gathers the whole campaign", () => {
  it("includes characters, scenes and settings", async () => {
    const pkg = await buildPackage(campaign);
    expect(pkg.wte).toBe("campaign");
    expect(pkg.version).toBe(PACKAGE_VERSION);
    expect(pkg.characters).toHaveLength(1);
    expect(pkg.scenes).toHaveLength(1);
    expect(pkg.kv.find((k) => k.key === "notes")?.value).toEqual([{ title: "Prep" }]);
  });

  it("EXCLUDES a character whose data could not be read", async () => {
    // Exporting the reader's blank placeholder under a real name would turn one
    // machine's corruption into two.
    tables.characters.push({ id: "bad", campaign_id: "c-ashen", name: "Damaged", data: "{truncated" });
    const pkg = await buildPackage(campaign);
    expect(pkg.characters.map((c) => c.id)).toEqual(["ch1"]);
  });

  it("serializes to readable JSON", () => {
    const s = serializePackage({
      wte: "campaign",
      version: 1,
      exportedAt: 0,
      campaign,
      characters: [],
      notes: [],
      sequences: [],
      scenes: [],
      encounters: [],
      assets: [],
      kv: [],
      ruleLayers: [],
      pages: [],
    });
    expect(JSON.parse(s).wte).toBe("campaign");
  });

  it("names the file safely and datestamped", () => {
    expect(packageFilename({ ...campaign, name: "Ashen Sun / Book 2" })).toMatch(/^Ashen_Sun_Book_2-\d{4}-\d{2}-\d{2}\.wtepack$/);
    expect(packageFilename({ ...campaign, name: "???" })).toMatch(/^campaign-/);
  });
});

describe("import validates before it trusts", () => {
  it("refuses something that is not a package", () => {
    for (const bad of [null, 42, "text", {}, { wte: "character" }, { wte: "campaign" }]) {
      expect(() => parsePackage(bad), JSON.stringify(bad)).toThrow(NotAPackageError);
    }
  });

  it("refuses a package from a newer format rather than dropping what it cannot read", () => {
    expect(() => parsePackage({ wte: "campaign", version: 99, campaign })).toThrow(PackageVersionError);
  });

  it("accepts the current format and defaults missing collections to empty", () => {
    const pkg = parsePackage({ wte: "campaign", version: 1, campaign });
    expect(pkg.characters).toEqual([]);
    expect(pkg.kv).toEqual([]);
  });

  it("tolerates a missing version, treating it as 1", () => {
    expect(parsePackage({ wte: "campaign", campaign }).version).toBe(1);
  });
});

describe("an id collision is reported before anything is written", () => {
  it("flags that the campaign already exists", async () => {
    const plan = await planImport(parsePackage({ wte: "campaign", version: 1, campaign }));
    expect(plan.collision).toBe(true);
    expect(plan.campaignId).toBe("c-ashen");
  });

  it("does not flag a campaign that is new here", async () => {
    const plan = await planImport(parsePackage({ wte: "campaign", version: 1, campaign: { ...campaign, id: "c-new" } }));
    expect(plan.collision).toBe(false);
  });

  it("counts what would be imported", async () => {
    const pkg = parsePackage({ wte: "campaign", version: 1, campaign, characters: [{ id: "x", name: "A", sheet: {} }] });
    expect((await planImport(pkg)).counts.characters).toBe(1);
  });
});

describe("copy mode lands alongside, merge mode lands on top", () => {
  const incoming = {
    wte: "campaign" as const,
    version: 1,
    campaign,
    characters: [{ id: "ch1", campaignId: "c-ashen", name: "Imported One", createdAt: 1, updatedAt: 1, sheet: { rank: 9 } }],
    scenes: [{ id: "sc1", campaign_id: "c-ashen", name: "Imported Scene", active: 1, data: "{}" }],
    notes: [],
    sequences: [],
    encounters: [],
    assets: [],
    kv: [],
    pages: [],
  };

  it("copy mode leaves the existing campaign untouched", async () => {
    const before = tables.characters.find((c) => c.id === "ch1")!.name;
    const r = await importPackage(parsePackage(incoming), "copy");
    expect(r.campaignId).not.toBe("c-ashen");
    // The original record is exactly as it was.
    expect(tables.characters.find((c) => c.id === "ch1")!.name).toBe(before);
    // And the copy exists separately.
    expect(tables.characters.some((c) => c.campaign_id === r.campaignId)).toBe(true);
  });

  it("copy mode names the copy distinctly so they can be told apart", async () => {
    const r = await importPackage(parsePackage(incoming), "copy");
    expect(tables.campaigns.find((c) => c.id === r.campaignId)!.name).toContain("imported");
  });

  it("copy mode keeps internal references pointing inside the copy", async () => {
    const withEnc = {
      ...incoming,
      encounters: [{ id: "e1", campaign_id: "c-ashen", name: "Fight", scene_id: "sc1", data: "{}" }],
    };
    const r = await importPackage(parsePackage(withEnc), "copy");
    const enc = tables.encounters.find((e) => e.campaign_id === r.campaignId)!;
    const copiedScene = tables.scenes.find((s) => s.campaign_id === r.campaignId)!;
    // The encounter must point at the COPIED scene, not the original.
    expect(enc.scene_id).toBe(copiedScene.id);
    expect(enc.scene_id).not.toBe("sc1");
  });

  it("merge mode updates in place", async () => {
    const r = await importPackage(parsePackage(incoming), "merge");
    expect(r.campaignId).toBe("c-ashen");
    expect(tables.characters.find((c) => c.id === "ch1")!.name).toBe("Imported One");
  });

  it("reports counts and keeps going past a single bad record", async () => {
    const withJunk = { ...incoming, scenes: [...incoming.scenes, { notAnId: true }] };
    const r = await importPackage(parsePackage(withJunk), "copy");
    expect(r.imported.characters).toBe(1);
    expect(r.imported.scenes).toBe(1); // the junk row is skipped, the good one lands
  });

  it("coerces an imported sheet rather than trusting the file", async () => {
    const hostile = {
      ...incoming,
      characters: [{ id: "ch9", campaignId: "c-ashen", name: "Handmade", createdAt: 1, updatedAt: 1, sheet: { rank: "9", morality: "80" } }],
    };
    const r = await importPackage(parsePackage(hostile), "copy");
    const stored = tables.characters.find((c) => c.campaign_id === r.campaignId && c.name === "Handmade")!;
    const sheet = JSON.parse(String(stored.data));
    // Strings where numbers belong are dropped, not stored to rot.
    expect(sheet.rank).toBe(0);
    expect(sheet.morality).toBeUndefined();
  });
});
