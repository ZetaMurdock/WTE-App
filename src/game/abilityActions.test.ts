import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { GENUS_DOMAIN_NAMES, getGenusDomain } from "./wte";
import { parseAbilityActions } from "./abilityActions";
import { CIPHER_DATA_BY_ID, GENUS_DATA_BY_ID, SPECIES, inceptsForSpecies, speciesInnate } from "./wte";

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

  it("preserves Universal Resolution path and direction instead of reducing them to a stat", () => {
    const acts = parseAbilityActions(
      "Resolution: Mental Check — Capacity vs Physical Save — Evasion. The target makes a Mental Check — Perception (DC 14)."
    );

    expect(acts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: "self",
        label: "Mental Check — Capacity",
        rollAxis: { axis: "mental", direction: "check", path: "capacity" },
      }),
      expect.objectContaining({
        kind: "save",
        label: "Physical Save — Evasion",
        rollAxis: { axis: "physical", direction: "save", path: "evasion" },
      }),
      expect.objectContaining({
        kind: "save",
        // DV is the game's own word for it since the Roll Axis update.
        label: "Mental Check — Perception · DV 14",
        dc: 14,
        rollAxis: { axis: "mental", direction: "check", path: "perception" },
      }),
    ]));
    expect(acts.some((action) => action.stat === "Physical")).toBe(false);
  });

  it("ignores impossible axis/path pairs instead of creating a misleading bare roll", () => {
    expect(parseAbilityActions("The target makes a Physical Save — Power.")).toEqual([]);
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

describe("the 2026-08 Genus/Cipher vocabulary", () => {
  const byName = (name: string) => {
    // Real effect text from the regenerated baked data, not a paraphrase.
    for (const d of GENUS_DOMAIN_NAMES) {
      const a = getGenusDomain(d)!.abilities.find((x) => x.name === name);
      if (a) return a.effect;
    }
    throw new Error(`no baked ability ${name}`);
  };

  it("reads a DV with a named modifier (Lock Move)", () => {
    const acts = parseAbilityActions(byName("Lock Move"));
    const save = acts.find((a) => a.rollAxis?.path === "recovery");
    expect(save).toMatchObject({ kind: "save", dc: 13, dcBonus: "Neuronal Capacity Modifier" });
    expect(save!.label).toBe("Physical Save — Recovery · DV 13 + NC Mod");
  });

  it("reads a rolled DV shared by two saves (Luminance Overload)", () => {
    const acts = parseAbilityActions(byName("Luminance Overload"));
    const perception = acts.find((a) => a.rollAxis?.path === "perception" && a.kind === "save");
    const influence = acts.find((a) => a.rollAxis?.path === "influence" && a.kind === "save");
    expect(perception?.dcDie).toBe(40);
    expect(influence?.dcDie).toBe(40);
    expect(influence?.label).toContain("DV d40");
    // And the up-front 1d10 radiance damage is armed as damage.
    expect(acts.some((a) => a.kind === "damage" && a.expr === "1d10" && a.damageType === "Radiance")).toBe(true);
  });

  it("splits a contested pair into the actor's check and the target's save (Reverse Reaction)", () => {
    const acts = parseAbilityActions(byName("Reverse Reaction"));
    expect(acts.some((a) => a.kind === "self" && a.rollAxis?.path === "power")).toBe(true);
    expect(acts.some((a) => a.kind === "save" && a.rollAxis?.path === "recovery")).toBe(true);
    expect(acts.some((a) => a.kind === "save" && a.rollAxis?.path === "evasion" && a.dc === 13)).toBe(true);
  });

  it("reads the new damage types", () => {
    expect(parseAbilityActions("takes 1d6 Eldritch damage")[0]).toMatchObject({
      kind: "damage", expr: "1d6", damageType: "Eldritch",
    });
    expect(parseAbilityActions("take 3d8 Elemental damage (type matching dominant ambient element)")[0]).toMatchObject({
      kind: "damage", expr: "3d8", damageType: "Elemental",
    });
    expect(parseAbilityActions("takes 1d40 Spirit Damage")[0]).toMatchObject({
      kind: "damage", expr: "1d40", damageType: "Spirit",
    });
  });

  it("reads a cipher's contested resolution (Command)", () => {
    // Cipher texts route through the same parser on the sheet and the VTT.
    const acts = parseAbilityActions(
      "The Inquisitor makes a Mental Check — Capacity against the target's Influence Dice Value. If the Check succeeds, the target executes the command."
    );
    expect(acts.some((a) => a.kind === "self" && a.rollAxis?.path === "capacity")).toBe(true);
  });

  it("reads the shipped Systematic Collapse DV (Neuronal Capacity Modifier)", () => {
    // Ode/Code Level were retired from the shipped Cipher texts in favor of the
    // Capacity axis; the parser still accepts homebrew "<X> Level" terms.
    const acts = parseAbilityActions(
      "creatures within the collapse radius instead make a Physical Save — Recovery (DV 16 + Neuronal Capacity Modifier) each round or take 2d10 damage"
    );
    const save = acts.find((a) => a.rollAxis?.path === "recovery");
    expect(save).toMatchObject({ kind: "save", dc: 16, dcBonus: "Neuronal Capacity Modifier" });
    expect(save!.label).toContain("DV 16 + NC Mod");
    // Homebrew "<X> Level" bonus terms still parse.
    const legacy = parseAbilityActions("make a Physical Save — Recovery (DV 16 + Code Level) each round");
    expect(legacy.find((a) => a.rollAxis?.path === "recovery")?.dcBonus).toBe("Code Level");
  });
});

describe("who the dice land on, and which way the pool moves", () => {
  it("charges the Inquisitor's backlash to the Inquisitor, not the target", () => {
    // PSYCHIC SCREAM, verbatim: the caster's price shares a sentence with the
    // target's damage, and only the 2d8 belongs to whoever was screamed at.
    const acts = parseAbilityActions(
      "Creatures in a 20-ft cone take 2d8 psychic damage and are Stunned for 1 round. " +
        "On success: half damage, not Stunned. The Inquisitor takes 1d4 psychic backlash damage regardless."
    );
    expect(acts.find((a) => a.expr === "2d8")).toMatchObject({ kind: "damage" });
    expect(acts.find((a) => a.expr === "2d8")?.self).toBeUndefined();
    expect(acts.find((a) => a.expr === "1d4")).toMatchObject({ kind: "damage", self: true });
  });

  it("reads a bystander 'you' as a landmark, not as the one taking the hit", () => {
    // Luminance Overload names the user only as the point the cone is measured
    // from — the animates in it are the ones paying.
    const acts = parseAbilityActions(
      "Any animate within a 10 foot cone of the user will take 1d10 radiance damage."
    );
    expect(acts.find((a) => a.expr === "1d10")?.self).toBeUndefined();
    for (const preposition of ["of", "from", "near", "around", "within", "beside", "behind", "by", "with"]) {
      const near = parseAbilityActions(`Creatures ${preposition} you take 2d6 fire damage.`);
      expect(near.find((a) => a.expr === "2d6")?.self).toBeUndefined();
    }
    // The bare subject still reads as the caster's own cost.
    expect(parseAbilityActions("You take 2d6 fire damage.").find((a) => a.expr === "2d6")).toMatchObject({ self: true });
  });

  it("flags every SS tier of one heal, not just the first", () => {
    // Reconstruct, verbatim. "heals" is said ONCE and then three sets of dice
    // follow across semicolons — a clause-bounded window reaches only the 2d8
    // and the resolution card would deal 4d8 and 6d8 to the patient.
    const acts = parseAbilityActions(
      "On objects: restores structural integrity regardless of damage type. " +
        "On creatures: heals HP — 2d8 at SS 5; 4d8 at SS 10; 6d8 at SS 15; full HP + condition clear at SS 20."
    );
    for (const expr of ["2d8", "4d8", "6d8"]) {
      expect(acts.find((a) => a.expr === expr), expr).toMatchObject({ kind: "damage", restorative: true });
    }
  });

  it("catches a heal verb that sits further back than a clause window reaches", () => {
    // Enhanced Regeneration: 43 characters separate "regenerate" from its dice.
    const acts = parseAbilityActions(
      "Accelerated healing well beyond other species: regenerate significant damage over short rests (1d10 HP per short rest)."
    );
    expect(acts.find((a) => a.expr === "1d10")).toMatchObject({ restorative: true });
    // Other restorative verbs the shipped corpus uses.
    expect(parseAbilityActions("Target recovers 3d8 HP immediately.").find((a) => a.expr === "3d8")).toMatchObject({ restorative: true });
    expect(parseAbilityActions("stop bleeding (heal 1d8 HP as free action)").find((a) => a.expr === "1d8")).toMatchObject({ restorative: true });
    expect(parseAbilityActions("immediately regenerate 1d20 + END modifier HP instead.").find((a) => a.restorative)).toBeTruthy();
  });

  it("does not let a heal in an earlier sentence claim later damage", () => {
    const acts = parseAbilityActions("The ally heals 2d6 HP. The target then takes 3d10 Entropy damage.");
    expect(acts.find((a) => a.expr === "2d6")).toMatchObject({ restorative: true });
    expect(acts.find((a) => a.expr === "3d10")?.restorative).toBeUndefined();
  });

  it("keeps both flags off the rest of the shipped corpus", () => {
    // A flag that spreads is worse than a flag that misses: `self` silently
    // drops a consequence from the resolution card and `restorative` inverts
    // one. Pin the abilities that legitimately carry them so a future widening
    // of either predicate has to be deliberate.
    const corpus = [
      ...[...GENUS_DATA_BY_ID.values()].map((a) => ({ name: a.name, effect: a.effect })),
      ...[...CIPHER_DATA_BY_ID.values()].map((a) => ({ name: a.name, effect: a.effect })),
      ...SPECIES.flatMap((s) => speciesInnate(s.id).map((a) => ({ name: a.name, effect: a.effect }))),
      ...SPECIES.flatMap((s) => inceptsForSpecies(s.id).map((a) => ({ name: a.name, effect: a.effect }))),
    ];
    expect(corpus.length).toBeGreaterThan(300);

    const named = (flag: "self" | "restorative") =>
      [...new Set(corpus.filter((a) => parseAbilityActions(a.effect).some((x) => x[flag])).map((a) => a.name))].sort();

    expect(named("self")).toEqual(["PSYCHIC SCREAM"]);
    expect(named("restorative")).toEqual([
      "CELLULAR MASTERY",
      "CELLULAR REGENERATION",
      "Enhanced Regeneration",
      "Neurochemical Surge",
      "Rapid Regeneration",
      "Reconstruct",
    ]);
  });

  it("builds its patterns on every engine the app ships to", () => {
    // Tauri bundles for WebKit as well as WebView2, and an unsupported regex
    // construct throws where it is BUILT, not where it fails to match — one
    // such pattern would take out every ability row in the app, not one clause.
    const source = readFileSync(new URL("./abilityActions.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/\(\?<[=!]/);
  });
});
