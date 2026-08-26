import { describe, expect, it } from "vitest";
import type { CharacterSheet } from "../models/character";
import { zeroAttributes, zeroSpecialties } from "../game/wte";
import { SHEET_KEYS, SHEET_VERSION, emptySheet, parseSheetSafe, serializeSheet, sheetFromJson } from "./sheetCodec";
import { MAX_HANDOUTS } from "../game/handouts";

// Built from the zero-builders so that adding an attribute or specialty key cannot
// leave the fixture partially populated — every key gets a distinct non-zero value.
function distinct<T extends Record<string, number>>(base: T, from: number): T {
  const out = { ...base };
  let n = from;
  for (const k of Object.keys(out)) (out as Record<string, number>)[k] = n++;
  return out;
}

// A sheet with EVERY field populated with a distinctive, non-default value. If a
// field is added to CharacterSheet, SHEET_KEYS fails to compile until it is listed,
// and the "covers every key" test below fails until it is added here too. That pair
// is what makes these tests property-complete rather than a spot check.
function fullSheet(): CharacterSheet {
  return {
    attributes: distinct(zeroAttributes(), 41),
    specialties: distinct(zeroSpecialties(), 21),
    speciesId: "hyomen",
    variantName: "A Variant",
    variantOption: "An Option",
    innateChoice: ["Innate One", "Innate Two"],
    paradigmId: "a-paradigm",
    rank: 7,
    favoredAttr: "end",
    favoredSpec: "bal",
    portrait: "data:image/png;base64,iVBORw0KGgo=",
    background: {
      name: "A Background",
      mode: "focused",
      assign: ["phy", null, "int"],
      attrBonus: { phy: 3 },
      specBonus: { ctrl: 2 },
    },
    sizeId: "large",
    sector: "Sector 12",
    morality: 88,
    eminence: -13,
    pressure: 176,
    negotiation: { client: "A Client", resistance: 44, eminenceReq: 6 },
    equipment: [
      { id: "eq1", name: "A Thing", weight: "light", equipped: true, mods: "DEX +2", notes: "a note", qty: 2 },
    ],
    genusLoadout: ["Legacy Genus"],
    cipherLoadout: ["A Cipher"],
    bioFields: [{ id: "bf1", label: "Favourite food", value: "9", kind: "counter" }],
    focusSpend: { genus: { Lark: 3 }, incepts: ["Talent Holder"] },
    focusBonus: 2,
    focusBonusRank: 7,
    weaponLoadout: ["A Weapon"],
    gearLoadout: ["Some Gear"],
    ssSpent: 5,
    hpDamage: 0,
    dhpDamage: 0,
    allowOverrides: true,
    derivedOverrides: { hpMax: 321, ncMod: 9 },
    notes: "plain notes",
    folderId: "folder-9",
    tags: ["NPC", "Boss"],
    notesMd: "# markdown notes",
    counterTracks: [{ name: "Fear Points", value: 3 }, { name: "Overload Charges", value: 2, cap: 4 }],
    handouts: [{ id: "ho-1", title: "Torn ledger page", text: "…paid in Scrap.", by: "The Curator", at: 1700 }],
  };
}

describe("SHEET_KEYS is the complete field manifest", () => {
  it("covers every key the fully-populated fixture sets", () => {
    // Guards the other direction from the compile-time check: the fixture must
    // exercise every listed key, or a round trip could pass while a field is
    // untested.
    const fixtureKeys = Object.keys(fullSheet()).sort();
    expect(fixtureKeys).toEqual([...SHEET_KEYS].sort());
  });

  it("lists no duplicates", () => {
    expect(new Set(SHEET_KEYS).size).toBe(SHEET_KEYS.length);
  });
});

