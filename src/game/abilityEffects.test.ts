import { describe, it, expect } from "vitest";
import { effectLine, effectStepLabel, effectStepsToActions, parseAbilityEffects } from "./abilityEffects";

/** Every block here round-trips: what the parser reads, the emitter writes back
 *  byte-for-byte. The Mechanics editor rebuilds pages from the model, so a step
 *  it could not re-emit is a step it silently deleted. */
const roundTrips = (block: string) => {
  const { steps, errors } = parseAbilityEffects(block);
  expect(errors).toEqual([]);
  expect(steps.map(effectLine).join("\n")).toBe(block);
  return steps;
};

describe("reading a declared block", () => {
  it("binds a consequence to the branch that arms it", () => {
    const steps = roundTrips(
      [
        "- Cost: 6 SS",
        "- Save: Physical Save — Recovery, DV 18",
        "- Fail: Damage: 3d10 Cold, half on success",
        "- Fail: Condition: Slowed, 2 rounds",
      ].join("\n")
    );
    expect(steps.map((s) => `${s.verb}/${s.branch}`)).toEqual([
      "cost/always",
      "save/always",
      "damage/fail",
      "condition/fail",
    ]);
    expect(steps[2]).toMatchObject({ expr: "3d10", damageType: "Cold", half: true });
  });

  it("writes back the canonical form, dropping a selector that only restates the default", () => {
    const { steps } = parseAbilityEffects("- Save (target): Physical Save — Evasion");
    expect(effectLine(steps[0])).toBe("- Save: Physical Save — Evasion");
  });

  it("defaults the selector per verb — a Check is the caster's, a Save the target's", () => {
    const { steps } = parseAbilityEffects("- Roll: Mental Check — Capacity\n- Save: Physical Save — Evasion");
    expect(steps.map((s) => s.who)).toEqual(["self", "target"]);
  });

  it("refuses a route the system does not have", () => {
    // Evasion is a save and has no check; accepting it would put an ability on a
    // roll that can never happen.
    const { steps, errors } = parseAbilityEffects("- Roll: Physical Check — Evasion");
    expect(steps).toEqual([]);
    expect(errors).toHaveLength(1);
  });

  it("reports an unknown verb rather than dropping the line", () => {
    const { steps, errors } = parseAbilityEffects("- Teleport: 30 ft");
    expect(steps).toEqual([]);
    expect(errors[0]).toContain("Teleport");
  });

  it("takes any condition name, because the Conditions page defines it and not this parser", () => {
    const { steps, errors } = parseAbilityEffects("- Condition: Blighted, 3 rounds");
    expect(errors).toEqual([]);
    expect(steps[0]).toMatchObject({ condition: "Blighted", duration: { kind: "rounds", count: 3 } });
  });
});

describe("zones and cadence", () => {
  it("reads a placed zone and an aura that travels with its caster", () => {
    const steps = roundTrips(
      ["- Zone: circle 30 ft, attach point, 2 rounds", "- Zone: circle 15 ft, attach self, scene"].join("\n")
    );
    expect(steps[0]).toMatchObject({ shape: "circle", sizeFt: 30, attach: "point" });
    expect(steps[1]).toMatchObject({ attach: "self", duration: { kind: "scene" } });
    expect(effectStepLabel(steps[1])).toContain("Aura");
  });

  it("keeps cadence orthogonal to branch — a zone ticks every round, the damage still needs a failure", () => {
    const steps = roundTrips(
      ["- Each round: Save: Physical Save — Recovery, DV 18", "- Each round: Fail: Damage: 3d10 Cold"].join("\n")
    );
    expect(steps.map((s) => `${s.cadence}/${s.branch}`)).toEqual(["each-round/always", "each-round/fail"]);
  });

  it("refuses a shape it cannot place, and a size with no unit", () => {
    const { steps, errors } = parseAbilityEffects("- Zone: trapezoid 20 ft\n- Zone: circle 30");
    expect(steps).toEqual([]);
    expect(errors).toHaveLength(2);
  });
});

