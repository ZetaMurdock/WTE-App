import { describe, expect, it } from "vitest";
import {
  CREDITS_PER_PALLADIUM,
  MAX_SHRIVES,
  SHRIVES_PER_CREDIT,
  SHRIVES_PER_PALLADIUM,
  addShrives,
  canAfford,
  clampShrives,
  formatMoney,
  formatMoneyLong,
  fromShrives,
  parseMoney,
  spendShrives,
  toShrives,
} from "./money";

describe("the conversion rates", () => {
  it("are the published ones", () => {
    expect(SHRIVES_PER_CREDIT).toBe(10_000);
    expect(CREDITS_PER_PALLADIUM).toBe(1_000_000);
    expect(SHRIVES_PER_PALLADIUM).toBe(10_000_000_000);
  });

  it("keep a Palladium exact — the whole reason Shrives are the base unit", () => {
    expect(SHRIVES_PER_PALLADIUM).toBeLessThan(Number.MAX_SAFE_INTEGER);
    expect(Number.isSafeInteger(SHRIVES_PER_PALLADIUM)).toBe(true);
  });
});

describe("collapsing and splitting", () => {
  it("round-trips a mixed purse", () => {
    const p = { palladium: 2, credits: 340_000, shrives: 5_000 };
    const total = toShrives(p);
    expect(fromShrives(total)).toEqual(p);
  });

  it("normalises an over-full component — 15,000 Sh is 1 Cr 5,000 Sh", () => {
    expect(fromShrives(toShrives({ shrives: 15_000 }))).toEqual({ palladium: 0, credits: 1, shrives: 5_000 });
  });

  it("carries credits up into Palladium", () => {
    expect(fromShrives(toShrives({ credits: CREDITS_PER_PALLADIUM }))).toEqual({
      palladium: 1,
      credits: 0,
      shrives: 0,
    });
    expect(fromShrives(toShrives({ credits: CREDITS_PER_PALLADIUM + 1 }))).toEqual({
      palladium: 1,
      credits: 1,
      shrives: 0,
    });
  });

  it("treats 1 Credit and 10,000 Shrives as the SAME amount", () => {
    // The bug this design exists to prevent.
    expect(toShrives({ credits: 1 })).toBe(toShrives({ shrives: 10_000 }));
    expect(toShrives({ credits: 1, shrives: 1 })).toBe(toShrives({ shrives: 10_001 }));
  });

  it("ignores missing and junk components", () => {
    expect(toShrives({})).toBe(0);
    expect(toShrives({ credits: NaN, shrives: 5 })).toBe(5);
  });
});

describe("clamping", () => {
  it("never goes negative — a debt is a story, not a negative purse", () => {
    expect(clampShrives(-1)).toBe(0);
    expect(toShrives({ shrives: -500 })).toBe(0);
    expect(addShrives(100, -500)).toBe(0);
  });

  it("stops at the last exactly-representable amount", () => {
    expect(clampShrives(Number.MAX_SAFE_INTEGER)).toBe(MAX_SHRIVES);
    expect(Number.isSafeInteger(MAX_SHRIVES)).toBe(true);
    expect(MAX_SHRIVES / SHRIVES_PER_PALLADIUM).toBe(900_719);
    // And the clamped value still splits cleanly, i.e. no precision was lost.
    const back = fromShrives(MAX_SHRIVES);
    expect(toShrives(back)).toBe(MAX_SHRIVES);
  });

  it("survives nonsense", () => {
    expect(clampShrives(NaN)).toBe(0);
    expect(clampShrives(Infinity)).toBe(MAX_SHRIVES);
    expect(clampShrives(1.7)).toBe(2);
  });
});

describe("formatting", () => {
  it("omits empty denominations", () => {
    expect(formatMoney(toShrives({ palladium: 2, credits: 340_000, shrives: 5_000 }))).toBe("2 Pd · 340,000 Cr · 5,000 Sh");
    expect(formatMoney(toShrives({ credits: 12 }))).toBe("12 Cr");
    expect(formatMoney(toShrives({ palladium: 1 }))).toBe("1 Pd");
  });

  it("shows an empty purse as 0 Sh rather than nothing at all", () => {
    expect(formatMoney(0)).toBe("0 Sh");
  });

  it("pluralises the long form", () => {
    expect(formatMoneyLong(toShrives({ credits: 1 }))).toBe("1 Credit");
    expect(formatMoneyLong(toShrives({ credits: 2 }))).toBe("2 Credits");
    expect(formatMoneyLong(toShrives({ shrives: 1 }))).toBe("1 Shrive");
    expect(formatMoneyLong(0)).toBe("0 Shrives");
  });
});

describe("parsing what someone types", () => {
  it("reads bare numbers as Shrives", () => {
    expect(parseMoney("500")).toBe(500);
    expect(parseMoney("5,000")).toBe(5_000);
  });

  it("reads unit suffixes, long and short", () => {
    expect(parseMoney("3cr")).toBe(3 * SHRIVES_PER_CREDIT);
    expect(parseMoney("3 credits")).toBe(3 * SHRIVES_PER_CREDIT);
    expect(parseMoney("2pd")).toBe(2 * SHRIVES_PER_PALLADIUM);
    expect(parseMoney("2 palladium")).toBe(2 * SHRIVES_PER_PALLADIUM);
    expect(parseMoney("40sh")).toBe(40);
    expect(parseMoney("40 shrives")).toBe(40);
  });

  it("sums a compound amount", () => {
    expect(parseMoney("2pd 300cr 50sh")).toBe(toShrives({ palladium: 2, credits: 300, shrives: 50 }));
    expect(parseMoney("1 Pd, 1 Cr, 1 Sh")).toBe(toShrives({ palladium: 1, credits: 1, shrives: 1 }));
  });

  it("distinguishes rubbish from zero", () => {
    expect(parseMoney("")).toBeNull();
    expect(parseMoney("   ")).toBeNull();
    expect(parseMoney("hello")).toBeNull();
    expect(parseMoney("0")).toBe(0); // zero is a real answer
  });

  it("clamps a negative or absurd entry", () => {
    expect(parseMoney("-5cr")).toBe(0);
    expect(parseMoney("999999999 pd")).toBe(MAX_SHRIVES);
  });
});

describe("spending", () => {
  it("tells you whether you can afford something", () => {
    const purse = toShrives({ credits: 5 });
    expect(canAfford(purse, toShrives({ credits: 5 }))).toBe(true);
    expect(canAfford(purse, toShrives({ credits: 5, shrives: 1 }))).toBe(false);
  });

  it("refuses rather than flooring at zero, so a shortfall must be handled", () => {
    const purse = toShrives({ credits: 1 });
    expect(spendShrives(purse, toShrives({ shrives: 4_000 }))).toBe(6_000);
    expect(spendShrives(purse, toShrives({ credits: 2 }))).toBeNull();
  });

  it("spends across denominations correctly", () => {
    // 1 Pd, pay 1 Sh -> 999,999 Cr and 9,999 Sh
    const after = spendShrives(toShrives({ palladium: 1 }), 1)!;
    expect(fromShrives(after)).toEqual({ palladium: 0, credits: 999_999, shrives: 9_999 });
  });
});
