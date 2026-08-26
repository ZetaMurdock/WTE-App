import { describe, expect, it } from "vitest";
import {
  GENUS_DOMAIN_NAMES,
  PARADIGMS,
  domainOfGenus,
  genusForParadigm,
  getGenusDomain,
  usableGenus,
} from "./wte";
import { snrReading } from "./snr";

describe("the rebuilt Genus domains", () => {
  it("holds the five domains — Kinetic reworked into Photonic", () => {
    expect(GENUS_DOMAIN_NAMES).toEqual(["Eldritch", "Elemental", "Neutral", "Null", "Photonic"]);
    expect(GENUS_DOMAIN_NAMES).not.toContain("Kinetic");
  });

  it("carries 98 abilities with the published per-domain counts", () => {
    const counts = Object.fromEntries(GENUS_DOMAIN_NAMES.map((d) => [d, getGenusDomain(d)!.abilities.length]));
    expect(counts).toEqual({ Eldritch: 18, Elemental: 19, Neutral: 20, Null: 21, Photonic: 20 });
    expect(Object.values(counts).reduce((a, b) => a + b, 0)).toBe(98);
  });

  it("gives every domain its identity, blurb and SNR posture", () => {
    for (const d of GENUS_DOMAIN_NAMES) {
      const dom = getGenusDomain(d)!;
      expect(dom.identity.length, `${d} identity`).toBeGreaterThan(20);
      expect(dom.blurb.length, `${d} blurb`).toBeGreaterThan(40);
      expect(["none", "applies", "anti"], `${d} snr`).toContain(dom.snr);
      expect(dom.paradigmAccess.length, `${d} access`).toBeGreaterThan(0);
    }
  });

  it("puts SNR only on Null, and anti-SNR only on Photonic", () => {
    expect(getGenusDomain("Null")!.snr).toBe("applies");
    expect(getGenusDomain("Photonic")!.snr).toBe("anti");
    for (const d of ["Eldritch", "Elemental", "Neutral"]) expect(getGenusDomain(d)!.snr).toBe("none");
    // Resolved per ability, which is how a contest reads it.
    expect(snrReading("Reflect")?.posture).toBe("applies");
    expect(snrReading("Lock Move")?.posture).toBe("anti");
    expect(snrReading("Lark")?.posture).toBe("none");
  });

  it("every ability is well-formed and carries its LIMIT", () => {
    for (const d of GENUS_DOMAIN_NAMES) {
      for (const a of getGenusDomain(d)!.abilities) {
        expect(a.name.trim(), `${d} name`).not.toBe("");
        expect(typeof a.ss, `${a.name} ss`).toBe("number");
        expect(a.effect!.length, `${a.name} effect`).toBeGreaterThan(20);
        expect(a.limit!.length, `${a.name} limit`).toBeGreaterThan(3);
        expect(a.classification!.length, `${a.name} classification`).toBeGreaterThan(3);
      }
    }
  });

  it("ability names are unique across ALL domains, so domainOfGenus is unambiguous", () => {
    const all = GENUS_DOMAIN_NAMES.flatMap((d) => getGenusDomain(d)!.abilities.map((a) => a.name.toLowerCase()));
    expect(new Set(all).size).toBe(all.length);
    expect(domainOfGenus("Reflect")).toBe("Null");
    expect(domainOfGenus("Photonic Swing")).toBe("Photonic");
    expect(domainOfGenus("Not A Genus")).toBeUndefined();
  });

  it("preserves the compound SS costs rather than flattening them", () => {
    const find = (d: string, n: string) => getGenusDomain(d)!.abilities.find((a) => a.name === n)!;
    expect(find("Eldritch", "Passive Death").ssNote).toBe("8 SS (+2/round)");
    expect(find("Null", "Reconstruct").ssNote).toContain("10–30 SS");
    expect(find("Photonic", "Hover").ssNote).toBe("2 SS per minute");
    // The plain ones carry no note.
    expect(find("Eldritch", "Lark").ssNote).toBeUndefined();
  });

  it("keeps the three abilities limited Once per Synaptic Focus", () => {
    const oncePerSf = GENUS_DOMAIN_NAMES.flatMap((d) =>
      getGenusDomain(d)!.abilities.filter((a) => /once per synaptic focus/i.test(a.limit ?? "")).map((a) => a.name)
    );
    expect(oncePerSf.sort()).toEqual(["Harlingsine", "Lark", "Vorpal"]);
  });
});

describe("paradigm domain access", () => {
  it("matches each Genus page's Paradigm Access block exactly", () => {
    const byParadigm = Object.fromEntries(PARADIGMS.map((p) => [p.id, [...p.domains].sort()]));
    expect(byParadigm).toEqual({
      science: ["Elemental", "Neutral"],
      simulation: ["Null", "Photonic"],
      remnant: ["Neutral", "Photonic"],
      cognition: ["Eldritch", "Null"],
      evolution: ["Eldritch", "Elemental"],
      warfare: ["Neutral", "Photonic"],
    });
  });

  it("is symmetric — a domain lists a paradigm iff that paradigm lists the domain", () => {
    for (const d of GENUS_DOMAIN_NAMES) {
      for (const pid of getGenusDomain(d)!.paradigmAccess) {
        const p = PARADIGMS.find((x) => x.id === pid)!;
        expect(p.domains, `${d} <-> ${pid}`).toContain(d);
      }
    }
    for (const p of PARADIGMS) {
      for (const d of p.domains) {
        expect(getGenusDomain(d)!.paradigmAccess, `${p.id} <-> ${d}`).toContain(p.id);
      }
    }
  });

  it("no paradigm references a domain that no longer exists", () => {
    for (const p of PARADIGMS) {
      expect(genusForParadigm(p.id).length, `${p.id} resolves`).toBe(p.domains.length);
      for (const d of p.domains) expect(GENUS_DOMAIN_NAMES, `${p.id} -> ${d}`).toContain(d);
    }
  });
});

describe("usableGenus", () => {
  it("reports the Focus that settles a contest", () => {
    const rows = usableGenus("cognition", ["Reflect"], { Reflect: 3 });
    expect(rows[0].focus).toBe(3);
    expect(rows[0].domain).toBe("Null");
    expect(rows[0].ss).toBe(30);
  });

  it("still resolves a genus whose domain left the paradigm — nothing blanks", () => {
    // Kinetic became Photonic, so a Science sheet holding a Null genus (or any
    // out-of-paradigm one) must still show its real cost and effect, never an
    // empty row.
    const rows = usableGenus("science", ["Reflect"], { Reflect: 2 });
    expect(rows[0].ss).toBe(30);
    expect(rows[0].domain).toBe("Null");
    expect(rows[0].effect).toBeTruthy();
  });

  it("returns a safe row for a name that is not a genus at all", () => {
    const rows = usableGenus("cognition", ["Nonsense"]);
    expect(rows[0].ss).toBe(0);
    expect(rows[0].effect).toBeUndefined();
  });
});
