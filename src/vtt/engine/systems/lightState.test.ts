import { describe, it, expect } from "vitest";
import { burnMechanicOn, inLightCone, isDirectional, lightFactor, lightRadiusScale } from "./lightState";

describe("burnMechanicOn — the lantern mechanic is OPTIONAL", () => {
  it("only applies in realistic fog", () => {
    expect(burnMechanicOn({ mode: "realistic" })).toBe(true);
    expect(burnMechanicOn({ mode: "remembered" })).toBe(false);
    expect(burnMechanicOn({ mode: "pitch" })).toBe(false);
  });
  it("a scene can switch it off even in realistic fog", () => {
    expect(burnMechanicOn({ mode: "realistic", lanterns: false })).toBe(false);
    expect(burnMechanicOn({ mode: "realistic", lanterns: true })).toBe(true);
  });
});

describe("alwaysOn lights opt out of burning", () => {
  it("stay at full even unlit under the mechanic", () => {
    expect(lightFactor({ lit: false, alwaysOn: true }, true)).toBe(1);
    expect(lightFactor({ lit: true, litAt: 0, burnSeconds: 10, alwaysOn: true }, true, 999_999)).toBe(1);
  });
  it("without the flag they still burn out", () => {
    expect(lightFactor({ lit: false }, true)).toBe(0);
  });
});

describe("directional lights", () => {
  it("omni when unset or a full circle", () => {
    expect(isDirectional({})).toBe(false);
    expect(isDirectional({ dir: 0, cone: 360 })).toBe(false);
    expect(inLightCone({}, 1, 0)).toBe(true);
    expect(inLightCone({ dir: 0, cone: 360 }, -1, 0)).toBe(true);
  });
  it("a 90° cone pointing east lights east, not west", () => {
    const l = { dir: 0, cone: 90 };
    expect(isDirectional(l)).toBe(true);
    expect(inLightCone(l, 10, 0)).toBe(true); // straight ahead
    expect(inLightCone(l, 10, 4)).toBe(true); // within ±45°
    expect(inLightCone(l, -10, 0)).toBe(false); // behind
    expect(inLightCone(l, 0, 10)).toBe(false); // 90° off-axis
  });
  it("handles the wrap at ±π (pointing west)", () => {
    const l = { dir: Math.PI, cone: 90 };
    expect(inLightCone(l, -10, 0)).toBe(true);
    expect(inLightCone(l, -10, 1)).toBe(true);
    expect(inLightCone(l, 10, 0)).toBe(false);
  });
});

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
