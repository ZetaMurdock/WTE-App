import { describe, expect, it } from "vitest";
import { toSharedCharacter, fromSharedCharacter, SHARE_VERSION, ShareVersionError } from "./charShare";
import { emptySheet, type CharacterRecord } from "./characters";

const rec = (over: Partial<CharacterRecord> = {}): CharacterRecord => ({
  id: "c1", campaignId: "camp", name: "Vesper", createdAt: 1, updatedAt: 1,
  sheet: { ...emptySheet(), rank: 3, folderId: "f1", tags: ["NPC"] }, ...over,
});

describe("character share (portable JSON)", () => {
  it("round-trips a character, dropping the folder id", () => {
    const shared = toSharedCharacter(rec());
    expect(shared).toMatchObject({ wte: "character", version: 1, name: "Vesper" });
    expect((shared.sheet as { folderId?: string }).folderId).toBeUndefined(); // receiver files it themselves
    expect(shared.sheet.tags).toEqual(["NPC"]); // tags travel with the character
    const back = fromSharedCharacter(shared);
    expect(back).toMatchObject({ name: "Vesper" });
    expect(back?.sheet.rank).toBe(3);
  });

  it("accepts a bare sheet object too", () => {
    const bare = fromSharedCharacter({ name: "Loose", attributes: {}, specialties: {} });
    expect(bare?.name).toBe("Loose");
  });

  it("rejects junk", () => {
    expect(fromSharedCharacter(null)).toBeNull();
    expect(fromSharedCharacter({ hello: "world" })).toBeNull();
  });
});

describe("the file format version is actually read", () => {
  it("refuses a file from a newer format rather than mangling it", () => {
    expect(() =>
      fromSharedCharacter({ wte: "character", version: 99, name: "From Future", sheet: { rank: 4 } })
    ).toThrow(ShareVersionError);
  });

  it("accepts the current version", () => {
    const r = fromSharedCharacter({ wte: "character", version: SHARE_VERSION, name: "Now", sheet: { rank: 4 } });
    expect(r?.name).toBe("Now");
    expect(r?.sheet.rank).toBe(4);
  });

  it("treats a missing version as 1, for files written before the check existed", () => {
    const r = fromSharedCharacter({ wte: "character", name: "Old", sheet: { rank: 2 } });
    expect(r?.sheet.rank).toBe(2);
  });

  it("coerces imported values instead of trusting them", () => {
    // A number arriving as a string used to be stored verbatim, read back as
    // undefined, and then erased from storage by the next save.
    const r = fromSharedCharacter({
      wte: "character",
      version: 1,
      name: "Handmade",
      sheet: { rank: "4", morality: "80", tags: ["ok", 5] },
    });
    // The bad types are dropped rather than propagated into storage.
    expect(r?.sheet.rank).toBe(0);
    expect(r?.sheet.morality).toBeUndefined();
    expect(r?.sheet.tags).toEqual(["ok"]);
  });

  it("still returns null for something that is not a character at all", () => {
    expect(fromSharedCharacter({ hello: "world" })).toBeNull();
    expect(fromSharedCharacter(null)).toBeNull();
    expect(fromSharedCharacter("a string")).toBeNull();
  });
});
