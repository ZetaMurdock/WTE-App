import { describe, expect, it } from "vitest";
import { bakedCodexPages } from "../../lib/bakedCodexPages";
import { KNOWN_KEYS, parseCodexEntry } from "../../lib/codexParse";
import { DAMAGE_TYPE_WORDS, parseAbilityActions } from "../../game/abilityActions";
import { ROLL_AXIS_PATHS } from "../../game/rollAxis";
import {
  DETAIL_SEGMENTS,
  SAVE_STATS,
  damagePhrase,
  detectMechanicsKind,
  hazardousEffectLines,
  rebuildMechanicsPage,
  rollAxisPhrase,
  savePhrase,
  scanMechanicsPage,
} from "./mechanicsModel";

// The editor's contract: opening a page in Mechanics mode and touching nothing
// must not change a byte, and any edit must change exactly what the block said
// it would — through the same parser the catalogs use.
describe("mechanics model round-trip", () => {
  it("rebuild(scan(page)) is byte-identical for every built-in ability page", () => {
    for (const page of bakedCodexPages()) {
      if (page.kind !== "genus" && page.kind !== "cipher") continue;
      const model = scanMechanicsPage(page.content, page.kind);
      expect(rebuildMechanicsPage(model), page.id).toBe(page.content);
    }
  });

  it("offers Mechanics mode for ability pages and nothing else", () => {
    const genus = bakedCodexPages().find((p) => p.kind === "genus")!;
    const cipher = bakedCodexPages().find((p) => p.kind === "cipher")!;
    const species = bakedCodexPages().find((p) => p.kind === "species")!;
    expect(detectMechanicsKind(genus.content)).toBe("genus");
    expect(detectMechanicsKind(cipher.content)).toBe("cipher");
    expect(detectMechanicsKind(species.content)).toBeNull();
    expect(detectMechanicsKind("# Just lore\n\nPlain prose page.")).toBeNull();
  });

  it("claims every built-in ability page", () => {
    for (const page of bakedCodexPages()) {
      if (page.kind !== "genus" && page.kind !== "cipher") continue;
      expect(detectMechanicsKind(page.content), page.id).toBe(page.kind);
    }
  });

  it("refuses HTML-table ability pages the raw-line scanner cannot round-trip", () => {
    const html = [
      "# Ashen Bolt",
      "<table>",
      "<tr><td>Type</td><td>Genus</td></tr>",
      "<tr><td>Domain</td><td>Eldritch</td></tr>",
      "<tr><td>SS</td><td>4</td></tr>",
      "</table>",
      "",
      "A bolt of ash.",
    ].join("\n");
    // The catalog parser still reads it as a genus entry…
    expect(parseCodexEntry(html, "ashen-bolt")?.type).toBe("genus");
    // …but the Mechanics editor must not claim it: rebuilding would replace the
    // HTML table with markdown and lose the page's authored form.
    expect(detectMechanicsKind(html)).toBeNull();
  });

  it("refuses every page shape whose first rebuild would destroy or reinterpret content", () => {
    const base = "# X\n\n| Type | Genus |\n| Domain | Eldritch |\n| SS | 4 |";
    // A section the rebuild would fold into Effect (lore text would then grow roll chips).
    expect(detectMechanicsKind(`${base}\n\n## Effect\n\nZap.\n\n## Lore\n\nLegends say 3d10.`)).toBeNull();
    // A Visual-Engine tree alongside a loose markdown Type row.
    expect(detectMechanicsKind(`${base}\n\n<!--wte-doc {"v":1}-->`)).toBeNull();
    // Bold spec rows the scanner would sweep into the effect, where they
    // silently override the table on re-parse.
    expect(detectMechanicsKind(`${base}\n\n**Range:** 30 ft\n\nZap.`)).toBeNull();
    // Duplicate keys: blocks would show the first row, the parser reads the last.
    expect(detectMechanicsKind(`${base}\n| SS | 2 |\n\nZap.`)).toBeNull();
    // A three-cell row the scanner cannot hold but the parser reads as a field.
    expect(detectMechanicsKind(`${base}\n| Range | 60 ft | approximate |\n\nZap.`)).toBeNull();
    // The canonical shape itself stays claimed.
    expect(detectMechanicsKind(`${base}\n\n## Effect\n\nZap.`)).toBe("genus");
  });

  it("an SS edit through the model changes exactly that field on re-parse", () => {
    const page = bakedCodexPages().find((p) => p.kind === "genus" && /^\| SS \| \d+ \|$/m.test(p.content))!;
    const before = parseCodexEntry(page.content, page.stem)!;
    const model = scanMechanicsPage(page.content, "genus");
    const next = {
      ...model,
      rows: model.rows.map((row) => (row.key === "ss" ? { ...row, value: "99" } : row)),
    };
    const after = parseCodexEntry(rebuildMechanicsPage(next), page.stem)!;
    expect(after).toEqual({ ...before, ss: 99 });
  });
});

// Every phrase the builders can emit must be read back by parseAbilityActions —
// otherwise the editor would promise a roll chip the sheet never shows.
describe("phrase builders emit what the action parser reads", () => {
  it("every save stat and DC lands as a target-side save", () => {
    for (const stat of SAVE_STATS) {
      const actions = parseAbilityActions(savePhrase(stat, 14));
      expect(actions, stat).toContainEqual(expect.objectContaining({ kind: "save", stat, dc: 14 }));
    }
  });

  it("every damage type lands as an armable damage roll", () => {
    for (const type of DAMAGE_TYPE_WORDS) {
      const actions = parseAbilityActions(damagePhrase("2d10", type));
      expect(actions, type).toContainEqual(
        expect.objectContaining({ kind: "damage", expr: "2d10", damageType: type })
      );
    }
  });

  it("every offered Roll Axis route parses back to the same path and direction", () => {
    for (const path of ROLL_AXIS_PATHS) {
      for (const direction of path.directions) {
        const actions = parseAbilityActions(rollAxisPhrase(path, direction));
        expect(actions, `${path.id}/${direction}`).toContainEqual(
          expect.objectContaining({ rollAxis: expect.objectContaining({ path: path.id, direction }) })
        );
      }
    }
  });

  it("detail segment labels are not spec-table keys, so their lines stay prose", () => {
    for (const segment of DETAIL_SEGMENTS) {
      expect(KNOWN_KEYS.has(segment.label.toLowerCase()), segment.label).toBe(false);
    }
    expect(hazardousEffectLines("Duration: one scene.\nTarget: one creature.")).toEqual(["Target"]);
    expect(hazardousEffectLines("Fires a burst of energy at the target.")).toEqual([]);
  });

  it("warns about every spec-row shape the parser lifts, not just the colon form", () => {
    expect(hazardousEffectLines("**Target:** self")).toEqual(["Target"]);
    expect(hazardousEffectLines("SS\t12")).toEqual(["SS"]);
    expect(hazardousEffectLines("| SS | 12 |")).toEqual(["table row"]);
    expect(hazardousEffectLines("**Vector:** touch")).toEqual([]); // not a spec key — safe prose
  });
});
