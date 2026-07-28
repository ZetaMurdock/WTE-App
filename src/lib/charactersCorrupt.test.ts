import { beforeEach, describe, expect, it, vi } from "vitest";

// A stand-in for the SQLite handle. Rows live in this array so a test can plant a
// corrupt `data` blob and then watch whether a write path overwrites it.
interface Row {
  id: string;
  campaign_id: string | null;
  name: string;
  data: string | null;
  created_at: number;
  updated_at: number;
}
let rows: Row[] = [];
const executed: { sql: string; args: unknown[] }[] = [];

const fakeDb = {
  select: async <T>(sql: string, args: unknown[] = []): Promise<T> => {
    if (/SELECT data FROM characters WHERE id/.test(sql)) {
      return rows.filter((r) => r.id === args[0]).map((r) => ({ data: r.data })) as unknown as T;
    }
    if (/WHERE id = \$1/.test(sql)) return rows.filter((r) => r.id === args[0]) as unknown as T;
    if (/WHERE campaign_id = \$1/.test(sql)) return rows.filter((r) => r.campaign_id === args[0]) as unknown as T;
    return rows as unknown as T;
  },
  execute: async (sql: string, args: unknown[] = []) => {
    executed.push({ sql, args });
    // Apply the writes the guard is supposed to be preventing, so a regression
    // shows up as destroyed data rather than just a missing throw.
    if (/UPDATE characters SET name = \$1, data = \$2/.test(sql)) {
      const r = rows.find((x) => x.id === args[3]);
      if (r) {
        r.name = String(args[0]);
        r.data = String(args[1]);
      }
    } else if (/UPDATE characters SET data = \$1/.test(sql)) {
      const r = rows.find((x) => x.id === args[2]);
      if (r) r.data = String(args[0]);
    } else if (/UPDATE characters SET name = \$1, updated_at/.test(sql)) {
      const r = rows.find((x) => x.id === args[2]);
      if (r) r.name = String(args[0]);
    } else if (/INSERT INTO characters/.test(sql)) {
      const r = rows.find((x) => x.id === args[0]);
      if (r) {
        r.name = String(args[2]);
        r.data = String(args[3]);
      } else {
        rows.push({
          id: String(args[0]),
          campaign_id: args[1] as string | null,
          name: String(args[2]),
          data: String(args[3]),
          created_at: Number(args[4]),
          updated_at: Number(args[5]),
        });
      }
    }
    return { rowsAffected: 1, lastInsertId: 0 };
  },
};

vi.mock("./db", () => ({
  getDb: async () => fakeDb,
  sqlAvailable: () => true,
}));

const {
  getCharacter,
  updateCharacter,
  patchCharacterSheet,
  upsertCharacter,
  getRawCharacterData,
  repairCharacterData,
  resetCorruptCharacter,
  CorruptRecordError,
} = await import("./characters");

const GOOD = JSON.stringify({ attributes: { phy: 30 }, rank: 4, notes: "real notes", morality: 77 });
const CORRUPT = '{"attributes":{"phy":30},"rank":4,"not';

beforeEach(() => {
  executed.length = 0;
  rows = [
    { id: "good", campaign_id: "c1", name: "Reads Fine", data: GOOD, created_at: 1, updated_at: 2 },
    { id: "bad", campaign_id: "c1", name: "Truncated Row", data: CORRUPT, created_at: 1, updated_at: 2 },
  ];
});

describe("a corrupt row is reported, not silently blanked", () => {
  it("flags it and hands back the original bytes for recovery", async () => {
    const rec = await getCharacter("bad");
    expect(rec?.corrupt).toBe(true);
    expect(rec?.rawData).toBe(CORRUPT);
    expect(rec?.corruptError).toBeTruthy();
    // The name column is intact, which is exactly why the old behaviour read as
    // "my character was reset" rather than as an error.
    expect(rec?.name).toBe("Truncated Row");
  });

  it("leaves a readable row unflagged", async () => {
    const rec = await getCharacter("good");
    expect(rec?.corrupt).toBeUndefined();
    expect(rec?.sheet.morality).toBe(77);
  });
});

