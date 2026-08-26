// Which consequences a table may let the app commit on its own — and, far more
// importantly, which ones it may never let it commit.
//
// Kept beside outcomeLedger.test.ts rather than inside it because the question
// is a different one. That suite proves the ledger derives the right cards; this
// one proves the line auto-apply is drawn along, and that line is a safety
// property: a write that lands on a token unattended is one nobody watched
// happen. Everything below therefore tests the REFUSALS as hard as the passes.
import { describe, expect, it } from "vitest";
import cipherData from "../../game/data/ciphers.json";
import genusData from "../../game/data/genus.json";
import { parseAbilityEffects, type EffectStep } from "../../game/abilityEffects";
import {
  autoApplicable,
  consequencesFor,
  consequencesFromSteps,
  lapsePendingTargets,
  markTargetApplied,
  markTargetRemoved,
  unmarkTargetApplied,
  openOutcome,
  settleTarget,
  type OutcomeTarget,
  type PendingOutcome,
} from "./outcomeLedger";

interface CorpusAbility {
  name: string;
  effect?: string | null;
  actions?: string | null;
}

// Pages the app actually ships, exactly as outcomeLedger.test.ts reads them. A
// gate proven against a block invented in this file would prove the gate and
// nothing about the corpus it has to hold for.
function genusPage(domain: string, name: string): CorpusAbility {
  const domains = genusData as unknown as Record<string, { abilities: CorpusAbility[] } | undefined>;
  const hit = domains[domain]?.abilities.find((ability) => ability.name === name);
  if (!hit) throw new Error(`genus.json no longer ships ${domain} / ${name}`);
  return hit;
}

function cipherPage(paradigm: string, name: string): CorpusAbility {
  const paradigms = cipherData as unknown as Record<string, CorpusAbility[] | undefined>;
  const hit = paradigms[paradigm]?.find((ability) => ability.name === name);
  if (!hit) throw new Error(`ciphers.json no longer ships ${paradigm} / ${name}`);
  return hit;
}

function stepsOf(page: CorpusAbility): EffectStep[] {
  if (!page.actions) throw new Error(`${page.name} no longer declares an ## Actions block`);
  const read = parseAbilityEffects(page.actions);
  expect(read.errors).toEqual([]);
  return read.steps;
}

// "- Fail: Damage: 2d6 Cold / - Fail: Condition: Slowed, 1 round / - Ruling: …"
// One page carrying all three shapes the gate has to tell apart.
const HAIL_RAIN = genusPage("Elemental", "Hail Rain");
// "- Damage: 2d8 Psychic, half on success" — the rider that survives a pass.
const PSYCHIC_SCREAM = cipherPage("cognition", "PSYCHIC SCREAM");
// "- Fail: Ruling: the target is completely immobilized …" — a page whose whole
// failure branch is a question for a human.
const DECISIVE_GRASP = genusPage("Null", "Decisive Grasp");

const ON = { autoApplyDeclared: true };
const OFF = { autoApplyDeclared: false };

function opened(input: { steps?: EffectStep[]; effect?: string | null }): PendingOutcome {
  return openOutcome({
    id: "oc-1",
    sourceAbilityId: "a1",
    sourceAbilityName: "Test",
    targets: [{ id: "kira", name: "Kira" }],
    dc: 15,
    rollLabel: "Physical Save — Evasion",
    now: 0,
    effect: input.effect,
    steps: input.steps,
  });
}

function failed(input: { steps?: EffectStep[]; effect?: string | null }): PendingOutcome {
  return settle(opened(input), 9);
}

/** The one target of a degenerate card. The gate is asked PER TARGET, because a
 *  batch's targets sit in different states and only some of them qualify. */
function only(outcome: PendingOutcome): OutcomeTarget {
  return outcome.targets[0];
}

function settle(outcome: PendingOutcome, total: number): PendingOutcome {
  return settleTarget(outcome, outcome.targets[0].id, total);
}

function mark(outcome: PendingOutcome, consequenceId: string): PendingOutcome {
  return markTargetApplied(outcome, outcome.targets[0].id, consequenceId);
}

