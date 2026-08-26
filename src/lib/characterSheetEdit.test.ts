import { beforeEach, describe, expect, it, vi } from "vitest";
import { giveHandout, removeHandout, type Handout } from "../game/handouts";
import { giveItemPatch } from "../vtt/data/synopsis";
import type { CharacterSheet } from "../models/character";

// The same fake SQLite handle the corrupt-row suite uses: rows live in an array,
// so a test can watch what a write path actually left behind rather than only
// whether it threw.
interface Row {
  id: string;
  campaign_id: string | null;
  name: string;
  data: string | null;
  created_at: number;
  updated_at: number;
}
let rows: Row[] = [];

const fakeDb = {
  select: async <T>(sql: string, args: unknown[] = []): Promise<T> => {
    if (/SELECT data FROM characters WHERE id/.test(sql)) {
      return rows.filter((r) => r.id === args[0]).map((r) => ({ data: r.data })) as unknown as T;
    }
    if (/WHERE id = \$1/.test(sql)) return rows.filter((r) => r.id === args[0]) as unknown as T;
    return rows as unknown as T;
  },
  execute: async (sql: string, args: unknown[] = []) => {
    if (/UPDATE characters SET name = \$1, data = \$2/.test(sql)) {
      const r = rows.find((x) => x.id === args[3]);
      if (r) {
        r.name = String(args[0]);
        r.data = String(args[1]);
      }
    } else if (/UPDATE characters SET data = \$1/.test(sql)) {
      const r = rows.find((x) => x.id === args[2]);
      if (r) r.data = String(args[0]);
    }
    return { rowsAffected: 1, lastInsertId: 0 };
  },
};

vi.mock("./db", () => ({ getDb: async () => fakeDb, sqlAvailable: () => true }));

const { editCharacterSheet, patchCharacterSheet, getCharacter } = await import("./characters");

const note = (id: string, title: string): Handout => ({ id, title, text: title, by: "The Curator", at: 1 });

function plant(sheet: Partial<CharacterSheet>): void {
  rows = [
    {
      id: "vex",
      campaign_id: "c1",
      name: "Vex",
      data: JSON.stringify({ attributes: {}, specialties: {}, rank: 1, notes: "", ...sheet }),
      created_at: 1,
      updated_at: 2,
    },
  ];
}

beforeEach(() => plant({}));

describe("a sheet edit is computed from the stored sheet, not the caller's copy", () => {
  // THE BUG: the Curator's synopsis retracts a handout by writing the whole
  // `handouts` array. Both clicks built their array from the same pre-write
  // snapshot, so retracting A and then B put A back on the player's sheet and
  // removed B — the opposite of what the Curator did, announced to the player as
  // if it were intended.
  it("does not resurrect an entry when two retractions land back to back", async () => {
    plant({ handouts: [note("a", "Torn ledger page"), note("b", "Sealed writ")] });
    const drop = (id: string) =>
      editCharacterSheet("vex", (sheet) => {
        const handouts = removeHandout(sheet.handouts, id);
        return handouts ? { handouts } : null;
      });
    expect(await drop("a")).toBe("written");
    expect(await drop("b")).toBe("written");
    expect((await getCharacter("vex"))?.sheet.handouts).toBeUndefined();
  });

  it("keeps an earlier gift when a second item follows it", async () => {
    const give = (name: string) => editCharacterSheet("vex", (sheet) => giveItemPatch(sheet, { name }));
    await give("Torn ledger");
    await give("Sigil fragment");
    expect((await getCharacter("vex"))?.sheet.equipment?.map((e) => e.name)).toEqual([
      "Torn ledger",
      "Sigil fragment",
    ]);
  });

  it("stacks a second handout onto the first rather than replacing it", async () => {
    const hand = (title: string) =>
      editCharacterSheet("vex", (sheet) => {
        const handouts = giveHandout(sheet.handouts, { title, text: title, by: "The Curator", now: 1 });
        return handouts ? { handouts } : null;
      });
    await hand("First");
    await hand("Second");
    expect((await getCharacter("vex"))?.sheet.handouts?.map((h) => h.title)).toEqual(["First", "Second"]);
  });

  it("separates a record that is gone from a change that was not needed", async () => {
    expect(await editCharacterSheet("nobody", () => ({ rank: 3 }))).toBe("missing");
    expect(await editCharacterSheet("vex", () => null)).toBe("unchanged");
    // "unchanged" must not have written: the caller reports "nothing to give",
    // and a write here would still broadcast and notify the player about it.
    expect((await getCharacter("vex"))?.sheet.rank).toBe(1);
  });

  it("still answers the vault's plain patch callers as a boolean", async () => {
    expect(await patchCharacterSheet("vex", { folderId: "f1" })).toBe(true);
    expect(await patchCharacterSheet("nobody", { folderId: "f1" })).toBe(false);
    expect((await getCharacter("vex"))?.sheet.folderId).toBe("f1");
  });
});
