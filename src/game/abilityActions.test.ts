import { describe, expect, it } from "vitest";
import { parseAbilityActions } from "./abilityActions";
import { speciesInnate } from "./wte";

describe("ability action parser", () => {
  it("pulls damage dice with their type", () => {
    const acts = parseAbilityActions("Upon reaching 8 stacks the blight ruptures: 3d10 Entropy and Incapacitated 1 round.");
    const dmg = acts.find((a) => a.kind === "damage");
    expect(dmg).toMatchObject({ expr: "3d10", damageType: "Entropy", label: "3d10 Entropy" });
  });

  it("captures a target save with its DC as info, not a self roll", () => {
    const acts = parseAbilityActions("living creatures make Endurance Saves (DC 18) each round or take 3d10 cold damage.");
    const save = acts.find((a) => a.kind === "save");
    expect(save).toMatchObject({ stat: "Endurance", dc: 18 });
    expect(acts.some((a) => a.kind === "damage" && a.expr === "3d10")).toBe(true);
    expect(acts.some((a) => a.kind === "self")).toBe(false);
  });

  it("merges a natural target save with its explicit DC", () => {
    const acts = parseAbilityActions("The target makes an Endurance Save (DC 12) or is knocked prone.");
    expect(acts.filter((action) => action.kind === "save" && action.stat === "Endurance")).toEqual([
      expect.objectContaining({ label: "Endurance save · DC 12", dc: 12 }),
    ]);
  });

  it("treats an opposed check as the character's own roll", () => {
    const acts = parseAbilityActions("Resolution: opposed Inspiration + Influence Check vs their Wisdom.");
    const self = acts.find((a) => a.kind === "self");
    expect(self).toMatchObject({ stat: "Inspiration", expr: "1d20" });
  });

  it("recognizes a d20 + level self roll", () => {
    const acts = parseAbilityActions("the Inquisitor rolls d20 + Ode Level to achieve success.");
    expect(acts.some((a) => a.kind === "self" && a.expr === "1d20")).toBe(true);
  });

  it("understands Re-Varant forced, self, and target roll wording", () => {
    const forced = parseAbilityActions("Resolution: forced AP Roll, then Strength Save or Adaptation Check.");
    expect(forced.filter((action) => action.kind === "save").map((action) => action.stat)).toEqual(
      expect.arrayContaining(["AP", "Strength", "Adaptation"])
    );

    const contact = parseAbilityActions(
      "Roll Adaption; the target rolls Control at double Disadvantage. You may make a Control roll above the target's roll."
    );
    expect(contact).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "self", stat: "Adaption" }),
      expect.objectContaining({ kind: "self", stat: "Control" }),
      expect.objectContaining({ kind: "save", stat: "Control" }),
    ]));
  });

  it("returns nothing actionable for pure flavor prose", () => {
    expect(parseAbilityActions("Passively sense magnetic fields; manipulate any field within 45 ft.")).toEqual([]);
  });

  it("understands real ability blocks from the catalog", () => {
    // Sbeindlaer's Unstable Blightness names both a save and a rupture die.
    const styg = speciesInnate("stygians");
    const parasitic = styg.find((a) => a.name === "Parasitic Shadow");
    // Parasitic Shadow declares a d20 threshold — no armed roll, but no crash.
    expect(Array.isArray(parseAbilityActions(parasitic?.effect))).toBe(true);
  });
});