/** The gate, asked about the sole target of a single-target card. */
function auto(outcome: PendingOutcome, rules: { autoApplyDeclared: boolean }) {
  return autoApplicable(outcome, only(outcome), rules);
}

describe("where a declared consequence came from", () => {
  it("marks every consequence a page declared", () => {
    const derived = consequencesFromSteps(stepsOf(HAIL_RAIN));
    expect(derived.length).toBeGreaterThan(0);
    expect(derived.every((consequence) => consequence.declared === true)).toBe(true);
  });

  // The reader-facing half of the same fact: a prose card must not be able to
  // wear the chip that says an author wrote it.
  it("marks nothing the prose deriver recovered", () => {
    const derived = consequencesFor(PSYCHIC_SCREAM.effect);
    expect(derived.length).toBeGreaterThan(0);
    expect(derived.some((consequence) => consequence.declared)).toBe(false);
  });

  it("carries the mark onto the card the ledger opens", () => {
    expect(failed({ steps: stepsOf(HAIL_RAIN) }).consequences.every((c) => c.declared === true)).toBe(true);
    expect(failed({ effect: HAIL_RAIN.effect }).consequences.some((c) => c.declared)).toBe(false);
  });
});

describe("what a table may let the app apply on its own", () => {
  it("offers nothing at all under the published default", () => {
    const outcome = failed({ steps: stepsOf(HAIL_RAIN) });
    // The same card has plenty armed — the rule, not the card, is what is empty.
    expect(outcome.consequences.length).toBeGreaterThan(1);
    expect(auto(outcome, OFF)).toEqual([]);
  });

  it("offers the declared damage and the declared condition once a table opts in", () => {
    const offered = auto(failed({ steps: stepsOf(HAIL_RAIN) }), ON);
    expect(offered.map((consequence) => consequence.label)).toEqual([
      "On fail · 2d6 Cold",
      "On fail · Slowed · 1 round",
    ]);
  });

  // The refusal this whole rule is drawn around. Hail Rain's own page declares a
  // Ruling, and it stays a question for a human under every setting: answering it
  // automatically would be the engine ruling in the Curator's place.
  it("never offers a Ruling, even one the page declared", () => {
    const outcome = failed({ steps: stepsOf(DECISIVE_GRASP) });
    expect(outcome.consequences.map((consequence) => consequence.kind)).toContain("ruling");
    expect(auto(outcome, ON)).toEqual([]);
  });

  // The entire shipped corpus is prose. Auto-apply must not reach one card of it:
  // a sentence the scanner read is a reading, and a reading should not move a
  // token's HP with nobody watching.
  it("never offers a consequence the prose scanner guessed", () => {
    const outcome = failed({ effect: PSYCHIC_SCREAM.effect });
    expect(outcome.consequences.length).toBeGreaterThan(0);
    expect(auto(outcome, ON)).toEqual([]);
  });

  it("offers nothing while the roll has not arrived", () => {
    const pending = openOutcome({
      id: "oc-2",
      sourceAbilityId: "a1",
      sourceAbilityName: "Hail Rain",
      targets: [{ id: "kira", name: "Kira" }],
      dc: 15,
      rollLabel: "Physical Save — Evasion",
      now: 0,
      steps: stepsOf(HAIL_RAIN),
    });
    expect(only(pending).verdict).toBe("pending");
    expect(auto(pending, ON)).toEqual([]);
  });

  it("offers only what the verdict armed — a held save keeps the failure branch off", () => {
    const held = settle(opened({ steps: stepsOf(HAIL_RAIN) }), 20);
    expect(only(held).verdict).toBe("pass");
    expect(auto(held, ON)).toEqual([]);
  });

  // A declared "half on success" rider is still the page's own word about what a
  // successful save costs, so it is as applicable as the failure branch was.
  it("offers a declared half-on-success rider to a target that passed", () => {
    const held = settle(opened({ steps: stepsOf(PSYCHIC_SCREAM) }), 20);
    const offered = auto(held, ON);
    expect(offered.map((consequence) => consequence.expr)).toEqual(["2d8"]);
    expect(offered[0].half).toBe(true);
  });

  // The guard against a caller that re-runs. Whatever drives this may be asked
  // the same question many times over one card's life, and the answer has to
  // stop being yes the moment the hit lands.
  it("stops offering a consequence the moment it has been committed", () => {
    const outcome = failed({ steps: stepsOf(HAIL_RAIN) });
    const first = auto(outcome, ON);
    expect(first.length).toBe(2);
    const after = mark(outcome, first[0].id);
    expect(auto(after, ON).map((consequence) => consequence.id)).toEqual([first[1].id]);
    const both = mark(after, first[1].id);
    expect(auto(both, ON)).toEqual([]);
  });

  // Undo has to outlive a remount. The card's fire-once ref dies with the panel,
  // so without a record on the target itself, re-opening the panel would commit
  // the very hit the Curator had just taken off the token.
  it("never re-offers a consequence an undo took back", () => {
    const outcome = failed({ steps: stepsOf(HAIL_RAIN) });
    const armed = auto(outcome, ON);
    const applied = mark(outcome, armed[0].id);
    const undone = unmarkTargetApplied(applied, applied.targets[0].id, armed[0].id);
    expect(only(undone).applied).toEqual([]);
    expect(auto(undone, ON).map((consequence) => consequence.id)).toEqual([armed[1].id]);
    // Re-applying by hand is still the Curator's to make, and it lifts the veto.
    const again = mark(undone, armed[0].id);
    expect(only(again).reversed ?? []).toEqual([]);
    expect(auto(again, ON).map((consequence) => consequence.id)).toEqual([armed[1].id]);
  });
});

