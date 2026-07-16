import { describe, it, expect } from "vitest";
import { lightFactor, lightRadiusScale } from "./lightState";

describe("lightFactor", () => {
  it("classic fog modes: lights always burn at full", () => {
    expect(lightFactor({ lit: false }, false)).toBe(1);
    expect(lightFactor({}, false)).toBe(1);
  });

  it("realistic: unlit lanterns give nothing", () => {
    expect(lightFactor({ lit: false }, true)).toBe(0);
    expect(lightFactor({}, true)).toBe(0);
  });

  it("realistic: lit with no burn time is an eternal flame", () => {
    expect(lightFactor({ lit: true }, true)).toBe(1);
    expect(lightFactor({ lit: true, litAt: 0, burnSeconds: 0 }, true, 999_999)).toBe(1);
  });

  it("realistic: burns down linearly and dies", () => {
    const l = { lit: true, litAt: 100_000, burnSeconds: 60 };
    expect(lightFactor(l, true, 100_000)).toBe(1); // just lit
    expect(lightFactor(l, true, 130_000)).toBeCloseTo(0.5); // half burned
    expect(lightFactor(l, true, 160_000)).toBe(0); // out
    expect(lightFactor(l, true, 999_000)).toBe(0); // stays out until relit
  });

  it("relighting resets the burn (fresh litAt = full factor)", () => {
    expect(lightFactor({ lit: true, litAt: 500_000, burnSeconds: 60 }, true, 500_000)).toBe(1);
  });
});

describe("lightRadiusScale", () => {
  it("shrinks with the burn but never below the dying-ember floor while alive", () => {
    expect(lightRadiusScale(1)).toBe(1);
    expect(lightRadiusScale(0.5)).toBeCloseTo(0.675);
    expect(lightRadiusScale(0)).toBe(0);
  });
});
