import { describe, expect, it } from "vitest";
import { GENUS_DOMAIN_NAMES, getGenusDomain } from "./wte";
import { averageDamage, summarizeDamage } from "./abilityDamage";

const dmg = (effect: string, cls?: string) => summarizeDamage(effect, cls);

describe("damage extraction", () => {
  it("reads a typed damage expression", () => {
    const s = dmg("Each creature makes an Endurance Save or takes 1d40 Spirit Damage.");
    expect(s.none).toBe(false);
    expect(s.label).toBe("1d40 Spirit");
    expect(s.parts).toEqual([{ expr: "1d40", type: "Spirit" }]);
  });

  it("reads several instances in text order", () => {
    const s = dmg("The attack deals: 2d12 True Damage + 1d10 Necrotic Damage.");
    expect(s.label).toBe("2d12 True + 1d10 Necrotic");
  });

  it("reads untyped damage", () => {
    expect(dmg("deals 2d6 damage ignoring DHP entirely").label).toBe("2d6");
  });

  it("averages the dice", () => {
    expect(averageDamage(dmg("takes 2d6 damage"))).toBe(7);
    expect(averageDamage(dmg("takes 1d40 Spirit Damage"))).toBe(20.5);
    expect(averageDamage(dmg("no dice here", "Enhancement"))).toBe(0);
  });
});

describe("what is NOT damage", () => {
  it("ignores a DC", () => {
    const s = dmg("must succeed a DC 12 Control check", "Enhancement");
    expect(s.none).toBe(true);
  });

  it("ignores a die used as a check target", () => {
    // Photonic writes contested checks as "a dc of d40 perception and d40 control".
    expect(dmg("have a dc of d40 perception and d40 control", "Emission").none).toBe(true);
  });

  it("ignores healing", () => {
    expect(dmg("heals HP — 2d8 at SS 5; 4d8 at SS 10", "Trans-modification").none).toBe(true);
    expect(dmg("regenerate 1d20 HP per turn", "Enhancement").none).toBe(true);
  });

  it("ignores a construct's own hit points", () => {
    expect(dmg("The being has HP equal to 10 + (3 × Neuronal Capacity Level)", "Materialization").none).toBe(true);
  });

  it("ignores a table roll", () => {
    expect(dmg("Each use: roll d6 — on a 1, the mutation becomes permanent", "Trans-modification").none).toBe(true);
  });

  it("ignores a bare die with no damage word near it", () => {
    expect(dmg("gain +1 die on all ADA rolls", "Enhancement").none).toBe(true);
  });
});

describe("non-damage labels come from the authored Classification", () => {
  it("uses the leading classification word, shortening Trans-modification", () => {
    expect(dmg("does something", "Trans-modification").label).toBe("Transmod");
    expect(dmg("does something", "Enhancement / Divination").label).toBe("Enhancement");
    expect(dmg("does something", "Divination").label).toBe("Divination");
    expect(dmg("does something", "Materialization / Enhancement").label).toBe("Materialization");
  });

  it("falls back to Effect when nothing is classified — ciphers have no Classification", () => {
    expect(dmg("does something").label).toBe("Effect");
    expect(dmg("does something", "").label).toBe("Effect");
    expect(dmg("").label).toBe("Effect");
  });

  it("never guesses intent from prose — a mention of healing is not healing", () => {
    // Inverse Reverse: "A heal becomes harm; a buff becomes a debuff". An earlier
    // prose-sniffing draft called this ability healing. It is Trans-modification.
    const s = dmg("A heal becomes harm; a buff becomes a debuff.", "Trans-modification");
    expect(s.label).toBe("Transmod");
    // Armor Increase grants +3 DHP but also mentions a −1; it is Enhancement.
    expect(dmg("Grants +3 DHP. Creatures suffer −1 to their next attack roll.", "Enhancement").label).toBe("Enhancement");
  });
});

describe("across the whole Genus catalog", () => {
  it("finds damage on exactly the abilities that deal it, and labels the rest", () => {
    let withDamage = 0;
    for (const d of GENUS_DOMAIN_NAMES) {
      for (const a of getGenusDomain(d)!.abilities) {
        const s = summarizeDamage(a.effect, a.classification);
        if (!s.none) withDamage++;
        // Every ability gets a non-empty label, and no label is ever an SS cost.
        expect(s.label.trim(), `${d}/${a.name}`).not.toBe("");
        expect(s.label, `${d}/${a.name}`).not.toMatch(/\bSS\b/);
      }
    }
    // 23 as of the 2026-08 Genus update: the Photonic rework turned two
    // movement utilities into radiance dealers (Remembrance, Dazzling Jump).
    expect(withDamage).toBe(23);
  });

  it("spot-checks real abilities", () => {
    const find = (d: string, n: string) => getGenusDomain(d)!.abilities.find((a) => a.name === n)!;
    const vorpal = find("Elemental", "Vorpal");
    expect(summarizeDamage(vorpal.effect, vorpal.classification).label).toBe("3d8 Elemental");
    // Reflect costs 30 SS and deals no damage — the exact bug this replaced.
    const reflect = find("Null", "Reflect");
    const r = summarizeDamage(reflect.effect, reflect.classification);
    expect(r.none).toBe(true);
    expect(r.label).not.toContain("30");
  });
});
