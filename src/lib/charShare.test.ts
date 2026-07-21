import { describe, expect, it } from "vitest";
import { toSharedCharacter, fromSharedCharacter } from "./charShare";
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
