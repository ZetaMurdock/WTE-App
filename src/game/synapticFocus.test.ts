import { describe, expect, it } from "vitest";
import {
  FOCUS_PER_RANK,
  GENUS_FOCUS_MAX,
  INCEPT_FOCUS_COST,
  contestByRoll,
  emptySpend,
  focusBudget,
  focusContest,
  focusRemaining,
  focusSpent,
  genusFocus,
  knownGenus,
  lowerGenus,
  migrateLoadout,
  parseSpend,
  raiseGenus,
  relockIncept,
  unlockIncept,
  type FocusSpend,
} from "./synapticFocus";

const spend = (genus: Record<string, number>, incepts: string[] = []): FocusSpend => ({ genus, incepts });

describe("Synaptic Focus budget", () => {
  it("grants 3 per rank, rank 0 included", () => {
    expect(focusBudget(0)).toBe(FOCUS_PER_RANK);
    expect(focusBudget(9)).toBe(30);
    expect(focusBudget(-3)).toBe(FOCUS_PER_RANK); // a nonsense rank still boots
  });

  it("counts genus points and incepts against the same pool", () => {
    const s = spend({ Reflect: 4, Solidify: 2 }, ["Whisper"]);
    expect(focusSpent(s)).toBe(4 + 2 + INCEPT_FOCUS_COST);
    expect(focusRemaining(9, s)).toBe(30 - 9);
  });

  it("an incept costs exactly what taking a genus 1 -> 4 costs", () => {
    const viaGenus = spend({ Reflect: 4 });
    const viaIncept = spend({ Reflect: 1 }, ["Whisper"]);
    expect(focusSpent(viaGenus)).toBe(focusSpent(viaIncept));
  });
});

describe("spending on genus", () => {
  it("raises one point at a time and caps at 4", () => {
    let s = emptySpend();
    for (let i = 0; i < 6; i++) s = raiseGenus(s, "Reflect", 9);
    expect(genusFocus(s, "Reflect")).toBe(GENUS_FOCUS_MAX);
  });

  it("refuses to overspend the budget and reports the no-op", () => {
    // Rank 0 = 3 points.
    let s = emptySpend();
    s = raiseGenus(s, "Reflect", 0);
    s = raiseGenus(s, "Reflect", 0);
    s = raiseGenus(s, "Reflect", 0);
    expect(focusRemaining(0, s)).toBe(0);
    const blocked = raiseGenus(s, "Solidify", 0);
    expect(blocked).toBe(s); // same object back = rejected
  });

  it("lowering forgets the ability entirely at Focus 1", () => {
    let s = spend({ Reflect: 2 });
    s = lowerGenus(s, "Reflect");
    expect(genusFocus(s, "Reflect")).toBe(1);
    s = lowerGenus(s, "Reflect");
    expect(genusFocus(s, "Reflect")).toBe(0);
    expect(knownGenus(s)).toEqual([]);
    expect(lowerGenus(s, "Reflect")).toBe(s); // nothing to give back
  });

  it("Focus IS access — known genus is exactly what was invested in", () => {
    const s = spend({ Reflect: 1, Solidify: 4 });
    expect(knownGenus(s).sort()).toEqual(["Reflect", "Solidify"]);
  });
});

describe("incepts", () => {
  it("unlocks for 3 and refuses a duplicate", () => {
    let s = unlockIncept(emptySpend(), "Whisper", 9);
    expect(s.incepts).toEqual(["Whisper"]);
    expect(focusSpent(s)).toBe(3);
    expect(unlockIncept(s, "Whisper", 9)).toBe(s);
    s = relockIncept(s, "Whisper");
    expect(focusSpent(s)).toBe(0);
  });

  it("cannot be unlocked on a budget that can't cover it", () => {
    const s = spend({ Reflect: 2 }); // rank 0: 3 budget, 1 left, incept needs 3
    expect(unlockIncept(s, "Whisper", 0)).toBe(s);
  });
});

describe("legacy migration", () => {
  it("seeds each old loadout entry at Focus 1 within budget, truncating the rest", () => {
    const s = migrateLoadout(["A", "B", "C", "D", "E"], 0); // 3 points only
    expect(knownGenus(s)).toEqual(["A", "B", "C"]);
    expect(focusSpent(s)).toBe(3);
  });

  it("never upgrades anyone silently — everything lands at Focus 1", () => {
    const s = migrateLoadout(["A", "B"], 9);
    expect(Object.values(s.genus)).toEqual([1, 1]);
  });

  it("ignores blanks and duplicates", () => {
    const s = migrateLoadout(["A", "A", "", "B"], 9);
    expect(knownGenus(s)).toEqual(["A", "B"]);
  });
});

describe("parseSpend", () => {
  it("clamps and drops junk instead of throwing", () => {
    const s = parseSpend({ genus: { A: 99, B: 0, C: -2, D: "x" }, incepts: ["W", "W", 3] });
    expect(s.genus).toEqual({ A: GENUS_FOCUS_MAX });
    expect(s.incepts).toEqual(["W"]);
    expect(parseSpend(null)).toEqual(emptySpend());
  });
});

describe("genus vs genus", () => {
  const side = (label: string, focus: number, control = 40, rank = 0) => ({ label, focus, control, rank });

  it("higher Focus wins outright, no dice", () => {
    const r = focusContest(side("Reflect", 3), side("Solidify", 1));
    expect(r.winner).toBe("a");
    expect(r.byFocus).toBe(true);
    expect(r.aTotal).toBeUndefined();
  });

  it("the worked example: Reflect fails against a more focused Elemental", () => {
    const r = focusContest(side("Reflect", 2), side("Chain Reaction", 4));
    expect(r.winner).toBe("b");
    expect(r.byFocus).toBe(true);
    expect(r.note).toContain("fails");
  });

  it("equal Focus goes to a contested Control roll", () => {
    const r = focusContest(side("Reflect", 3), side("Solidify", 3));
    expect(r.byFocus).toBe(false);
    expect(typeof r.aTotal).toBe("number");
    expect(typeof r.bTotal).toBe("number");
  });

  it("a dead tie on the roll leaves the defender holding", () => {
    expect(contestByRoll(50, 50)).toBe("b");
    expect(contestByRoll(51, 50)).toBe("a");
    expect(contestByRoll(49, 50)).toBe("b");
  });

  it("rank multiplies the contest, so an Apex usually — not always — out-pushes a novice", () => {
    // Same Control (40) and Focus, rank 9 (x1.75) vs rank 0. Exact win rate is
    // 85.3% (1364/1600 die pairs), so ~171 of 200; the bound is set well clear of
    // the ~5-count spread. The upper bound is the point: rank dominates the
    // contest without making it a foregone conclusion.
    let apexWins = 0;
    for (let i = 0; i < 200; i++) {
      const r = focusContest(side("Apex", 3, 40, 9), side("Novice", 3, 40, 0));
      if (r.winner === "a") apexWins++;
    }
    expect(apexWins).toBeGreaterThan(145);
    expect(apexWins).toBeLessThan(200);
  });
});