describe("a fully-populated sheet survives a round trip", () => {
  it("preserves every single field through serialize -> parse", () => {
    const before = fullSheet();
    const after = sheetFromJson(JSON.parse(serializeSheet(before)));
    expect(after).toEqual(before);
  });

  it("names any field that fails to survive", () => {
    // A field-by-field report, so a failure says WHICH field was dropped rather
    // than dumping two large objects. This is the test that would have caught
    // morality, eminence, pressure, innateChoice, sector, allowOverrides,
    // derivedOverrides, focusBonus and focusBonusRank.
    const before = fullSheet() as unknown as Record<string, unknown>;
    const after = sheetFromJson(JSON.parse(serializeSheet(fullSheet()))) as unknown as Record<string, unknown>;
    const lost = SHEET_KEYS.filter((k) => JSON.stringify(after[k]) !== JSON.stringify(before[k]));
    expect(lost).toEqual([]);
  });

  it("is idempotent — parsing an already-parsed sheet changes nothing", () => {
    const once = sheetFromJson(JSON.parse(serializeSheet(fullSheet())));
    const twice = sheetFromJson(JSON.parse(serializeSheet(once)));
    expect(twice).toEqual(once);
  });

  it("survives many round trips without drift", () => {
    let s = fullSheet();
    for (let i = 0; i < 25; i++) s = sheetFromJson(JSON.parse(serializeSheet(s)));
    expect(s).toEqual(sheetFromJson(JSON.parse(serializeSheet(fullSheet()))));
  });
});

