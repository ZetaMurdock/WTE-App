import { afterEach, describe, expect, it, vi } from "vitest";
import { rollAxisChoices, rollAxisPaths, rollAxisRoll, type RollAxisStats } from "./rollAxis";

const stats: RollAxisStats = {
  attr: { phy: 2, ap: 1, dex: 2, end: 0, wis: 1, int: 3, cha: -1 },
  spec: { wm: 4, pre: 3, bal: -2, adp: 1, mf: 0, per: 5, cun: -3 },
  derived: { atk: 3, ad: 2, ev: -3, rr: -1, nc: 4, pr: 1, inf: -2 },
};

afterEach(() => vi.restoreAllMocks());

describe("Roll Axis", () => {
  it("maps all seven paths to the correct directions", () => {
    expect(rollAxisPaths("physical", "check").map((path) => path.id)).toEqual(["power", "density"]);
    expect(rollAxisPaths("physical", "save").map((path) => path.id)).toEqual(["evasion", "recovery"]);
    expect(rollAxisPaths("mental", "check").map((path) => path.id)).toEqual(["capacity", "perception", "influence"]);
    expect(rollAxisPaths("mental", "save").map((path) => path.id)).toEqual(["perception", "influence"]);
  });

  it("applies a negative Evasion modifier to both source choices", () => {
    const path = rollAxisPaths("physical", "save")[0];
    const [dex, balance] = rollAxisChoices(path, "save", stats);
    expect(dex).toMatchObject({ die: 20, sourceMod: 2, derivedMod: -3, totalMod: -1, expr: "1d20-1" });
    expect(balance).toMatchObject({ die: 40, sourceMod: -2, derivedMod: -3, totalMod: -5, expr: "1d40-5" });
  });

  it("keeps a cancelling negative path modifier visible in the rolled formula", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.5); // d20 = 11
    const path = rollAxisPaths("physical", "save")[0];
    const choice = rollAxisChoices(path, "save", stats)[0];
    const roll = rollAxisRoll(choice);
    expect(roll.result).toBe(10);
    expect(roll.formula).toBe("1d20 + 2 DEX - 3 EV");
    expect(roll.detail.modifier).toBe(-1);
  });

  it("uses the NC modifier for Capacity rather than the NC resource pool", () => {
    const path = rollAxisPaths("mental", "check")[0];
    expect(rollAxisChoices(path, "check", stats)[0]).toMatchObject({ derivedMod: 4, totalMod: 5, expr: "1d20+5" });
  });
});
