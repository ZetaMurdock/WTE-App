import { describe, expect, it } from "vitest";
import { snrChip, snrReading } from "./snr";
import { GENUS_DOMAIN_NAMES, getGenusDomain } from "./wte";

describe("what the corpus says about resolution order", () => {
  it("reads Null's posture and its own words off the domain page", () => {
    const read = snrReading("Negate");
    expect(read).toMatchObject({ domain: "Null", posture: "applies", label: "SNR" });
    // The sentence is the page's, not this module's: a table forking the domain
    // page must get its own words at the table.
    expect(read!.note).toBe(getGenusDomain("Null")!.snrNote);
    expect(read!.note).toContain("resolve before Reactions can be declared");
  });

  it("reads Photonic as anti-SNR", () => {
    const read = snrReading("Lock Move");
    expect(read).toMatchObject({ domain: "Photonic", posture: "anti", label: "anti-SNR" });
    expect(read!.note).toContain("Anti-Standard Null Ruling");
  });

  it("resolves a permanent id as well as a name", () => {
    // A migrated sheet stores `wte.genus.…`; a name-only lookup would quietly
    // lose the ability's posture and show nothing where SNR applies.
    const byId = getGenusDomain("Null")!.abilities.find((a) => a.id)!;
    expect(snrReading(byId.id!)?.posture).toBe("applies");
  });

  it("says nothing for a domain the corpus gives no ruling", () => {
    // Elemental's page: "No Standard Null Ruling … resolve in normal initiative
    // order." That is the default, and a chip on 57 abilities meaning "normal"
    // is how a surface teaches a table to stop reading its chips.
    expect(snrReading("Ignite")?.posture ?? "none").toBe("none");
    expect(snrChip("Ignite")).toBeNull();
    expect(snrChip("Negate")).not.toBeNull();
  });

  it("has no posture for something that belongs to no energy domain", () => {
    expect(snrReading("Longsword")).toBeNull();
    expect(snrReading("")).toBeNull();
    expect(snrReading(null)).toBeNull();
  });
});

describe("the domain enum is the only source", () => {
  it("never lets an activation string decide a posture", () => {
    // SNR is double-encoded in the shipped corpus: 17 Null abilities also say it
    // in free text. The architecture review ruled the enum authoritative, and
    // this is what that ruling means in code — a Null ability whose activation
    // is silent still carries the domain's posture, and a domain with no ruling
    // stays silent no matter what an activation says.
    const nullSilent = getGenusDomain("Null")!.abilities.filter((a) => !/\bsnr\b/i.test(a.activation ?? ""));
    expect(nullSilent.length).toBeGreaterThan(0);
    for (const ability of nullSilent) expect(snrReading(ability.name)?.posture).toBe("applies");
  });

  it("catches a domain with no ruling acquiring SNR prose", () => {
    // Authoring drift the enum would swallow in silence: "Active (SNR)" written
    // onto an Elemental ability ships a page whose own sentence claims a
    // scheduling posture nothing in the app will ever report. The enum still
    // decides; this makes the contradiction fail loudly instead of quietly.
    const offenders: string[] = [];
    for (const domain of GENUS_DOMAIN_NAMES) {
      const record = getGenusDomain(domain)!;
      if (record.snr !== "none") continue;
      for (const ability of record.abilities) {
        if (/\bsnr\b/i.test(ability.activation ?? "")) offenders.push(`${domain} · ${ability.name}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
