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

  it("SPYDER replaced ANIMATION", () => {
    const all = ciphersForParadigm("remnant");
    expect(all.some((c) => c.name === "ANIMATION")).toBe(false);
    const spyder = all.find((c) => c.name === "SPYDER");
    expect(spyder).toMatchObject({ ss: 25, tier: "offline", type: "Bonus Action" });
    expect(spyder?.effect).toContain("Wanderer");
    expect(spyder?.effect).toContain("Causal Connection");
    expect(spyder?.effect).toContain("Minimum Success");
  });

  it("saved loadouts holding old cipher names resolve to the new ones", () => {
    const [c] = usableCiphers("remnant", ["ANIMATION"]);
    expect(c.name).toBe("SPYDER");
    expect(c.ss).toBe(25);
    expect(c.activation).toBe("Bonus Action");
    const [c2] = usableCiphers("remnant", ["SPYDER SPYDER"]);
    expect(c2.name).toBe("SPYDER");
    const [c3] = usableCiphers("science", ["STABLIZE"]);
    expect(c3.name).toBe("STABILIZE");
    expect(c3.ss).toBe(40);
  });
});

// The full six-Paradigm catalog rebuilt from the wiki pages (2026-07-20).
describe("Paradigm cipher catalog", () => {
  const EXPECT: Record<string, { off: number; on: number; sp: number }> = {
    science: { off: 10, on: 10, sp: 5 },
    simulation: { off: 10, on: 10, sp: 5 },
    remnant: { off: 10, on: 10, sp: 5 },
    cognition: { off: 10, on: 9, sp: 5 },
    evolution: { off: 11, on: 9, sp: 5 },
    warfare: { off: 10, on: 9, sp: 5 },
  };

  it("every paradigm carries the published tier counts", () => {
    for (const [pid, want] of Object.entries(EXPECT)) {
      const all = ciphersForParadigm(pid);
      const count = (t: string) => all.filter((c) => c.tier === t).length;
      expect({ pid, off: count("offline"), on: count("online"), sp: count("special") }).toEqual({ pid, ...want });
    }
  });

  it("every entry has a name, SS value, type, and rank/component prose", () => {
    for (const pid of Object.keys(EXPECT)) {
      for (const c of ciphersForParadigm(pid)) {
        expect(c.name.length).toBeGreaterThan(0);
        expect(c.type ?? "").not.toBe("");
        expect(c.effect ?? "").toContain("Rank:");
        expect(c.effect ?? "").toContain("Component:");
        if (c.name !== "S5 — THE LAST STAND") expect(c.ss ?? 0).toBeGreaterThan(0);
      }
    }
  });

  it("the respelled entries exist under their corrected names", () => {
    const names = (pid: string) => ciphersForParadigm(pid).map((c) => c.name);
    expect(names("science")).toContain("STABILIZE");
    expect(names("science")).toContain("BIPARTITION");
    expect(names("cognition")).toContain("ARITHMETIC");
    expect(names("cognition")).toContain("DIFFUSE");
    expect(names("warfare")).toContain("AUTHORITATIVE");
    expect(names("remnant")).toContain("QUICK HACK");
    expect(names("remnant")).toContain("S4 — LEGACY CIPHER");
  });
});
