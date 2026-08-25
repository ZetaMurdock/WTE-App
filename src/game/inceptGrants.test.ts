import { describe, expect, it } from "vitest";
import {
  grantLabel,
  isRollGrant,
  parseInceptGrants,
  parseRollRef,
  rollRefLabel,
  type InceptRollGrant,
} from "./inceptGrants";

describe("Roll Axis routes", () => {
  it("reads the form abilities already use", () => {
    expect(parseRollRef("Physical Save — Evasion")).toEqual({
      axis: "physical", direction: "save", path: "evasion",
    });
    expect(parseRollRef("Mental Check — Capacity")).toEqual({
      axis: "mental", direction: "check", path: "capacity",
    });
  });

  it("accepts the separators pages are actually authored with", () => {
    for (const sep of ["—", "–", "-", ":", "·"]) {
      expect(parseRollRef(`Physical Check ${sep} Power`)?.path).toBe("power");
    }
  });

  it("refuses a route the system does not have", () => {
    // Evasion is a save only; Power is a check only. An Incept sitting on a roll
    // that can never happen is worse than one that fails to parse.
    expect(parseRollRef("Physical Check — Evasion")).toBeNull();
    expect(parseRollRef("Physical Save — Power")).toBeNull();
    // Capacity is mental, not physical.
    expect(parseRollRef("Physical Check — Capacity")).toBeNull();
    expect(parseRollRef("Physical Check — Nonsense")).toBeNull();
  });

  it("round-trips its own label", () => {
    const ref = parseRollRef("Mental Save — Influence")!;
    expect(rollRefLabel(ref)).toBe("Mental Save — Influence");
    expect(parseRollRef(rollRefLabel(ref))).toEqual(ref);
  });
});

describe("grant lines", () => {
  it("reads advantage on the owner's roll", () => {
    const { grants, errors } = parseInceptGrants("- Advantage: Physical Check — Power");
    expect(errors).toEqual([]);
    expect(grants).toEqual([
      { kind: "advantage", on: { axis: "physical", direction: "check", path: "power" }, target: "self" },
    ]);
  });

  it("distinguishes a rule that hobbles the target", () => {
    const { grants } = parseInceptGrants("- Disadvantage (target): Physical Save — Evasion");
    expect((grants[0] as InceptRollGrant).target).toBe("target");
    expect(isRollGrant(grants[0])).toBe(true);
  });

  it("reads damage with and without a type", () => {
    const { grants } = parseInceptGrants("- Damage: 3d10 Entropy\n- Damage: 12");
    expect(grants).toEqual([
      { kind: "damage", expr: "3d10", damageType: "Entropy" },
      { kind: "damage", expr: "12", damageType: undefined },
    ]);
  });

  it("reads resource movement in the words pages use", () => {
    const { grants, errors } = parseInceptGrants(
      "- Restore: 1d50 SS\n- Cost: 10 Synaptic Space\n- Restore: 2d6 Health\n- Cost: 1 Focus"
    );
    expect(errors).toEqual([]);
    expect(grants.map((g) => "resource" in g && g.resource)).toEqual(["ss", "ss", "health", "focus"]);
  });

  it("reports a grant it cannot execute instead of dropping it", () => {
    // Silently granting nothing is exactly how the old prose Incepts failed.
    const { grants, errors } = parseInceptGrants(
      "- Advantage: on everything\n- Damage: lots\n- Restore: 5 Vibes\n- Bonus: +4 to all specialties"
    );
    expect(grants).toEqual([]);
    expect(errors).toHaveLength(4);
    expect(errors[0]).toContain("not a Roll Axis route");
    expect(errors[1]).toContain("not a dice or flat amount");
    expect(errors[2]).toContain("unknown resource");
    expect(errors[3]).toContain("unreadable grant");
  });

  it("ignores prose between the bullets", () => {
    const { grants, errors } = parseInceptGrants("Some framing text.\n\n- Damage: 2d8 Void\n");
    expect(errors).toEqual([]);
    expect(grants).toHaveLength(1);
  });

  it("accepts a dice expression with a modifier", () => {
    expect(parseInceptGrants("- Damage: 2d6+3 Force").grants).toEqual([
      { kind: "damage", expr: "2d6+3", damageType: "Force" },
    ]);
  });

  it("labels grants for the sheet", () => {
    const { grants } = parseInceptGrants(
      "- Advantage: Physical Check — Power\n- Disadvantage (target): Mental Save — Influence\n- Restore: 1d50 SS\n- Damage: 3d10 Entropy"
    );
    expect(grants.map(grantLabel)).toEqual([
      "You: Advantage on Physical Check — Power",
      "Target: Disadvantage on Mental Save — Influence",
      "Restore 1d50 SS",
      "3d10 Entropy",
    ]);
  });
});
