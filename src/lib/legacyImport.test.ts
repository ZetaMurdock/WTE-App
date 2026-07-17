import { describe, expect, it } from "vitest";
import { parseLegacySheet, scanLegacyStorage } from "./legacyImport";
import { PARADIGMS, SPECIES, genusForParadigm } from "../game/wte";

// A representative legacy collectAll() dump (flat element-id keys).
function legacyDump(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    "f-name": "Kess Varda",
    "f-player": "Tyrek",
    "f-species": SPECIES[0].name.toUpperCase(), // case-insensitive match
    "f-variant": "Duskborn",
    "f-paradigm": PARADIGMS[0].name,
    "f-background": "Scavver",
    "f-level": "Stage 3",
    "a-phy": "4",
    "a-dex": "2",
    "a-end": "3",
    "a-ap": "1",
    "a-wis": "2",
    "a-con": "5", // legacy CON slot = modern CHA
    "a-int": "1",
    "s-wt": "10",
    "s-ins": "22",
    "w1-name": "Rust Cleaver",
    "w1-type": "Melee",
    "w1-dmg": "2d6",
    "vs-a1": "Ash Walk",
    "as-name-1": "Third eye",
    "bg-b1": "Grew up in the flooded stacks.",
    __stage: 3,
    __equipment: [
      { id: "x", name: "Scav Harness", slot: "TORSO", wcat: "heavy", equipped: true, modText: "END +1", fx: "", notes: "patched" },
      { id: "y", name: "", wcat: "light" }, // nameless rows are skipped
    ],
    ...over,
  };
}

describe("parseLegacySheet", () => {
  it("maps identity, attributes (CON→CHA), and specialties", () => {
    const { name, sheet } = parseLegacySheet(legacyDump());
    expect(name).toBe("Kess Varda");
    expect(sheet.attributes).toMatchObject({ phy: 4, dex: 2, end: 3, ap: 1, wis: 2, cha: 5, int: 1 });
    expect(sheet.specialties.wt).toBe(10);
    expect(sheet.specialties.ins).toBe(22);
    expect(sheet.speciesId).toBe(SPECIES[0].id);
    expect(sheet.variantName).toBe("Duskborn");
    expect(sheet.paradigmId).toBe(PARADIGMS[0].id);
    expect(sheet.rank).toBe(3);
    expect(sheet.background?.name).toBe("Scavver");
  });

  it("converts equipment rows and weapon slots into inventory items", () => {
    const { sheet } = parseLegacySheet(legacyDump());
    const names = (sheet.equipment ?? []).map((e) => e.name);
    expect(names).toContain("Scav Harness");
    expect(names).toContain("Rust Cleaver");
    const harness = sheet.equipment!.find((e) => e.name === "Scav Harness")!;
    expect(harness.weight).toBe("heavy");
    expect(harness.mods).toBe("END +1");
    const cleaver = sheet.equipment!.find((e) => e.name === "Rust Cleaver")!;
    expect(cleaver.notes).toContain("2d6");
  });

  it("keeps standard-set genus abilities as loadout and preserves the rest in notes", () => {
    const std = genusForParadigm(PARADIGMS[0].id).flatMap((g) => g.abilities)[0]?.name;
    const { sheet } = parseLegacySheet(legacyDump({ "gn-name-1": std, "gn-name-2": "Totally Homebrew Blast" }));
    if (std) expect(sheet.genusLoadout).toContain(std);
    expect(sheet.notes).toContain("Totally Homebrew Blast");
  });

  it("preserves varna/asymmetry/backstory and unmatched names in the notes block", () => {
    const { sheet } = parseLegacySheet(legacyDump({ "f-species": "Made-Up Species" }));
    expect(sheet.notes).toContain("Imported from legacy sheet");
    expect(sheet.notes).toContain("Ash Walk");
    expect(sheet.notes).toContain("Third eye");
    expect(sheet.notes).toContain("flooded stacks");
    expect(sheet.notes).toContain("Made-Up Species");
    expect(sheet.speciesId).toBeUndefined();
  });

  it("falls back to level digits for rank and clamps 0..9", () => {
    const { sheet } = parseLegacySheet(legacyDump({ __stage: undefined, "f-level": "Stage 12" }));
    expect(sheet.rank).toBe(9);
  });

  it("rejects non-objects", () => {
    expect(() => parseLegacySheet("nope")).toThrow();
    expect(() => parseLegacySheet([1, 2])).toThrow();
  });
});

describe("scanLegacyStorage", () => {
  function fakeStore(entries: Record<string, string>): Pick<Storage, "length" | "key" | "getItem"> {
    const keys = Object.keys(entries);
    return { length: keys.length, key: (i) => keys[i] ?? null, getItem: (k) => entries[k] ?? null };
  }

  it("finds roster characters and the pre-roster autosave", () => {
    const store = fakeStore({
      "wte-chardata-abc": JSON.stringify({ "f-name": "Kess" }),
      "wte-sheet-v6": JSON.stringify({ "f-name": "Old Solo" }),
      "wte-theme": "dark",
    });
    const found = scanLegacyStorage(store);
    expect(found.map((c) => c.name).sort()).toEqual(["Kess", "Old Solo"]);
  });

  it("skips the autosave when the roster already migrated it (same name)", () => {
    const store = fakeStore({
      "wte-chardata-abc": JSON.stringify({ "f-name": "Kess" }),
      "wte-sheet-v6": JSON.stringify({ "f-name": "Kess" }),
    });
    expect(scanLegacyStorage(store)).toHaveLength(1);
  });

  it("ignores junk values without crashing", () => {
    const store = fakeStore({ "wte-chardata-bad": "not json", "wte-chardata-null": "null" });
    expect(scanLegacyStorage(store)).toEqual([]);
  });
});
