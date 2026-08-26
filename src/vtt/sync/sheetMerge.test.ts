// The three-way timeline, driven the way the table actually plays it: the Curator
// adjusts a sheet on Tuesday, the player levels up on Wednesday, and on Friday the
// two copies meet. What is asserted here is which side's work SURVIVES.
import { describe, expect, it } from "vitest";
import { advanceFingerprint, describeSheetConflict, digestRecord, fingerprintRecord, mergeSheetRecords } from "./sheetMerge";
import { parseSheetSafe, serializeSheet } from "../../lib/sheetCodec";
import type { CharacterRecord } from "../../lib/characters";
import type { CharacterSheet } from "../../models/character";

const rec = (over: Partial<CharacterSheet> = {}, name = "Kai"): CharacterRecord => ({
  id: "kai",
  campaignId: "c1",
  name,
  createdAt: 1,
  updatedAt: 100,
  sheet: {
    attributes: {} as CharacterSheet["attributes"],
    specialties: {} as CharacterSheet["specialties"],
    rank: 3,
    hpDamage: 0,
    notes: "",
    ...over,
  },
});

describe("three-way sheet merge", () => {
  const base = fingerprintRecord(rec());

  it("says nothing happened when both copies match", () => {
    const m = mergeSheetRecords(base, rec(), rec());
    expect(m.status).toBe("identical");
    expect(m.took).toEqual([]);
    expect(m.kept).toEqual([]);
  });

  it("takes an edit only THEY made", () => {
    const m = mergeSheetRecords(base, rec(), rec({ rank: 4 }));
    expect(m.status).toBe("theirs");
    expect(m.record.sheet.rank).toBe(4);
  });

  it("keeps an edit only WE made, and reports their copy as behind", () => {
    const m = mergeSheetRecords(base, rec({ hpDamage: 12 }), rec());
    expect(m.status).toBe("ours");
    expect(m.record.sheet.hpDamage).toBe(12);
    expect(m.kept).toEqual(["hpDamage"]);
  });

  it("keeps BOTH weeks when the two sides moved different fields", () => {
    // Curator on Tuesday: HP. Player on Wednesday: a rank-up. Friday:
    const curator = rec({ hpDamage: 12 });
    const player = rec({ rank: 4, notes: "levelled" });
    const m = mergeSheetRecords(base, curator, player);
    expect(m.status).toBe("merged");
    expect(m.record.sheet.hpDamage).toBe(12); // the Curator's adjustment survived
    expect(m.record.sheet.rank).toBe(4); // and so did the level-up
    expect(m.record.sheet.notes).toBe("levelled");
    expect(m.conflicts).toEqual([]);
  });

  it("REFUSES to choose when both moved the same field, and says what each holds", () => {
    const m = mergeSheetRecords(base, rec({ rank: 5 }), rec({ rank: 4 }));
    expect(m.status).toBe("conflict");
    expect(m.record.sheet.rank).toBe(5); // ours is untouched — nothing was overwritten
    expect(m.conflicts).toEqual([{ key: "rank", label: "Rank", ours: 5, theirs: 4 }]);
  });

  it("still delivers the uncontested fields while one field is contested", () => {
    const m = mergeSheetRecords(base, rec({ rank: 5 }), rec({ rank: 4, hpDamage: 9 }));
    expect(m.status).toBe("conflict");
    expect(m.record.sheet.hpDamage).toBe(9); // a disagreement about Rank does not hold up HP
    expect(m.record.sheet.rank).toBe(5);
    expect(m.conflicts.map((c) => c.key)).toEqual(["rank"]);
  });

  it("treats a field one side DELETED as an edit, not as a missing value", () => {
    const withNote = rec({ notes: "remember the door" });
    const b = fingerprintRecord(withNote);
    const m = mergeSheetRecords(b, withNote, rec({ notes: "" }));
    expect(m.status).toBe("theirs");
    expect(m.record.sheet.notes).toBe("");
  });

  it("merges the character's NAME like any other field", () => {
    const m = mergeSheetRecords(base, rec({}, "Kai"), rec({}, "Kai Ver"));
    expect(m.status).toBe("theirs");
    expect(m.record.name).toBe("Kai Ver");
  });

  it("is not fooled by field ORDER or by codec defaults", () => {
    // The same sheet, one built in memory and one as it comes back off the wire
    // with its keys in a different order and its defaults spelled out.
    const ours = rec({ rank: 3 });
    const theirs: CharacterRecord = {
      ...ours,
      sheet: { notes: "", hpDamage: 0, rank: 3, specialties: {}, attributes: {} } as CharacterSheet,
    };
    expect(mergeSheetRecords(fingerprintRecord(ours), ours, theirs).status).toBe("identical");

    // And the real asymmetry, which key order alone does not reach: a record read
    // back out of the database has been through the codec, which spells out a
    // dozen defaults the in-memory sheet never mentions ("" notes, [] loadouts,
    // sizeId "auto"). Compared raw, an ordinary save would arrive as a dozen
    // simultaneous field changes — a party-wide conflict on every keystroke.
    const stored: CharacterRecord = { ...ours, sheet: parseSheetSafe(serializeSheet(ours.sheet)).sheet };
    expect(Object.keys(stored.sheet).length).toBeGreaterThan(Object.keys(ours.sheet).length);
    expect(mergeSheetRecords(fingerprintRecord(ours), ours, stored).status).toBe("identical");
    expect(digestRecord(stored)).toBe(digestRecord(ours));
  });

  it("falls back to their copy when the two sides have no agreed past", () => {
    // No base: nothing is known about who moved what, so inventing a conflict
    // would be a lie. This is the last-writer-wins behaviour, and only here.
    const m = mergeSheetRecords(null, rec({ rank: 5 }), rec({ rank: 4 }));
    expect(m.status).toBe("theirs");
    expect(m.record.sheet.rank).toBe(4);
    expect(m.conflicts).toEqual([]);
  });

  it("never carries a corrupt marker onto the merged record", () => {
    const damaged: CharacterRecord = { ...rec(), corrupt: true, rawData: "{{{", corruptError: "bad" };
    const m = mergeSheetRecords(base, damaged, rec({ rank: 4 }));
    expect(m.record.corrupt).toBeUndefined();
    expect(m.record.rawData).toBeUndefined();
  });

  it("keeps the local row's identity — a merge is not a re-parenting", () => {
    const theirs: CharacterRecord = { ...rec({ rank: 4 }), campaignId: "somewhere-else", createdAt: 999 };
    const m = mergeSheetRecords(base, rec(), theirs);
    expect(m.record.campaignId).toBe("c1");
    expect(m.record.createdAt).toBe(1);
  });
});