describe("malformed and hostile records do not destroy data", () => {
  it("reports corruption instead of silently returning a blank character", () => {
    const r = parseSheetSafe("{not json at all");
    expect(r.corrupt).toBe(true);
    // The raw text is kept so the record can be recovered rather than replaced.
    expect(r.raw).toBe("{not json at all");
    expect(r.error).toBeTruthy();
  });

  it("treats an absent record as new, not corrupt", () => {
    expect(parseSheetSafe(null)).toEqual({ sheet: emptySheet(), corrupt: false });
  });

  it("keeps the good fields when one field has the wrong type", () => {
    const s = sheetFromJson({ morality: "not a number", eminence: 11, notesMd: "kept" });
    expect(s.morality).toBeUndefined();
    expect(s.eminence).toBe(11);
    expect(s.notesMd).toBe("kept");
  });

  it("does not crash on values that are not objects at all", () => {
    for (const junk of [null, 42, "a string", [], true]) {
      expect(() => sheetFromJson(junk)).not.toThrow();
    }
  });

  it("drops non-string entries from string arrays rather than trusting them", () => {
    const s = sheetFromJson({ tags: ["ok", 5, null, "also ok"] });
    expect(s.tags).toEqual(["ok", "also ok"]);
  });

  it("keeps a null folderId distinct from an absent one", () => {
    expect(sheetFromJson({ folderId: null }).folderId).toBeNull();
    expect(sheetFromJson({}).folderId).toBeUndefined();
  });

  it("reads a sheet saved by an OLDER build, which has no handouts", () => {
    // The realistic shape: a record written before the field existed. It must
    // parse, must not sprout an empty array (that would rewrite every stored row
    // on first open), and must be byte-identical after a round trip.
    const legacy = '{"_v":1,"rank":2,"notes":"before the synopsis shipped"}';
    const s = parseSheetSafe(legacy).sheet;
    expect(s.handouts).toBeUndefined();
    const round = JSON.parse(serializeSheet(s)) as Record<string, unknown>;
    expect("handouts" in round).toBe(false);
  });

  it("drops a list that has been emptied back to nothing", () => {
    // Reachable, not hypothetical: retracting a character's last handout writes
    // `handouts: []`. Left as an empty array it would persist on every row that
    // was ever handed anything, so the field never returns to absent and the
    // round trip above stops being byte-identical for those characters.
    const s = sheetFromJson({ handouts: [] });
    expect(s.handouts).toBeUndefined();
    const round = JSON.parse(serializeSheet(s)) as Record<string, unknown>;
    expect("handouts" in round).toBe(false);
  });

  describe("a sheet saved with the withdrawn `purse` field", () => {
    // A build in this repo's own history wrote a second currency onto the sheet
    // (`purse: [{ name, amount }]`) before W.T.E's real money — Palladium,
    // Credits and Shrives, held on the player's device — was wired to the
    // Curator's console. The field is gone from the model, and every record
    // written by that build is still on disk. Dropping the key would be
    // acceptable; refusing to read the record, or replacing it with a blank
    // sheet, would destroy a character.
    const SAVED = '{"_v":1,"rank":3,"notes":"kept","purse":[{"name":"Gold","amount":120}]}';

    it("loads without corrupting the record", () => {
      const parsed = parseSheetSafe(SAVED);
      expect(parsed.corrupt).toBe(false);
      expect(parsed.sheet.rank).toBe(3);
      expect(parsed.sheet.notes).toBe("kept");
    });

    it("does not throw on a malformed one either", () => {
      // The old parser validated these entries. Nothing does now, so a hand-edited
      // or half-written array must simply pass by rather than reaching any code
      // that expects the old shape.
      for (const raw of ['{"purse":"not a list"}', '{"purse":[7,null,{"name":""}]}', '{"purse":[]}']) {
        expect(() => sheetFromJson(JSON.parse(raw))).not.toThrow();
        expect(sheetFromJson(JSON.parse(raw)).rank).toBe(0);
      }
    });

    it("is no longer a field of the sheet", () => {
      expect([...SHEET_KEYS] as string[]).not.toContain("purse");
    });

    it("SURVIVES THE NEXT SAVE, rather than merely surviving the read", () => {
      // Tolerating the key on load is not enough. Every save re-serializes the
      // object the parser returned — the bug this whole module was written for —
      // so a parser that dropped `purse` would delete it from disk the first
      // time the Curator touched an untouched field. `sheetFromJson` lays the
      // coerced fields over the RAW object and `serializeSheet` spreads the whole
      // sheet, so the withdrawn key rides through untouched and a record written
      // by the old build stays recoverable indefinitely.
      const once = serializeSheet(parseSheetSafe(SAVED).sheet);
      expect(JSON.parse(once).purse).toEqual([{ name: "Gold", amount: 120 }]);
      // Twice round, because a key that survives one trip and not the next is
      // still a key that gets deleted.
      const twice = serializeSheet(parseSheetSafe(once).sheet);
      expect(JSON.parse(twice).purse).toEqual([{ name: "Gold", amount: 120 }]);
      expect(JSON.parse(twice).notes).toBe("kept");
    });
  });

  it("keeps a handout id unique, so taking one back cannot retract two", () => {
    const s = sheetFromJson({
      handouts: [
        { id: "h1", title: "First", text: "", by: "The Curator", at: 1 },
        { id: "h1", title: "Impostor", text: "", by: "The Curator", at: 2 },
      ],
    });
    expect(s.handouts).toEqual([{ id: "h1", title: "First", text: "", by: "The Curator", at: 1 }]);
  });

  it("drops the OLDEST handouts when a stored record carries more than the cap", () => {
    // Same rule as giveHandout: the newest is the one the player was just told
    // about, so an overflowing record must not be trimmed from the wrong end.
    const many = Array.from({ length: MAX_HANDOUTS + 3 }, (_, i) => ({
      id: `h${i}`,
      title: `note ${i}`,
      text: "",
      by: "The Curator",
      at: i,
    }));
    const kept = sheetFromJson({ handouts: many }).handouts!;
    expect(kept).toHaveLength(MAX_HANDOUTS);
    expect(kept[0].id).toBe("h3");
    expect(kept[kept.length - 1].id).toBe(`h${MAX_HANDOUTS + 2}`);
  });

  it("drops malformed handouts rather than crashing the surface that shows them", () => {
    const s = sheetFromJson({
      handouts: [
        { id: "h1", title: "Kept", text: "body", by: "The Curator", at: 5 },
        { id: "h2", title: "no timestamp", text: "", by: "The Curator" },
        "a bare string",
      ],
    });
    expect(s.handouts).toEqual([{ id: "h1", title: "Kept", text: "body", by: "The Curator", at: 5 }]);
  });

  it("rejects a non-finite number rather than storing NaN or Infinity", () => {
    // JSON.stringify turns both into null, so accepting them would corrupt the row.
    expect(sheetFromJson({ rank: Number.NaN }).rank).toBe(0);
    expect(sheetFromJson({ morality: Number.POSITIVE_INFINITY }).morality).toBeUndefined();
  });
});

