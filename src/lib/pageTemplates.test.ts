// The template ↔ parser CONTRACT: every builder scaffold must parse into its
// intended record type through the real parsers. If a parser's field
// conventions ever drift, this suite is the tripwire.
import { describe, expect, it } from "vitest";
import { PAGE_TEMPLATES, parsePreview } from "./pageTemplates";
import { parseCodexEntry } from "./codexParse";
import { parseBackgroundPage, parseParadigmPage, parseSpeciesPage } from "./gameData";

describe("page templates parse into their own record types", () => {
  it("Weapon", () => {
    const e = parseCodexEntry(PAGE_TEMPLATES.Weapon, "t");
    expect(e?.type).toBe("weapon");
    expect(e && "damage" in e && e.damage).toBe("2d6");
  });
  it("Equipment", () => {
    expect(parseCodexEntry(PAGE_TEMPLATES.Equipment, "t")?.type).toBe("equipment");
  });
  it("Cipher (with a paradigm so it attaches)", () => {
    const e = parseCodexEntry(PAGE_TEMPLATES.Cipher, "t");
    expect(e?.type).toBe("cipher");
    expect(e && "paradigm" in e && e.paradigm).toBe("Vanguard");
  });
  it("Genus", () => {
    const e = parseCodexEntry(PAGE_TEMPLATES.Genus, "t");
    expect(e?.type).toBe("genus");
    expect(e && "domain" in e && e.domain).toBe("Neutral");
  });
  it("Creature (class + abilities land)", () => {
    const e = parseCodexEntry(PAGE_TEMPLATES.Creature, "t");
    expect(e?.type).toBe("creature");
    expect(e && "cls" in e && e.cls).toBe(1);
    expect(e && "abilities" in e && e.abilities?.length).toBe(2);
  });
  it("Species (bonuses + variants land)", () => {
    const s = parseSpeciesPage(PAGE_TEMPLATES.Species, "t");
    expect(s?.family).toBe("Humanity");
    expect(s?.bonuses.phy).toBe(2);
    expect(s?.variants).toHaveLength(1);
  });
  it("Paradigm (weapons list lands)", () => {
    const p = parseParadigmPage(PAGE_TEMPLATES.Paradigm, "t");
    expect(p?.weapons).toEqual(["Blades", "Sidearms"]);
  });
  it("Background (bonus list lands)", () => {
    const b = parseBackgroundPage(PAGE_TEMPLATES.Background, "t");
    expect(b?.mode).toBe("standard");
    expect(b?.attrBonus?.wis).toBe(2);
    expect(b?.specBonus?.per).toBe(2);
  });
});

describe("parsePreview", () => {
  it("names the record it will become", () => {
    expect(parsePreview(PAGE_TEMPLATES.Weapon)).toMatch(/^Weapon — /);
    expect(parsePreview(PAGE_TEMPLATES.Creature)).toMatch(/^Creature — .* Class 1/);
    expect(parsePreview(PAGE_TEMPLATES.Species)).toMatch(/^Species — /);
  });
  it("flags a typeless page as lore", () => {
    expect(parsePreview("# Just a story\n\nOnce upon a time.")).toMatch(/Lore page/);
  });
  it("warns when a cipher has no paradigm", () => {
    const md = PAGE_TEMPLATES.Cipher.replace("| Paradigm | Vanguard |\n", "");
    expect(parsePreview(md)).toMatch(/NO PARADIGM/);
  });
});