describe("advancing an agreement one field at a time", () => {
  it("moves only the fields that were named, leaving a contested one where it was", () => {
    const before = fingerprintRecord(rec());
    const held = rec({ rank: 5, hpDamage: 9 });
    const after = advanceFingerprint(before, held, ["hpDamage"]);
    // The next exchange must still see Rank as moved by us, or the disagreement
    // would quietly settle itself in favour of whoever spoke last.
    expect(after.keys.hpDamage).toBe(fingerprintRecord(held).keys.hpDamage);
    expect(after.keys.rank).toBe(before.keys.rank);
  });

  it("a merge that advanced every field reads as identical next time", () => {
    const merged = rec({ rank: 4, hpDamage: 12 });
    const fp = fingerprintRecord(merged);
    expect(mergeSheetRecords(fp, merged, merged).status).toBe("identical");
  });
});

describe("what the reader is told", () => {
  it("names the character, the field, and BOTH values", () => {
    const text = describeSheetConflict("Kai", [{ key: "rank", label: "Rank", ours: 5, theirs: 4 }]);
    expect(text).toContain("Kai");
    expect(text).toContain("Rank (yours 5, theirs 4)");
    expect(text).toContain("Nothing was overwritten");
  });

  it("does not try to print a portrait into a sentence", () => {
    const text = describeSheetConflict("Kai", [
      { key: "portrait", label: "portrait", ours: "data:image/png;base64," + "A".repeat(400), theirs: "data:x" },
    ]);
    expect(text).not.toContain("AAAA");
    expect(text).toContain("characters");
  });
});
