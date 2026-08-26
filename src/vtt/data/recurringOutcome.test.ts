import { describe, expect, it } from "vitest";
import { consequencesFromTicks, groupProposals, outcomeFromProposals, outcomesFromProposals } from "./recurringOutcome";
import { armedConsequences, autoApplicable, declareTargetVerdict, hpAfterConsequence } from "./outcomeLedger";
import type { RecurringProposal } from "../engine/systems/RecurringEffectSystem";
import type { VttEffectTick } from "../types/scene";

const TICKS: VttEffectTick[] = [
  { id: "tick-1", kind: "save", label: "Physical Save — Recovery · DV 18", on: "always", dv: 18, path: "recovery", direction: "save" },
  { id: "tick-2", kind: "damage", label: "3d10 Cold", on: "fail", expr: "3d10", damageType: "Cold" },
  { id: "tick-3", kind: "ruling", label: "the creature also loses 1 Action", on: "fail", prompt: "the creature also loses 1 Action" },
];

function proposal(tokenId: string, tokenName: string, round = 4, effectId = "freeze"): RecurringProposal {
  return {
    id: `rt-${effectId}-${tokenId}-${round}`,
    effectId,
    tokenId,
    tokenName,
    round,
    gate: TICKS[0],
    ticks: TICKS,
    sourceAbilityId: "wte.cipher.absolute-zero",
    sourceAbilityName: "Absolute Zero",
    casterCharacterId: "sci-1",
  };
}

const NOW = 1_700_000_000_000;

describe("consequencesFromTicks", () => {
  it("keeps what lands and drops the roll that decides it", () => {
    const consequences = consequencesFromTicks(TICKS);
    // The gate is the roll, not a thing that happens to anyone.
    expect(consequences.map((c) => c.kind)).toEqual(["damage", "ruling"]);
    expect(consequences[0]).toMatchObject({ kind: "damage", on: "fail", expr: "3d10", damageType: "Cold", declared: true });
  });
});

describe("outcomeFromProposals", () => {
  it("opens ONE card carrying every token standing in the field", () => {
    const card = outcomeFromProposals([proposal("kira", "Kira"), proposal("vaun", "Vaun")], NOW);
    expect(card).not.toBeNull();
    expect(card!.targets.map((t) => t.name)).toEqual(["Kira", "Vaun"]);
    // One field, one save, one DV — splitting it per token would make the
    // Curator confirm the same field once per body, every round.
    expect(card!.dc).toBe(18);
    expect(card!.sourceAbilityName).toBe("Absolute Zero");
    expect(card!.fromBlock).toBe(true);
  });

  it("names the round, so two open cards are tellable apart", () => {
    const four = outcomeFromProposals([proposal("kira", "Kira", 4)], NOW)!;
    const five = outcomeFromProposals([proposal("kira", "Kira", 5)], NOW)!;
    expect(four.id).not.toBe(five.id);
    expect(four.rollLabel).toContain("round 4");
    expect(five.rollLabel).toContain("round 5");
  });

  it("gives the same round the same card id, so a repeat cannot stack", () => {
    const a = outcomeFromProposals([proposal("kira", "Kira", 4)], NOW)!;
    const b = outcomeFromProposals([proposal("kira", "Kira", 4)], NOW + 900)!;
    expect(a.id).toBe(b.id);
  });

  it("leaves the verdict pending — a proposal is not a ruling", () => {
    const card = outcomeFromProposals([proposal("kira", "Kira")], NOW)!;
    expect(card.targets[0].verdict).toBe("pending");
    expect(card.targets[0].applied).toEqual([]);
    expect(armedConsequences(card, card.targets[0])).toEqual([]);
  });

  it("carries no DV when the page deferred one, leaving the call to the Curator", () => {
    const deferred = proposal("kira", "Kira");
    deferred.gate = { id: "tick-1", kind: "save", label: "Physical Save — Recovery", on: "always", path: "recovery", direction: "save" };
    const card = outcomeFromProposals([deferred], NOW)!;
    expect(card.dc).toBeUndefined();
  });

  it("returns null for an empty round rather than an empty card", () => {
    expect(outcomeFromProposals([], NOW)).toBeNull();
  });
});

