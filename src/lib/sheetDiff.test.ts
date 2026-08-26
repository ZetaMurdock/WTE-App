import { describe, expect, it } from "vitest";
import type { CharacterRecord } from "./characters";
import type { CharacterSheet } from "../models/character";
import { emptySheet, sheetFromJson } from "./sheetCodec";
import { diffSheetRecords } from "./sheetDiff";

function rec(sheet: Partial<CharacterSheet>, name = "Kade"): CharacterRecord {
  return {
    id: "ch-1",
    campaignId: "camp-1",
    name,
    createdAt: 1,
    updatedAt: 2,
    // Pinning the pool ceilings by override keeps the HP assertions readable
    // WITHOUT restating the derived-stat formula in the expectation.
    sheet: { ...emptySheet(), derivedOverrides: { hpMax: 40, dhp: 20, ss: 12 }, ...sheet },
  };
}

describe("diffSheetRecords", () => {
  it("reports a single changed field and nothing else", () => {
    expect(diffSheetRecords(rec({ rank: 3 }), rec({ rank: 4 }))).toEqual(["Rank 3 → 4"]);
  });

  it("says nothing when a sheet is merely re-saved", () => {
    const before = rec({ rank: 3, notes: "on the run" });
    const after = rec({ rank: 3, notes: "on the run" });
    expect(diffSheetRecords(before, after)).toEqual([]);
  });

  it("says nothing when the only difference is codec normalisation", () => {
    // What a hand-written or older record looks like next to one the codec has
    // filled in: absent arrays, an unset size, a missing notes field. All of it
    // means the same character, so a notice here would fire on every save.
    const sparse: CharacterRecord = {
      id: "ch-1",
      campaignId: "camp-1",
      name: "Kade",
      createdAt: 1,
      updatedAt: 2,
      sheet: { attributes: emptySheet().attributes, specialties: emptySheet().specialties } as CharacterSheet,
    };
    const filled: CharacterRecord = { ...sparse, sheet: sheetFromJson(JSON.parse(JSON.stringify(sparse.sheet))) };
    expect(filled.sheet.sizeId).toBe("auto"); // the codec really did change the object
    expect(diffSheetRecords(sparse, filled)).toEqual([]);
  });

  it("says nothing when the codec MIGRATES a legacy field on load", () => {
    // The normalisation case with teeth. Absent-vs-defaulted is absorbed by the
    // reporters' own fallbacks, so it never proved the round trip was needed;
    // a migration does, because it MOVES a value between two different fields.
    // Pre-Focus sheets carry a flat `genusLoadout`, which the codec rewrites into
    // `focusSpend.genus`. Diffing the stored row against the record the codec
    // handed back would then announce "Gained the Pyrokinesis genus at Focus 1"
    // to every player whose sheet had simply been opened once — a notice fired by
    // the act of reading, on a character nobody touched.
    const legacy: CharacterRecord = {
      id: "ch-1",
      campaignId: "camp-1",
      name: "Kade",
      createdAt: 1,
      updatedAt: 2,
      sheet: {
        attributes: emptySheet().attributes,
        specialties: emptySheet().specialties,
        genusLoadout: ["Pyrokinesis"],
      } as unknown as CharacterSheet,
    };
    const migrated: CharacterRecord = { ...legacy, sheet: sheetFromJson(JSON.parse(JSON.stringify(legacy.sheet))) };
    expect(migrated.sheet.focusSpend?.genus).toMatchObject({ Pyrokinesis: 1 }); // the move really happened
    expect(diffSheetRecords(legacy, migrated)).toEqual([]);
  });

  it("reports several fields at once, in the table's language", () => {
    const before = rec({ rank: 3, attributes: { ...emptySheet().attributes, phy: 12 }, pressure: 50, eminence: 0 });
    const after = rec({ rank: 4, attributes: { ...emptySheet().attributes, phy: 14 }, pressure: 72, eminence: 3 });
    expect(diffSheetRecords(before, after)).toEqual([
      "Rank 3 → 4",
      "Strength 12 → 14",
      "Pressure 50 → 72",
      "Eminence 0 → +3",
    ]);
  });

  it("reports damage as the CURRENT pool value, not as an internal counter", () => {
    expect(diffSheetRecords(rec({ hpDamage: 8 }), rec({ hpDamage: 16 }))).toEqual(["HP 32 → 24"]);
    expect(diffSheetRecords(rec({ ssSpent: 0 }), rec({ ssSpent: 3 }))).toEqual(["Synaptic Space 12 → 9"]);
  });

  it("does not repeat a pool that only moved because its ceiling did", () => {
    // Rank explains the new maximum on its own; saying "HP 40 → 64" underneath it
    // is the same news twice, and the player has taken no damage.
    const before = rec({ rank: 3, derivedOverrides: { hpMax: 40 } });
    const after = rec({ rank: 4, derivedOverrides: { hpMax: 64 } });
    expect(diffSheetRecords(before, after)).toEqual(["Rank 3 → 4", "Max HP override 40 → 64"]);
  });

  it("names a counter track by the name the page gave it", () => {
    const before = rec({ counterTracks: [{ name: "Blight", value: 2, cap: 8 }] });
    const after = rec({ counterTracks: [{ name: "Blight", value: 5, cap: 8 }] });
    expect(diffSheetRecords(before, after)).toEqual(["Blight 2 → 5"]);
    expect(diffSheetRecords(rec({}), before)).toEqual(["Gained the Blight track (2 of 8)"]);
    expect(diffSheetRecords(before, rec({}))).toEqual(["Blight track removed"]);
  });

  it("says nothing about money, because money is not on the sheet", () => {
    // A W.T.E purse is Shrives held in the player's own table link, granted over
    // the wire (net/NetContext `purse/grant`) and announced back by their device.
    // A stale `purse` key left on a record by the withdrawn sheet field must not
    // produce a change notice about a currency this app no longer has.
    const withStale = (amount: number) =>
      rec({ ...({ purse: [{ name: "Gold", amount }] } as object) } as Partial<CharacterSheet>);
    expect(diffSheetRecords(withStale(50), withStale(15))).toEqual([]);
  });

  it("names a handout so the player knows what to look for", () => {
    const given = rec({ handouts: [{ id: "h1", title: "Torn ledger page", text: "…paid in Scrap.", by: "The Curator", at: 5 }] });
    expect(diffSheetRecords(rec({}), given)).toEqual(["Handed to you: “Torn ledger page” — it is in your Notes"]);
    expect(diffSheetRecords(given, rec({}))).toEqual(["“Torn ledger page” was taken back"]);
  });

  it("says nothing about handouts that were merely re-saved", () => {
    const h = { id: "h1", title: "A", text: "a", by: "The Curator", at: 5 };
    expect(diffSheetRecords(rec({ handouts: [h] }), rec({ handouts: [{ ...h }] }))).toEqual([]);
  });

  it("resolves ids to the names on the sheet", () => {
    expect(diffSheetRecords(rec({}), rec({ speciesId: "hyomen" }))).toEqual(["Species set to Hyomen"]);
    expect(diffSheetRecords(rec({ speciesId: "hyomen" }), rec({}))).toEqual(["Species cleared (was Hyomen)"]);
  });

  it("reports Focus in terms of genus and Incepts, never focusSpend", () => {
    const before = rec({ focusSpend: { genus: { Pyrokinetic: 2 }, incepts: [] } });
    const after = rec({ focusSpend: { genus: { Pyrokinetic: 3, Kinetic: 1 }, incepts: ["Talent Holder"] } });
    expect(diffSheetRecords(before, after)).toEqual([
      "Pyrokinetic Focus 2 → 3",
      "Gained the Kinetic genus at Focus 1",
      "Unlocked the Incept Talent Holder",
    ]);
  });

  it("matches inventory by name, so a re-added item is not a loss plus a gain", () => {
    const before = rec({
      equipment: [{ id: "a", name: "Rations", weight: "light", equipped: false, mods: "", qty: 3 }],
    });
    const after = rec({
      equipment: [{ id: "DIFFERENT", name: "Rations", weight: "light", equipped: false, mods: "", qty: 1 }],
    });
    expect(diffSheetRecords(before, after)).toEqual(["Rations ×3 → ×1"]);
  });

  it("keys bio fields by their label and not their generated id", () => {
    const before = rec({ bioFields: [{ id: "bf-1", label: "Age", value: "33", kind: "number" }] });
    const after = rec({ bioFields: [{ id: "bf-2", label: "Age", value: "34", kind: "number" }] });
    expect(diffSheetRecords(before, after)).toEqual(["Age 33 → 34"]);
  });

  it("points at edited prose instead of quoting it", () => {
    const long = "x".repeat(4000);
    expect(diffSheetRecords(rec({ notes: "" }), rec({ notes: long }))).toEqual(["Your notes were edited"]);
  });

  it("reports a rename from the record, not the sheet", () => {
    expect(diffSheetRecords(rec({}, "Kade"), rec({}, "Kade Vor"))).toEqual(["Renamed Kade → Kade Vor"]);
  });

  it("stays quiet about which vault folder the reader filed the character in", () => {
    // folderId is THIS device's organisation. The Curator's folders are not the
    // player's, so a folder move is not news to anyone.
    expect(diffSheetRecords(rec({ folderId: null }), rec({ folderId: "f-9" }))).toEqual([]);
  });

  it("stays quiet about the legacy genus loadout the migration rewrites", () => {
    // focusSpend is the source of truth; genusLoadout is kept only so pre-Focus
    // sheets migrate. Diffing it would fire on every sheet the migration touches.
    const spend = { genus: { Pyrokinetic: 1 }, incepts: [] };
    const before = rec({ focusSpend: spend, genusLoadout: ["Pyrokinetic"] });
    const after = rec({ focusSpend: spend, genusLoadout: [] });
    expect(diffSheetRecords(before, after)).toEqual([]);
  });

  it("never emits an internal key or a JSON blob", () => {
    const before = rec({ rank: 1 });
    const after = rec({
      rank: 2,
      hpDamage: 4,
      speciesId: "hyomen",
      morality: 90,
      tags: ["Ally"],
      counterTracks: [{ name: "Fear Points", value: 1 }],
      negotiation: { client: "The Bank", resistance: 4 },
      allowOverrides: true,
    });
    const lines = diffSheetRecords(before, after);
    expect(lines.length).toBeGreaterThan(5);
    for (const line of lines) {
      expect(line).not.toMatch(/[{}[\]"]/);
      expect(line).not.toMatch(/hpDamage|ssSpent|focusSpend|counterTracks|speciesId|derivedOverrides|allowOverrides/);
    }
  });
});
