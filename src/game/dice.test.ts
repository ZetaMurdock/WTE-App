import { describe, it, expect } from "vitest";
import { parseDiceTerms, diceTermsExpr, parseDiceExpr, rollDiceExpr, diceExprFromText } from "./wte";

describe("parseDiceExpr (legacy dice-panel expressions)", () => {
  it("parses the classic forms", () => {
    expect(parseDiceExpr("2d6+3")).toEqual({ count: 2, sides: 6, mod: 3 });
    expect(parseDiceExpr("d20")).toEqual({ count: 1, sides: 20, mod: 0 });
    expect(parseDiceExpr("3d8-1")).toEqual({ count: 3, sides: 8, mod: -1 });
    expect(parseDiceExpr(" 1 D 40 + 5 ")).toEqual({ count: 1, sides: 40, mod: 5 });
  });
  it("rejects garbage", () => {
    expect(parseDiceExpr("banana")).toBeNull();
    expect(parseDiceExpr("2d")).toBeNull();
    expect(parseDiceExpr("d1")).toBeNull(); // no 1-sided dice
    expect(parseDiceExpr("0d6")).toBeNull();
  });
});

describe("rollDiceExpr", () => {
  it("rolls within bounds and carries the label + modifier", () => {
    for (let i = 0; i < 50; i++) {
      const r = rollDiceExpr("Mantis Blades", "2d6+3");
      expect(r).not.toBeNull();
      expect(r!.result).toBeGreaterThanOrEqual(2 + 3);
      expect(r!.result).toBeLessThanOrEqual(12 + 3);
      expect(r!.formula).toBe("2d6+3");
      expect(r!.detail.label).toBe("Mantis Blades");
    }
  });
  it("returns null instead of rolling nonsense", () => {
    expect(rollDiceExpr("x", "not dice")).toBeNull();
  });
});

describe("diceExprFromText", () => {
  it("finds the first dice expression in ability prose", () => {
    expect(diceExprFromText("Deal 3d6 fire damage in a burst")).toBe("3d6");
    expect(diceExprFromText("2d8+1 kinetic")).toBe("2d8+1");
    expect(diceExprFromText("heals d4 per round")).toBe("1d4");
    expect(diceExprFromText("no dice here")).toBeNull();
    expect(diceExprFromText(null)).toBeNull();
  });
});

describe("multi-term dice sums (Paradigm Affinity)", () => {
  it("parses a core die plus affinity pools", () => {
    expect(parseDiceTerms("1d20+7+2d5+2d10")).toEqual({
      terms: [{ count: 1, sides: 20 }, { count: 2, sides: 5 }, { count: 2, sides: 10 }],
      mod: 7,
    });
    expect(parseDiceTerms("d40-3+1d10")).toEqual({
      terms: [{ count: 1, sides: 40 }, { count: 1, sides: 10 }],
      mod: -3,
    });
  });

  it("keeps single-term behavior byte-identical", () => {
    // The whole network correlates on these strings; they must not move.
    expect(diceTermsExpr(parseDiceTerms("2d6+3")!)).toBe("2d6+3");
    expect(diceTermsExpr(parseDiceTerms(" d20 + 03 ")!)).toBe("1d20+3");
    const roll = rollDiceExpr("t", "2d6+3")!;
    expect(roll.formula).toBe("2d6+3");
    expect(roll.detail.die).toBe(6);
  });

  it("rejects what it always rejected, plus negative dice", () => {
    expect(parseDiceTerms("")).toBeNull();
    expect(parseDiceTerms("7")).toBeNull(); // no dice term
    expect(parseDiceTerms("1d1")).toBeNull();
    expect(parseDiceTerms("0d6")).toBeNull();
    expect(parseDiceTerms("1d20-2d5")).toBeNull(); // negative dice are authoring errors
    expect(parseDiceTerms("nonsense")).toBeNull();
  });

  it("rolls a compound expression within its exact bounds", () => {
    for (let i = 0; i < 60; i++) {
      const roll = rollDiceExpr("t", "1d20+4d5+4d10+9")!;
      expect(roll.result).toBeGreaterThanOrEqual(1 + 4 + 4 + 9);
      expect(roll.result).toBeLessThanOrEqual(20 + 20 + 40 + 9);
      expect(roll.detail.die).toBe(20);
      expect(roll.detail.modifier).toBe(9);
    }
  });

  it("advantage rolls the whole pool twice and keeps the higher total", () => {
    const roll = rollDiceExpr("t", "1d20+2d5", "adv")!;
    const totals = roll.detail.rolls ?? [];
    expect(totals).toHaveLength(2);
    expect(roll.detail.roll).toBe(Math.max(...totals));
  });
});
