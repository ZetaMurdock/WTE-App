import { afterEach, describe, expect, it } from "vitest";
import {
  affinityExpr,
  affinityFor,
  affinityLabel,
  affinityTier,
  type AffinityContext,
} from "./paradigmAffinity";
import { ROLL_AXIS_PATHS, rollAxisChoices, rollAxisRoll, type RollAxisStats } from "./rollAxis";
import { parseDiceTerms, registerCodexGameData } from "./wte";
import { canonicalRollExpr } from "../lib/rolls";
import { parseParadigmPage } from "../lib/gameData";

const path = (id: string) => ROLL_AXIS_PATHS.find((p) => p.id === id)!;
const ctx = (paradigmId: string, rank: number, extra: Partial<AffinityContext> = {}): AffinityContext => ({
  paradigmId,
  rank,
  ...extra,
});

const STATS: RollAxisStats = {
  attr: { phy: 2, ap: 1, dex: 3, end: 2, wis: 4, int: 1, cha: 0 },
  spec: { wm: 5, pre: 2, bal: 1, adp: 3, mf: 6, per: 2, cun: 0 },
  derived: { atk: 1, ad: 0, ev: -1, rr: 2, nc: 3, pr: 1, inf: 0 },
};

afterEach(() => registerCodexGameData({}));

describe("rank tiers", () => {
  it("follows the pages' bracket table", () => {
    expect(affinityTier(0)).toBe(1);
    expect(affinityTier(1)).toBe(1);
    expect(affinityTier(2)).toBe(1);
    expect(affinityTier(3)).toBe(2);
    expect(affinityTier(5)).toBe(2);
    expect(affinityTier(6)).toBe(3);
    expect(affinityTier(8)).toBe(3);
    expect(affinityTier(9)).toBe(4);
  });
});

describe("who favors what", () => {
  it("Science converges on Capacity (Wisdom + Mental Fortitude)", () => {
    // Convergence: both pools, on EITHER source.
    expect(affinityFor(path("capacity"), "attribute", ctx("science", 4))).toEqual({ d5: 2, d10: 2, convergence: true });
    expect(affinityFor(path("capacity"), "specialty", ctx("science", 4))).toEqual({ d5: 2, d10: 2, convergence: true });
  });

  it("Science converges on Recovery (Endurance + Adaptation)", () => {
    expect(affinityFor(path("recovery"), "attribute", ctx("science", 9))).toEqual({ d5: 4, d10: 4, convergence: true });
  });

  it("Science gets nothing on Power, Evasion or Influence", () => {
    expect(affinityFor(path("power"), "attribute", ctx("science", 9))).toBeNull();
    expect(affinityFor(path("evasion"), "attribute", ctx("science", 9))).toBeNull();
    expect(affinityFor(path("evasion"), "specialty", ctx("science", 9))).toBeNull();
    expect(affinityFor(path("influence"), "specialty", ctx("science", 9))).toBeNull();
  });

  it("Warfare converges on Power and Density", () => {
    expect(affinityFor(path("power"), "attribute", ctx("warfare", 1))).toEqual({ d5: 1, d10: 1, convergence: true });
    expect(affinityFor(path("density"), "specialty", ctx("warfare", 6))).toEqual({ d5: 3, d10: 3, convergence: true });
    expect(affinityFor(path("capacity"), "attribute", ctx("warfare", 6))).toBeNull();
  });

  it("Evolution's Power favor is attribute-side only — Strength governs, Weapon Mastery does not", () => {
    expect(affinityFor(path("power"), "attribute", ctx("evolution", 3))).toEqual({ d5: 2, convergence: false });
    expect(affinityFor(path("power"), "specialty", ctx("evolution", 3))).toBeNull();
    // And Evasion favor is specialty-side only, through Balance.
    expect(affinityFor(path("evasion"), "specialty", ctx("evolution", 3))).toEqual({ d10: 2, convergence: false });
    expect(affinityFor(path("evasion"), "attribute", ctx("evolution", 3))).toBeNull();
    // Recovery is the fixed Convergence.
    expect(affinityFor(path("recovery"), "attribute", ctx("evolution", 3))).toEqual({ d5: 2, d10: 2, convergence: true });
  });

  it("Cognition converges on Influence and Perception", () => {
    expect(affinityFor(path("influence"), "specialty", ctx("cognition", 5))).toEqual({ d5: 2, d10: 2, convergence: true });
    expect(affinityFor(path("perception"), "attribute", ctx("cognition", 5))).toEqual({ d5: 2, d10: 2, convergence: true });
    expect(affinityFor(path("capacity"), "attribute", ctx("cognition", 5))).toBeNull();
  });

  it("Simulation converges on Perception and Capacity", () => {
    expect(affinityFor(path("perception"), "attribute", ctx("simulation", 2))).toEqual({ d5: 1, d10: 1, convergence: true });
    expect(affinityFor(path("capacity"), "specialty", ctx("simulation", 2))).toEqual({ d5: 1, d10: 1, convergence: true });
    expect(affinityFor(path("power"), "attribute", ctx("simulation", 2))).toBeNull();
  });
});