describe("the two states a batch adds, and the gate's answer to both", () => {
  // The partial resolution policy, stated where auto-apply can be held to it: a
  // target the round walked past has no verdict the dice produced, so there is
  // nothing for auto-apply to commit on its behalf. This is the whole difference
  // between marking an unanswered save and deciding it.
  it("never offers anything for a target the round left behind", () => {
    const lapsed = lapsePendingTargets(opened({ steps: stepsOf(HAIL_RAIN) }), 4);
    expect(only(lapsed).lapsedRound).toBe(4);
    expect(auto(lapsed, ON)).toEqual([]);
  });

  // Even with a verdict on it. A target can fail its save and THEN be lapsed by
  // a later card's tick, or be declared by hand after the round moved; the write
  // still must not land unattended on a row the card is flagging as unresolved.
  it("never offers anything for a target whose token left the scene", () => {
    const gone = markTargetRemoved(failed({ steps: stepsOf(HAIL_RAIN) }), "kira");
    expect(only(gone).verdict).toBe("fail");
    expect(auto(gone, ON)).toEqual([]);
  });
});

// P2's standing promise: an ability with no block behaves exactly as it did
// before any of this existed. Auto-apply is the sharpest way to state it —
// switching the rule on must not change one thing about an undeclared card.
describe("an undeclared ability is untouched by any of this", () => {
  it("opens the same card and offers the same nothing under either setting", () => {
    const prose = failed({ effect: PSYCHIC_SCREAM.effect });
    expect(prose.consequences).toEqual(consequencesFor(PSYCHIC_SCREAM.effect));
    expect(auto(prose, OFF)).toEqual(auto(prose, ON));
  });

  it("treats an empty block as no block, not as a page that declared silence", () => {
    const none = failed({ effect: PSYCHIC_SCREAM.effect, steps: [] });
    expect(none.consequences).toEqual(consequencesFor(PSYCHIC_SCREAM.effect));
    // Whole-card equality, not just the consequences: an empty block that left
    // `fromBlock` set would still change what the card says it was reading.
    expect(none).toEqual(failed({ effect: PSYCHIC_SCREAM.effect }));
    expect(none.fromBlock).toBe(false);
    expect(auto(none, ON)).toEqual([]);
  });
});
