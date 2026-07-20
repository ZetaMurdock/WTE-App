import { describe, expect, it } from "vitest";
import { PARADIGMS, ciphersForParadigm, genusForParadigm, usableCiphers } from "./wte";

describe("Remnant Paradigm rework", () => {
  it("energy domains are Null and Neutral", () => {
    expect(PARADIGMS.find((p) => p.id === "remnant")?.domains).toEqual(["Null", "Neutral"]);
    const domains = genusForParadigm("remnant").map((g) => g.domain);
    expect(domains).toContain("Null");
    expect(domains).toContain("Neutral");
    expect(domains).not.toContain("Kinetic");
  });

  it("SPYDER SPYDER replaced ANIMATION", () => {
    const all = ciphersForParadigm("remnant");
    expect(all.some((c) => c.name === "ANIMATION")).toBe(false);
    const spyder = all.find((c) => c.name === "SPYDER SPYDER");
    expect(spyder).toMatchObject({ ss: 25, tier: "offline", type: "Bonus Action" });
    expect(spyder?.effect).toContain("Wanderer");
    expect(spyder?.effect).toContain("Causal Connection");
    expect(spyder?.effect).toContain("Minimum Success");
  });

  it("saved loadouts holding the old cipher resolve to the new one", () => {
    const [c] = usableCiphers("remnant", ["ANIMATION"]);
    expect(c.name).toBe("SPYDER SPYDER");
    expect(c.ss).toBe(25);
    expect(c.activation).toBe("Bonus Action");
  });
});
