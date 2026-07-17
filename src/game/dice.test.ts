import { describe, it, expect } from "vitest";
import { parseDiceExpr, rollDiceExpr, diceExprFromText } from "./wte";

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
