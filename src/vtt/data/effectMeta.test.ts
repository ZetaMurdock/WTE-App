import { describe, it, expect } from "vitest";
import { parseEffectMeta, metaToPixels, suggestedTemplate, hasAoe, normUnit } from "./effectMeta";

describe("parseEffectMeta", () => {
  it("reads a radius burst with all-targets and damage dice", () => {
    const m = parseEffectMeta("Deal 3d6 fire damage to all enemies in a 15 ft radius burst");
    expect(m.pattern).toBe("circle");
    expect(m.area).toEqual({ shape: "radius", size: 15, unit: "ft" });
    expect(m.targets).toBe("all");
    expect(m.values).toContainEqual({ type: "damage", expr: "3d6" });
  });

  it("reads a cone with a lingering duration", () => {
    const m = parseEffectMeta("A 30 ft cone of frost dealing 2d8 cold, lasts 3 rounds");
    expect(m.pattern).toBe("cone");
    expect(m.area?.size).toBe(30);
    expect(m.duration).toBe(3);
    expect(m.values).toContainEqual({ type: "damage", expr: "2d8" });
  });

  it("reads a line/beam with a single target", () => {
    const m = parseEffectMeta("Fire a beam in a line, 1d10 lightning to a single target");
    expect(m.pattern).toBe("line");
    expect(m.targets).toBe(1);
  });

  it("reads a self-attached aura with range and healing", () => {
    const m = parseEffectMeta("Aura around you: all allies within 10 ft heal 2d4");
    expect(m.attach).toBe("self");
    expect(m.targets).toBe("all");
    expect(m.range).toEqual({ value: 10, unit: "ft" });
    expect(m.values).toContainEqual({ type: "heal", expr: "2d4" });
  });

  it("reads ring and cross patterns", () => {
    expect(parseEffectMeta("Summon a ring of thorns, 4 cell radius").pattern).toBe("ring");
    expect(parseEffectMeta("A cross-shaped burst of force").pattern).toBe("cross");
  });

  it("reads target attachment and flat heals", () => {
    const m = parseEffectMeta("Marks the target; heals 12 on contact");
    expect(m.attach).toBe("target");
    expect(m.values).toContainEqual({ type: "heal", amount: 12 });
  });

  it("returns an empty meta for plain prose", () => {
    const m = parseEffectMeta("You feel a strange chill.");
    expect(hasAoe(m)).toBe(false);
    expect(m.targets).toBeNull();
    expect(m.values).toEqual([]);
  });

  it("tolerates null/empty input", () => {
    expect(parseEffectMeta(null).pattern).toBeNull();
    expect(parseEffectMeta("").area).toBeNull();
  });
});

describe("metaToPixels", () => {
  it("converts ft (5/cell), m (1.5/cell), and cells", () => {
    expect(metaToPixels(15, "ft", 70)).toBe(210);
    expect(metaToPixels(3, "m", 70)).toBe(140);
    expect(metaToPixels(4, "cells", 70)).toBe(280);
    expect(metaToPixels(0, "ft", 70)).toBe(0);
  });
});

describe("normUnit", () => {
  it("normalizes unit spellings", () => {
    expect(normUnit("meters")).toBe("m");
    expect(normUnit("feet")).toBe("ft");
    expect(normUnit("squares")).toBe("cells");
    expect(normUnit(undefined)).toBe("cells");
  });
});

describe("suggestedTemplate", () => {
  it("maps patterns to real engine kinds", () => {
    expect(suggestedTemplate(parseEffectMeta("fire a beam in a line")).kind).toBe("line");
    expect(suggestedTemplate(parseEffectMeta("a wall of fire")).kind).toBe("line");
    expect(suggestedTemplate(parseEffectMeta("a ring of thorns")).kind).toBe("ring");
    expect(suggestedTemplate(parseEffectMeta("a cross-shaped blast")).kind).toBe("cross");
    expect(suggestedTemplate(parseEffectMeta("a 15 ft radius burst")).kind).toBe("circle");
    expect(suggestedTemplate(parseEffectMeta("a 30 ft cone")).kind).toBe("cone");
  });

  it("converts declared sizes to cells (ft/5, m/1.5, default 2)", () => {
    expect(suggestedTemplate(parseEffectMeta("a 15 ft radius burst")).cells).toBe(3);
    expect(suggestedTemplate(parseEffectMeta("a 3 m radius burst")).cells).toBe(2);
    expect(suggestedTemplate(parseEffectMeta("a cone of cold")).cells).toBe(2); // no size → default
  });
});