describe("Remnant's Field Affinity Selection", () => {
  it("has only Dexterity and Adaptation without a choice made", () => {
    // Dex governs Evasion's attribute side; Adaptation governs Recovery's specialty side.
    expect(affinityFor(path("evasion"), "attribute", ctx("remnant", 1))).toEqual({ d5: 1, convergence: false });
    expect(affinityFor(path("recovery"), "specialty", ctx("remnant", 1))).toEqual({ d10: 1, convergence: false });
    expect(affinityFor(path("power"), "attribute", ctx("remnant", 1))).toBeNull();
  });

  it("choosing Balance forms the Evasion Convergence the page names", () => {
    const c = ctx("remnant", 4, { extraSpec: "bal" });
    expect(affinityFor(path("evasion"), "attribute", c)).toEqual({ d5: 2, d10: 2, convergence: true });
  });

  it("choosing Endurance forms the Recovery Convergence", () => {
    const c = ctx("remnant", 4, { extraAttr: "end" });
    expect(affinityFor(path("recovery"), "specialty", c)).toEqual({ d5: 2, d10: 2, convergence: true });
  });

  it("a chosen stat on a NON-choice paradigm leaks nothing", () => {
    // A sheet that kept favoredAttr after switching from Remnant to Science.
    const c = ctx("science", 4, { extraAttr: "phy", extraSpec: "wm" });
    expect(affinityFor(path("power"), "attribute", c)).toBeNull();
  });
});

describe("through the Roll Axis pipeline", () => {
  it("rides inside the expression and the rolled formula", () => {
    const stats: RollAxisStats = { ...STATS, affinity: ctx("science", 4) };
    const [attr, spec] = rollAxisChoices(path("capacity"), "check", stats);
    expect(attr.expr).toBe("1d20+2d5+2d10+7");
    expect(spec.expr).toBe("1d40+2d5+2d10+9");
    expect(attr.affinity).toEqual({ d5: 2, d10: 2, convergence: true });

    const roll = rollAxisRoll(attr);
    expect(roll.formula).toContain("+2d5 +2d10 Convergence");
    // Bounds: 1d20(1..20) + 2d5(2..10) + 2d10(2..20) + 7
    expect(roll.result).toBeGreaterThanOrEqual(1 + 2 + 2 + 7);
    expect(roll.result).toBeLessThanOrEqual(20 + 10 + 20 + 7);
  });

  it("adds nothing when the supplier omits the context (table rule off)", () => {
    const [attr] = rollAxisChoices(path("capacity"), "check", STATS);
    expect(attr.expr).toBe("1d20+7");
    expect(attr.affinity).toBeUndefined();
  });

  it("expressions stay canonical for network correlation", () => {
    const stats: RollAxisStats = { ...STATS, affinity: ctx("warfare", 9) };
    const [attr] = rollAxisChoices(path("power"), "check", stats);
    // The exact string a peer re-derives must equal what the host stored —
    // a modifier placed before the dice tail made every requested roll hang.
    expect(canonicalRollExpr(attr.expr)).toBe(attr.expr);
    // And the roll itself carries that expression for the feed to validate.
    expect(rollAxisRoll(attr).baseExpr).toBe(attr.expr);
    const parsed = parseDiceTerms(attr.expr);
    expect(parsed).not.toBeNull();
    expect(parsed!.terms).toEqual([
      { count: 1, sides: 20 },
      { count: 4, sides: 5 },
      { count: 4, sides: 10 },
    ]);
  });
});

describe("campaign override of favored stats", () => {
  it("a paradigm page can retune a doctrine's Affinity", () => {
    const page = `# Warfare

| Type | Paradigm |
| ID | wte.paradigm.warfare |
| Name | Warfare |
| Group | Tactical Combat |
| Weapons | Hybrid, Exotic, Kinetic |
| Domains | Neutral, Photonic |
| Favored Attributes | Endurance · Wisdom |
| Favored Specialties | Adaptation · Mental Fortitude |
`;
    const parsed = parseParadigmPage(page, "warfare");
    expect(parsed?.favoredAttrs).toEqual(["end", "wis"]);
    expect(parsed?.favoredSpecs).toEqual(["adp", "mf"]);
    registerCodexGameData({ paradigms: [parsed!] });
    expect(affinityFor(path("recovery"), "attribute", ctx("warfare", 1))).toEqual({ d5: 1, d10: 1, convergence: true });
    expect(affinityFor(path("power"), "attribute", ctx("warfare", 1))).toBeNull();
  });

  it("a page without Affinity rows inherits the baked favored stats", () => {
    const page = `# Warfare

| Type | Paradigm |
| ID | wte.paradigm.warfare |
| Name | War Doctrine |
| Group | Tactical Combat |
| Weapons | Hybrid |
| Domains | Neutral, Photonic |
`;
    registerCodexGameData({ paradigms: [parseParadigmPage(page, "warfare")!] });
    // Renamed, but Strength + Weapon Mastery still converge on Power.
    expect(affinityFor(path("power"), "attribute", ctx("warfare", 1))).toEqual({ d5: 1, d10: 1, convergence: true });
  });

  it("a page can declare a Remnant-style choice slot", () => {
    const page = `# Remnant

| Type | Paradigm |
| ID | wte.paradigm.remnant |
| Name | Remnant |
| Group | Esoteric & Survival |
| Weapons | Kinetic |
| Domains | Photonic, Neutral |
| Favored Attributes | Dexterity · Choose 1 Additional Attribute |
| Favored Specialties | Adaptation · Choose 1 Additional Specialty |
`;
    const parsed = parseParadigmPage(page, "remnant")!;
    expect(parsed.favoredAttrs).toEqual(["dex"]);
    expect(parsed.favoredChoice).toBe(true);
  });
});

describe("labels", () => {
  it("prints the pools the pages describe", () => {
    expect(affinityLabel({ d5: 2, d10: 2, convergence: true })).toBe("+2d5 +2d10");
    expect(affinityLabel({ d5: 1, convergence: false })).toBe("+1d5");
    expect(affinityExpr({ d10: 3, convergence: false })).toBe("+3d10");
  });
});