describe("the Curator stays sovereign", () => {
  it("commits nothing while the table has not opted in", () => {
    const card = outcomeFromProposals([proposal("kira", "Kira")], NOW)!;
    const failed = declareTargetVerdict(card, card.targets[0].id, "fail");
    // Confirm-each is the published default, and a recurring save must not be
    // the thing that quietly changes it.
    expect(autoApplicable(failed, failed.targets[0], { autoApplyDeclared: false })).toEqual([]);
  });

  it("never auto-applies the ruling, even for a table that opted in", () => {
    const card = outcomeFromProposals([proposal("kira", "Kira")], NOW)!;
    const failed = declareTargetVerdict(card, card.targets[0].id, "fail");
    const auto = autoApplicable(failed, failed.targets[0], { autoApplyDeclared: true });
    // A ruling has no number by definition — it is the page asking a human a
    // question, and answering it automatically would be the engine ruling on
    // the Curator's behalf, once per round.
    expect(auto.map((c) => c.kind)).toEqual(["damage"]);
  });

  it("arms the fail branch only once a verdict exists", () => {
    const card = outcomeFromProposals([proposal("kira", "Kira")], NOW)!;
    const passed = declareTargetVerdict(card, card.targets[0].id, "pass");
    // No `half` rider on this page, so a made save costs nothing at all.
    expect(armedConsequences(passed, passed.targets[0])).toEqual([]);
  });
});

// ON-ZERO EDGES.
//
// Absolute Zero's DEEP FREEZE keyword overrides what reaching 0 HP means: "a
// creature dropped to 0 HP inside the field is frozen unconscious and stable
// until thawed." An override needs something to override, and there is nothing:
// no page in src/rules states what 0 HP normally DOES, and no module in this
// app reacts to a token reaching it. The corpus says "they fall normally"
// (Remnant_Ciphers) and "bypasses death-save protocols" (The_Polarized_Soul_
// System) while defining neither phrase anywhere.
//
// So no down-at-zero rule is implemented, and these tests exist to keep it that
// way. Writing one would be the app inventing a rule of the user's setting —
// the single thing it must never do. What the engine CAN do honestly, it
// already does: the page's own override reaches the table as a `Ruling`, and a
// ruling is a question put to a human. When the Curator writes the rule, it
// belongs on a Codex page a table can fork, and these tests should fail loudly
// so whoever adds it decides deliberately.
describe("reaching zero", () => {
  it("clamps at zero and does nothing else", () => {
    const card = outcomeFromProposals([proposal("kira", "Kira")], NOW)!;
    const failed = declareTargetVerdict(card, card.targets[0].id, "fail");
    // 30 damage onto 12 HP. Negative HP is a state nothing in the VTT has a
    // meaning for; zero is a number, not an event.
    expect(hpAfterConsequence(12, 40, 30)).toBe(0);
    // And no consequence appeared out of the drop — no Unconscious, no dying
    // clock, no status the engine decided on its own.
    expect(armedConsequences(failed, failed.targets[0]).map((c) => c.condition ?? c.kind)).toEqual([
      "damage",
      "ruling",
    ]);
  });

  it("hands the page's override to the Curator as a question", () => {
    const card = outcomeFromProposals([proposal("kira", "Kira")], NOW)!;
    const ruling = card.consequences.find((c) => c.kind === "ruling");
    // DEEP FREEZE is real, authored, and already on the card. What it is not is
    // a rule this engine may apply for the table.
    expect(ruling?.label).toContain("loses 1 Action");
    expect(autoApplicable(declareTargetVerdict(card, card.targets[0].id, "fail"), card.targets[0], {
      autoApplyDeclared: true,
    }).map((c) => c.kind)).not.toContain("ruling");
  });
});

describe("groupProposals", () => {
  it("splits a round by the field that caused it", () => {
    const groups = groupProposals([
      proposal("kira", "Kira", 4, "freeze"),
      proposal("vaun", "Vaun", 4, "fire"),
      proposal("mara", "Mara", 4, "freeze"),
    ]);
    expect(groups.map((g) => g.map((p) => p.tokenId))).toEqual([["kira", "mara"], ["vaun"]]);
    expect(outcomesFromProposals([], NOW)).toEqual([]);
  });
});
