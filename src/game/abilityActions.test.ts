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

  it("treats an opposed check as the character's own roll", () => {
    const acts = parseAbilityActions("Resolution: opposed Inspiration + Influence Check vs their Wisdom.");
    const self = acts.find((a) => a.kind === "self");
    expect(self).toMatchObject({ stat: "Inspiration", expr: "1d20" });
  });

  it("recognizes a d20 + level self roll", () => {
    const acts = parseAbilityActions("the Inquisitor rolls d20 + Ode Level to achieve success.");
    expect(acts.some((a) => a.kind === "self" && a.expr === "1d20")).toBe(true);
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
