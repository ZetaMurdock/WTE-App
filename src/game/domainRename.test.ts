// The Kinetic -> Photonic domain rename.
//
// Recorded the same way every other rename in this app is: the identity stays,
// the label changes, the former name keeps resolving. That matters more here than
// it looks, because the old name is still written throughout gear.json,
// weapons.json and the installed Codex pages — a requirement naming a domain that
// no longer exists can never be met, so those items were locked for everyone.
import { describe, expect, it } from "vitest";
import { canonicalDomain, getGenusDomain, GENUS_DOMAIN_NAMES, getParadigm } from "./wte";
import { weaponDomainsMet } from "../lib/codex";
import weaponsData from "./data/weapons.json";
import gearData from "./data/gear.json";

describe("the former domain name still resolves", () => {
  it("maps Kinetic to Photonic", () => {
    expect(canonicalDomain("Kinetic")).toBe("Photonic");
  });

  it("is case-insensitive, because authored pages are inconsistent", () => {
    expect(canonicalDomain("kinetic")).toBe("Photonic");
    expect(canonicalDomain("  KINETIC ")).toBe("Photonic");
  });

  it("leaves a current name alone", () => {
    for (const d of GENUS_DOMAIN_NAMES) expect(canonicalDomain(d)).toBe(d);
  });

  it("returns nothing for a domain that never existed", () => {
    expect(canonicalDomain("Fictional")).toBeUndefined();
  });

  it("looks the domain up by its former name", () => {
    expect(getGenusDomain("Kinetic")).toBe(getGenusDomain("Photonic"));
    expect(getGenusDomain("Kinetic")?.abilities.length).toBeGreaterThan(0);
  });

  it("did not resurrect Kinetic as a domain of its own", () => {
    expect(GENUS_DOMAIN_NAMES).not.toContain("Kinetic");
    expect(GENUS_DOMAIN_NAMES).toContain("Photonic");
  });
});

describe("Kinetic-gated content is reachable again", () => {
  // Whoever has Photonic access is who the old Kinetic requirement meant.
  const photonicParadigm = getGenusDomain("Photonic")!.paradigmAccess[0];

  it("lets a Photonic paradigm meet a Kinetic requirement", () => {
    expect(weaponDomainsMet("Kinetic", photonicParadigm), "Kinetic-gated content is locked for everyone").toBe(
      true
    );
  });

  it("still refuses a paradigm without that domain", () => {
    const without = GENUS_DOMAIN_NAMES.map((d) => getGenusDomain(d)!)
      .flatMap((d) => d.paradigmAccess)
      .find((p) => !(getParadigm(p)?.domains ?? []).some((x) => canonicalDomain(x) === "Photonic"));
    if (!without) return; // every paradigm has it; nothing to prove
    expect(weaponDomainsMet("Kinetic", without)).toBe(false);
  });

  it("unlocks every Kinetic-gated weapon and gear item in the data", () => {
    const items = [
      ...(weaponsData as { name?: string; domain?: string }[]),
      ...(gearData as { name?: string; domain?: string }[]),
    ].filter((w) => /kinetic/i.test(w.domain ?? ""));
    // If the data ever stops mentioning Kinetic this is vacuous rather than wrong.
    for (const w of items) {
      expect(weaponDomainsMet(w.domain, photonicParadigm), `${w.name} is still locked`).toBe(true);
    }
  });

  it("treats a compound requirement one part at a time", () => {
    expect(weaponDomainsMet("Kinetic + Kinetic", photonicParadigm)).toBe(true);
    expect(weaponDomainsMet("Kinetic + Fictional", photonicParadigm)).toBe(false);
  });
});
