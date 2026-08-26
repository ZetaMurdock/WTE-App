import { describe, expect, it } from "vitest";
import { CIPHER_DATA_BY_ID, GENUS_DATA_BY_ID } from "./wte";
import { hasLintWarnings, lintDeclaredAgainstProse, type LintFinding } from "./abilityLint";

// Real shipped prose, not fixtures: the oracle's whole job is to be quiet about
// the corpus as it actually reads, and a hand-written sentence would prove
// nothing about the 414 pages a Curator will open.
const prose = (id: string): string => {
  const ability = CIPHER_DATA_BY_ID.get(id) ?? GENUS_DATA_BY_ID.get(id);
  if (!ability?.effect) throw new Error(`corpus ability ${id} is gone — repoint this test at its replacement`);
  return ability.effect;
};

const warnings = (findings: readonly LintFinding[]): LintFinding[] => findings.filter((f) => f.severity === "warning");

// S1 — ABSOLUTE ZERO, declared exactly as its prose reads: a keyed-DV save, the
// cold that follows a failure, the detonation and its own save.
const ABSOLUTE_ZERO = [
  "- Cost: 80 SS",
  "- Save (target): Physical Save — Recovery, DV 18",
  "- Fail: Damage: 3d10 Cold, half on success",
  "- Save (target): Physical Save — Evasion",
  "- Fail: Damage: 5d10 Fire, half on success",
  "- Ruling: brittle objects shatter — Curator adjudicates",
].join("\n");

describe("the block and the prose are checked against each other", () => {
  it("says nothing when a block declares a shipped ability exactly as written", () => {
    expect(lintDeclaredAgainstProse(prose("wte.cipher.s1-absolute-zero"), ABSOLUTE_ZERO)).toEqual([]);
  });

  it("warns when the dice were edited on one half of the page only", () => {
    const drifted = ABSOLUTE_ZERO.replace("3d10 Cold", "3d8 Cold");
    const findings = lintDeclaredAgainstProse(prose("wte.cipher.s1-absolute-zero"), drifted);
    expect(hasLintWarnings(findings)).toBe(true);
    const dice = warnings(findings).filter((f) => f.category === "dice");
    expect(dice).toHaveLength(1);
    expect(dice[0].message).toContain("3d8");
    expect(dice[0].message).toContain("3d10");
  });

  it("warns when the DV was edited on one half of the page only, naming both numbers", () => {
    const drifted = ABSOLUTE_ZERO.replace("DV 18", "DV 16");
    const dv = warnings(lintDeclaredAgainstProse(prose("wte.cipher.s1-absolute-zero"), drifted))
      .filter((f) => f.category === "dv");
    expect(dv).toHaveLength(1);
    expect(dv[0].message).toContain("DV 16");
    expect(dv[0].message).toContain("DV 18");
    expect(dv[0].message).toContain("Physical Save — Recovery");
  });

  it("warns about a step the block itself could not read", () => {
    const findings = lintDeclaredAgainstProse(prose("wte.cipher.s1-absolute-zero"), "- Damage: a great deal of cold");
    expect(warnings(findings).some((f) => f.category === "unreadable")).toBe(true);
  });
});

// A partly declared ability is the normal state, not a half-finished one: the
// prose parser recovers less than a block declares by design. Anything it
// reports about that must be information a Curator can glance past.
describe("a partial block is informed about, never warned about", () => {
  const LARK_PARTIAL = ["- Cost: 5 SS", "- Save (target): Physical Save — Recovery"].join("\n");

  it("reports the undeclared prose without raising a warning", () => {
    const findings = lintDeclaredAgainstProse(prose("wte.genus.lark"), LARK_PARTIAL);
    expect(warnings(findings)).toEqual([]);
    expect(findings.some((f) => f.category === "dice" && f.message.includes("1d40"))).toBe(true);
    // Lark's own Mental Check — Capacity is prose the block leaves alone.
    expect(findings.some((f) => f.category === "route" && f.message.includes("Mental Check — Capacity"))).toBe(true);
  });

  it("is silent for an ability with no block at all, in either empty form", () => {
    expect(lintDeclaredAgainstProse(prose("wte.genus.lark"), "")).toEqual([]);
    expect(lintDeclaredAgainstProse(prose("wte.genus.lark"), null)).toEqual([]);
    expect(lintDeclaredAgainstProse(prose("wte.genus.lark"), "Steps are still to be written.")).toEqual([]);
  });

  it("does not report a declared step the prose parser cannot see at all", () => {
    // Cost, Condition and Ruling have no prose counterpart by design — a block
    // full of them must not read as disagreement with a silent sentence.
    const findings = lintDeclaredAgainstProse(
      "The user shrugs off the next blow.",
      ["- Cost: 6 SS", "- Condition: Slowed, 2 rounds", "- Ruling: Curator decides what shatters"].join("\n")
    );
    expect(findings).toEqual([]);
  });
});

describe("only real disagreements count", () => {
  it("reads d8 and 1d8 as the same dice", () => {
    expect(lintDeclaredAgainstProse("Deals d8 Fire damage.", "- Damage: 1d8 Fire")).toEqual([]);
  });

  it("keeps a block that heals apart from one that harms", () => {
    // PSYCHIC SCREAM deals 2d8 and costs its own caster 1d4; declaring the same
    // two figures as damage must stay silent even though one is self-inflicted.
    const findings = lintDeclaredAgainstProse(
      prose("wte.cipher.psychic-scream"),
      ["- Save (target): Mental Save — Influence, DV 14 + Neuronal Capacity Modifier",
        "- Fail: Damage: 2d8 Psychic, half on success",
        "- Fail: Condition: Stunned, 1 rounds",
        "- Damage (self): 1d4 Psychic"].join("\n")
    );
    expect(warnings(findings)).toEqual([]);
  });

  it("warns when a block fixes a DV the prose rolls", () => {
    const findings = lintDeclaredAgainstProse(
      "Each creature makes a Physical Save — Evasion, each against a d40 Dice Value.",
      "- Save (target): Physical Save — Evasion, DV 20"
    );
    expect(warnings(findings).map((f) => f.category)).toEqual(["dv"]);
  });
});

describe("a custom currency", () => {
  it("says which part of a track the engine will NOT enforce", () => {
    // Not a disagreement with the page — the block is perfectly readable. It is
    // the engine naming the rules it is declining to invent, so the Curator
    // rules on them at the table instead of mid-fight.
    const findings = lintDeclaredAgainstProse(
      null,
      ["- Counter: Blight +1, cap 8", "- At 8: Damage: 1d100"].join("\n")
    );
    const track = findings.filter((finding) => finding.category === "track");
    expect(track).toHaveLength(1);
    expect(track[0].severity).toBe("info");
    expect(track[0].message).toContain("once per crossing");
    expect(hasLintWarnings(findings)).toBe(false);
  });

  it("says nothing about a track that watches no mark", () => {
    expect(lintDeclaredAgainstProse(null, "- Counter: Wryde charges +1")).toEqual([]);
  });
});
