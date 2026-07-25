import { describe, expect, it } from "vitest";
import { SIZE_CLASSES, ZOI_RADIUS, inZoneOfInfluence, sizeOf } from "./wte";

describe("Zone of Influence", () => {
  it("is 30 feet — the number gear, weapons and innates all quote", () => {
    expect(ZOI_RADIUS).toBe(30);
  });

  it("is inclusive of everything nearer than the radius, exclusive at the edge", () => {
    expect(inZoneOfInfluence(0)).toBe(true);
    expect(inZoneOfInfluence(29)).toBe(true);
    expect(inZoneOfInfluence(30)).toBe(false); // "Outside ZoI (30+ ft)"
    expect(inZoneOfInfluence(31)).toBe(false);
  });

  it("accepts a widened zone — an Aeor projects 40", () => {
    expect(inZoneOfInfluence(35)).toBe(false);
    expect(inZoneOfInfluence(35, 40)).toBe(true);
    expect(inZoneOfInfluence(40, 40)).toBe(false);
  });

  it("is NOT the same as reach — every size class projects the full zone", () => {
    // A Tiny creature has 0 reach and still exerts a 30 ft ZoI; a Colossal has
    // 25 ft reach, still 30 ft of zone. Reach is what you can touch; the zone is
    // what you threaten.
    for (const sc of SIZE_CLASSES) {
      expect(inZoneOfInfluence(sc.reach), `${sc.label} reach inside zone`).toBe(true);
      expect(sc.reach, `${sc.label} reach vs zone`).toBeLessThan(ZOI_RADIUS);
    }
    expect(sizeOf("tiny").reach).toBe(0);
    expect(sizeOf("colossal").reach).toBe(25);
  });
});