describe("declared steps as the actions the UI already renders", () => {
  it("hands rolls, saves and damage to the existing chip renderer", () => {
    const { steps } = parseAbilityEffects(
      ["- Cost: 6 SS", "- Save: Physical Save — Recovery, DV 18", "- Fail: Damage: 2d8 Cold", "- Ruling: adjudicate"].join("\n")
    );
    const actions = effectStepsToActions(steps);
    // Cost and Ruling have no rollable face; they are shown from the steps.
    expect(actions.map((a) => a.kind)).toEqual(["save", "damage"]);
    expect(actions[0]).toMatchObject({ rollAxis: { axis: "physical", direction: "save", path: "recovery" }, dc: 18 });
    expect(actions[1]).toMatchObject({ expr: "2d8", damageType: "Cold" });
  });

  it("marks a caster's own price so no consumer charges it to the target", () => {
    const { steps } = parseAbilityEffects("- Damage (self): 1d4 Psychic");
    expect(effectStepsToActions(steps)[0]).toMatchObject({ self: true });
  });

  it("puts a Save the ACTOR makes on the actor's side of the tray", () => {
    // Primed Instinct's page hands the Venarian its own Mental Save — Perception.
    // Keying the side off the verb made that unsayable: the only way to stop the
    // "vs" chip was to declare no step, which deleted the roll instead of moving
    // it. The selector the parser already read now decides.
    const { steps } = parseAbilityEffects("- Save (self): Mental Save — Perception");
    expect(effectStepsToActions(steps)[0]).toMatchObject({
      kind: "self",
      rollAxis: { axis: "mental", direction: "save", path: "perception" },
    });
  });

  it("leaves the defaults and the other selectors on the target's side", () => {
    // The corpus ships `Save (enemies)` (Remnant · Phase Echoes) and plain
    // `Save`. Neither may move: this change is only about `(self)`.
    const { steps } = parseAbilityEffects(
      ["- Save: Physical Save — Recovery", "- Save (enemies): Mental Save — Perception, DV 13", "- Roll: Mental Check — Capacity"].join("\n")
    );
    expect(effectStepsToActions(steps).map((a) => a.kind)).toEqual(["save", "save", "self"]);
  });

  it("keeps a threshold's payload out of the tray until the track reaches it", () => {
    // The button was pressable on the first point of Blight, which landed the
    // 1d100 seven points early. A crossing arms it, and only `crossedThresholds`
    // can say a crossing happened.
    const { steps } = parseAbilityEffects(
      ["- Counter: Blight +1, cap 8", "- At 8: Damage: 1d100", "- At 8: Save: Physical Save — Recovery, DV 18"].join("\n")
    );
    expect(steps).toHaveLength(3);
    expect(effectStepsToActions(steps)).toEqual([]);
  });

  it("still arms the ability's own rolls on a page that also declares a threshold", () => {
    // The fix must not swallow the whole page: everything above `At N` is an
    // ordinary step and still owes the Curator its chip.
    const { steps } = parseAbilityEffects(
      ["- Save: Physical Save — Recovery, DV 18", "- Counter: Blight +1, cap 8", "- At 8: Damage: 1d100"].join("\n")
    );
    expect(effectStepsToActions(steps).map((a) => a.kind)).toEqual(["save"]);
  });
});

describe("tracks and bodies", () => {
  it("reads a custom currency and the threshold that watches it", () => {
    // Blight, Fear Points, Overload Charges — one mechanism, many names, so a
    // table inventing its own currency needs no parser change.
    const steps = roundTrips(
      ["- Counter: Blight +1, cap 8", "- At 8: Damage: 1d100", "- At 8: Condition: Incapacitated"].join("\n")
    );
    expect(steps[0]).toMatchObject({ verb: "counter", counter: "Blight", delta: 1, cap: 8 });
    // The threshold resolves to the track above it AT PARSE TIME, so no consumer
    // has to re-derive meaning from bullet order.
    expect(steps[1]).toMatchObject({ cadence: "at-threshold", threshold: 8, counter: "Blight" });
    expect(steps[2].counter).toBe("Blight");
  });

  it("refuses a threshold with no track declared above it", () => {
    const { steps, errors } = parseAbilityEffects("- At 8: Damage: 1d100");
    expect(steps).toEqual([]);
    expect(errors[0]).toContain("At 8");
  });

  it("reads a summon with and without a count", () => {
    const steps = roundTrips(["- Summon: 100 Lesser Stygian", "- Summon: Kirkndomou"].join("\n"));
    expect(steps[0]).toMatchObject({ count: 100, summon: "Lesser Stygian" });
    expect(steps[1]).toMatchObject({ count: 1, summon: "Kirkndomou" });
  });

  it("refuses a counter with no direction", () => {
    const { steps, errors } = parseAbilityEffects("- Counter: Blight");
    expect(steps).toEqual([]);
    expect(errors).toHaveLength(1);
  });
});

describe("the meta layer", () => {
  it("reads what one ability does to another's effect", () => {
    // Negate, Reflect, Catalyst, Null Zone, Spyder, Quick Hack — a third of the
    // corpus acts on effects rather than bodies.
    const steps = roundTrips(["- Tamper: negate", "- Tamper: delay, 1 round", "- Tamper: reflect"].join("\n"));
    expect(steps.map((step) => step.tamper)).toEqual(["negate", "delay", "reflect"]);
    expect(steps[1].duration).toEqual({ kind: "rounds", count: 1 });
    expect(effectStepLabel(steps[0])).toContain("Negate effect");
  });

  it("calls another ability by name, because ability-as-macro is canon", () => {
    // The Last War invokes Weaponize, Hollow Shell and Trixt Link by name.
    const steps = roundTrips(["- Invoke: Weaponize", "- Invoke: Hollow Shell"].join("\n"));
    expect(steps.map((step) => step.invoke)).toEqual(["Weaponize", "Hollow Shell"]);
  });

  it("takes any origin word, because a Medium belongs to a setting", () => {
    const steps = roundTrips(["- Origin: Medium", "- Origin: shadow"].join("\n"));
    expect(steps.map((step) => step.origin)).toEqual(["Medium", "shadow"]);
    expect(effectStepLabel(steps[0])).toBe("From Medium");
  });

  it("refuses a tamper the engine has no operation for", () => {
    const { steps, errors } = parseAbilityEffects("- Tamper: obliterate");
    expect(steps).toEqual([]);
    expect(errors[0]).toContain("obliterate");
  });

  it("refuses an invoke and an origin with nothing named", () => {
    const { errors } = parseAbilityEffects(["- Invoke:", "- Origin:"].join("\n"));
    expect(errors).toHaveLength(2);
  });
});