describe("every corruption shape is caught, not just a syntax error", () => {
  // The first version of parseSheetSafe only flagged JSON syntax errors, so six
  // other shapes reported corrupt:false and produced a blank sheet the write guard
  // then let the autosave persist over the real row.
  it("treats a zero-length blob as damage, not as a new character", () => {
    // This is what an interrupted or failed write leaves behind — the single most
    // likely corruption in practice.
    const r = parseSheetSafe("");
    expect(r.corrupt).toBe(true);
    expect(r.raw).toBe("");
    expect(r.error).toMatch(/empty/i);
  });

  it("treats valid JSON that is not an object as damage", () => {
    for (const raw of ["null", "5", "false", '"a string"', "[1,2]", "[]"]) {
      const r = parseSheetSafe(raw);
      expect(r.corrupt, raw).toBe(true);
      expect(r.raw, raw).toBe(raw);
      expect(r.error, raw).toBeTruthy();
    }
  });

  it("names what it found so the recovery screen can explain it", () => {
    expect(parseSheetSafe("[1,2]").error).toMatch(/array/);
    expect(parseSheetSafe("5").error).toMatch(/number/);
    expect(parseSheetSafe("null").error).toMatch(/object/);
  });

  it("still treats a genuinely absent column as a new character", () => {
    const r = parseSheetSafe(null);
    expect(r.corrupt).toBe(false);
    expect(r.raw).toBeUndefined();
  });

  it("still accepts a real sheet", () => {
    const r = parseSheetSafe('{"rank":4,"notes":"real","morality":80}');
    expect(r.corrupt).toBe(false);
    expect(r.sheet.rank).toBe(4);
    expect(r.sheet.morality).toBe(80);
  });
});

describe("schema versioning and forward compatibility", () => {
  it("stamps the current version on every write", () => {
    const stored = JSON.parse(serializeSheet(emptySheet())) as Record<string, unknown>;
    expect(stored._v).toBe(SHEET_VERSION);
  });

  it("keeps the version marker out of the sheet the app sees", () => {
    const s = sheetFromJson({ _v: 1, rank: 3 });
    expect((s as unknown as Record<string, unknown>)._v).toBeUndefined();
    expect(s.rank).toBe(3);
  });

  it("treats a record with no version as version 1, which is what it is", () => {
    const r = parseSheetSafe('{"rank":5,"notes":"legacy"}');
    expect(r.corrupt).toBe(false);
    expect(r.futureVersion).toBeUndefined();
    expect(r.sheet.rank).toBe(5);
  });

  it("PRESERVES a field written by a newer build instead of deleting it", () => {
    // The old codec was a strict allowlist, so anything it did not recognise was
    // dropped on read and erased by the next save. Opening a character on a second
    // machine running an older W.T.E silently destroyed the newer fields.
    const fromFuture = JSON.stringify({ _v: 2, rank: 4, someNewFieldFromV2: { a: 1 }, anotherNew: "keep me" });
    const parsed = parseSheetSafe(fromFuture);
    const round = JSON.parse(serializeSheet(parsed.sheet)) as Record<string, unknown>;
    expect(round.someNewFieldFromV2).toEqual({ a: 1 });
    expect(round.anotherNew).toBe("keep me");
  });

  it("flags a newer record so the caller can refuse to save it", () => {
    const r = parseSheetSafe('{"_v":99,"rank":4}');
    expect(r.corrupt).toBe(false); // readable, not damaged
    expect(r.futureVersion).toBe(99);
    expect(r.sheet.rank).toBe(4);
    expect(r.raw).toBeTruthy();
  });

  it("does not flag a record at the current version", () => {
    const r = parseSheetSafe(serializeSheet(emptySheet()));
    expect(r.futureVersion).toBeUndefined();
  });

  it("still round-trips a fully-populated sheet with the version present", () => {
    const before = fullSheet();
    const after = parseSheetSafe(serializeSheet(before)).sheet;
    expect(after).toEqual(before);
  });
});