describe("no write path can overwrite an unreadable row", () => {
  it("refuses a sheet update and leaves the original bytes untouched", async () => {
    await expect(updateCharacter("bad", { sheet: { attributes: {}, specialties: {} } as never })).rejects.toBeInstanceOf(
      CorruptRecordError
    );
    expect(rows.find((r) => r.id === "bad")!.data).toBe(CORRUPT);
  });

  it("refuses a combined name+sheet update", async () => {
    await expect(
      updateCharacter("bad", { name: "Renamed", sheet: { attributes: {}, specialties: {} } as never })
    ).rejects.toBeInstanceOf(CorruptRecordError);
    expect(rows.find((r) => r.id === "bad")!.data).toBe(CORRUPT);
  });

  it("refuses patchCharacterSheet — the vault's tag and folder actions take this path", async () => {
    await expect(patchCharacterSheet("bad", { folderId: "f1" })).rejects.toBeInstanceOf(CorruptRecordError);
    expect(rows.find((r) => r.id === "bad")!.data).toBe(CORRUPT);
  });

  it("refuses an upsert over a corrupt local row (the netplay sheet-sync path)", async () => {
    const incoming = {
      id: "bad",
      campaignId: "c1",
      name: "From A Peer",
      createdAt: 1,
      updatedAt: 9,
      sheet: { attributes: {}, specialties: {} },
    };
    await expect(upsertCharacter(incoming as never)).rejects.toBeInstanceOf(CorruptRecordError);
    expect(rows.find((r) => r.id === "bad")!.data).toBe(CORRUPT);
  });

  it("refuses to push a corrupt-loaded record outward", async () => {
    const rec = await getCharacter("bad");
    await expect(upsertCharacter({ ...rec!, id: "good" } as never)).rejects.toBeInstanceOf(CorruptRecordError);
    // The healthy row it would have landed on is unharmed.
    expect(rows.find((r) => r.id === "good")!.data).toBe(GOOD);
  });

  it("still allows renaming a corrupt row, since name is its own column", async () => {
    await expect(updateCharacter("bad", { name: "Renamed Only" })).resolves.toBeUndefined();
    const r = rows.find((x) => x.id === "bad")!;
    expect(r.name).toBe("Renamed Only");
    expect(r.data).toBe(CORRUPT);
  });
});

describe("the user can recover a corrupt row deliberately", () => {
  it("hands back the raw stored text", async () => {
    expect(await getRawCharacterData("bad")).toBe(CORRUPT);
  });

  it("repairs the row from corrected text", async () => {
    const fixed = JSON.stringify({ attributes: { phy: 30 }, rank: 4, notes: "rescued", morality: 55 });
    await repairCharacterData("bad", fixed);
    const rec = await getCharacter("bad");
    expect(rec?.corrupt).toBeUndefined();
    expect(rec?.sheet.notes).toBe("rescued");
    expect(rec?.sheet.morality).toBe(55);
  });

  it("refuses a repair that is ALSO unreadable, leaving the original intact", async () => {
    await expect(repairCharacterData("bad", "{still broken")).rejects.toThrow(/still could not be read/i);
    expect(rows.find((r) => r.id === "bad")!.data).toBe(CORRUPT);
  });

  it("resets to a blank sheet only when explicitly asked", async () => {
    await resetCorruptCharacter("bad");
    const rec = await getCharacter("bad");
    expect(rec?.corrupt).toBeUndefined();
    expect(rec?.sheet.rank).toBe(0);
    // The name is untouched by a reset — it lives in its own column.
    expect(rec?.name).toBe("Truncated Row");
  });

  it("is writable again after a reset", async () => {
    await resetCorruptCharacter("bad");
    const rec = await getCharacter("bad");
    await expect(updateCharacter("bad", { sheet: { ...rec!.sheet, rank: 3 } })).resolves.toBeUndefined();
    expect(JSON.parse(rows.find((r) => r.id === "bad")!.data!).rank).toBe(3);
  });
});

describe("healthy records are unaffected", () => {
  it("saves a good row normally", async () => {
    const rec = await getCharacter("good");
    await updateCharacter("good", { sheet: { ...rec!.sheet, rank: 6 } });
    expect(JSON.parse(rows.find((r) => r.id === "good")!.data!).rank).toBe(6);
  });

  it("keeps the fields the codec restored — morality survives a save cycle", async () => {
    const rec = await getCharacter("good");
    await updateCharacter("good", { sheet: rec!.sheet });
    expect(JSON.parse(rows.find((r) => r.id === "good")!.data!).morality).toBe(77);
  });

  it("upserts a brand-new row without complaint", async () => {
    await upsertCharacter({
      id: "fresh",
      campaignId: "c1",
      name: "New",
      createdAt: 1,
      updatedAt: 1,
      sheet: { attributes: {}, specialties: {} },
    } as never);
    expect(rows.some((r) => r.id === "fresh")).toBe(true);
  });
});
