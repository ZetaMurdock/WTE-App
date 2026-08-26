import { describe, expect, it } from "vitest";
import { bakedCodexPages } from "../../lib/bakedCodexPages";
import { KNOWN_KEYS, parseCodexEntry } from "../../lib/codexParse";
import { DAMAGE_TYPE_WORDS, parseAbilityActions } from "../../game/abilityActions";
import { parseAbilityEffects } from "../../game/abilityEffects";
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

  it("claims a page that declares its steps, and keeps the block out of the prose", () => {
    const page = [
      "# Frost Nail",
      "",
      "| Field | Value |",
      "|---|---|",
      "| Type | Genus |",
      "| Domain | Elemental |",
      "| SS | 6 |",
      "",
      "## Effect",
      "",
      "A spike of cold pins the target in place.",
      "",
      "## Actions",
      "",
      "- Cost: 6 SS",
      "- Save (target): Physical Save — Recovery, DV 18",
      "- Fail: Damage: 3d10 Cold, half on success",
      "- Fail: Condition: Slowed, 2 rounds",
    ].join("\n");
    expect(detectMechanicsKind(page)).toBe("genus");
    const model = scanMechanicsPage(page, "genus");
    expect(model.effect).toBe("A spike of cold pins the target in place.");
    expect(model.actions).toBe(
      [
        "- Cost: 6 SS",
        "- Save (target): Physical Save — Recovery, DV 18",
        "- Fail: Damage: 3d10 Cold, half on success",
        "- Fail: Condition: Slowed, 2 rounds",
      ].join("\n")
    );
    // The grammar survives the trip: four steps out, none unreadable.
    const effects = parseAbilityEffects(scanMechanicsPage(rebuildMechanicsPage(model), "genus").actions);
    expect(effects.errors).toEqual([]);
    expect(effects.steps).toHaveLength(4);
    // …and the model is the same model, which is what stops a rebuild deleting
    // the block by folding it into the effect prose.
    expect(scanMechanicsPage(rebuildMechanicsPage(model), "genus")).toEqual(model);
  });

  it("re-emits a block written above the prose in the one fixed position", () => {
    const page = [
      "# Frost Nail",
      "",
      "| Field | Value |",
      "|---|---|",
      "| Type | Genus |",
      "| SS | 6 |",
      "",
      "## Actions",
      "",
      "- Cost: 6 SS",
      "",
      "## Effect",
      "",
      "A spike of cold.",
    ].join("\n");
    const model = scanMechanicsPage(page, "genus");
    expect(model.effect).toBe("A spike of cold.");
    expect(model.actions).toBe("- Cost: 6 SS");
    const rebuilt = rebuildMechanicsPage(model);
    expect(rebuilt.indexOf("## Actions")).toBeGreaterThan(rebuilt.indexOf("## Effect"));
    expect(scanMechanicsPage(rebuilt, "genus")).toEqual(model);
  });

  it("does not eat a titleless page's block by mistaking its heading for the name", () => {
    // Wiki fragments and pasted rules arrive without a `# Name` — the page still
    // parses as an ability, so the editor claims it, and a heading taken as the
    // title would leave the bullets in the prose for the rebuild to re-emit as
    // rule text under a page called "Actions".
    const page = [
      "| Field | Value |",
      "|---|---|",
      "| Type | Genus |",
      "| SS | 4 |",
      "",
      "## Actions",
      "",
      "- Cost: 4 SS",
      "- Fail: Damage: 2d8 Cold",
    ].join("\n");
    expect(detectMechanicsKind(page)).toBe("genus");
    const model = scanMechanicsPage(page, "genus");
    expect(model.effect).toBe("");
    expect(model.actions).toBe("- Cost: 4 SS\n- Fail: Damage: 2d8 Cold");
    expect(parseAbilityEffects(model.actions).steps).toHaveLength(2);
    // Rebuilding names the page (there is no name to keep) but must carry the
    // block through, and settle after that one pass.
    const rebuilt = rebuildMechanicsPage(model);
    const reread = scanMechanicsPage(rebuilt, "genus");
    expect(reread.actions).toBe(model.actions);
    expect(reread.effect).toBe("");
    expect(rebuildMechanicsPage(reread)).toBe(rebuilt);
    // The same holds for the prose half of a titleless page.
    const prosePage = ["| Type | Cipher |", "| SS | 4 |", "", "## Effect", "", "Zap."].join("\n");
    expect(scanMechanicsPage(prosePage, "cipher").effect).toBe("Zap.");
    expect(scanMechanicsPage(prosePage, "cipher").title).toBe("");
  });

  it("leaves the declared block byte-identical when the prose is edited", () => {
    const model = scanMechanicsPage(
      "# X\n\n| Field | Value |\n|---|---|\n| Type | Genus |\n\n## Effect\n\nOld words.\n\n## Actions\n\n- Cost: 6 SS\n",
      "genus"
    );
    const edited = rebuildMechanicsPage({ ...model, effect: "New words entirely." });
    expect(edited).toContain("New words entirely.");
    expect(scanMechanicsPage(edited, "genus").actions).toBe(model.actions);
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
