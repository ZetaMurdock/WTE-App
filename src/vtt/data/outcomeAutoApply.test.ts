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
  markApplied,
  openOutcome,
  settleOutcome,
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

function failed(input: { steps?: EffectStep[]; effect?: string | null }): PendingOutcome {
  const opened = openOutcome({
    id: "oc-1",
    sourceAbilityId: "a1",
    sourceAbilityName: "Test",
    targetName: "Kira",
    dc: 15,
    rollLabel: "Physical Save — Evasion",
    now: 0,
    effect: input.effect,
    steps: input.steps,
  });
  return settleOutcome(opened, 9);
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
    expect(autoApplicable(outcome, OFF)).toEqual([]);
  });

  it("offers the declared damage and the declared condition once a table opts in", () => {
    const auto = autoApplicable(failed({ steps: stepsOf(HAIL_RAIN) }), ON);
    expect(auto.map((consequence) => consequence.label)).toEqual(["On fail · 2d6 Cold", "On fail · Slowed · 1 round"]);
  });

  // The refusal this whole rule is drawn around. Hail Rain's own page declares a
  // Ruling, and it stays a question for a human under every setting: answering it
  // automatically would be the engine ruling in the Curator's place.
  it("never offers a Ruling, even one the page declared", () => {
    const outcome = failed({ steps: stepsOf(DECISIVE_GRASP) });
    expect(outcome.consequences.map((consequence) => consequence.kind)).toContain("ruling");
    expect(autoApplicable(outcome, ON)).toEqual([]);
  });

  // The entire shipped corpus is prose. Auto-apply must not reach one card of it:
  // a sentence the scanner read is a reading, and a reading should not move a
  // token's HP with nobody watching.
  it("never offers a consequence the prose scanner guessed", () => {
    const outcome = failed({ effect: PSYCHIC_SCREAM.effect });
    expect(outcome.consequences.length).toBeGreaterThan(0);
    expect(autoApplicable(outcome, ON)).toEqual([]);
  });

  it("offers nothing while the roll has not arrived", () => {
    const pending = openOutcome({
      id: "oc-2",
      sourceAbilityId: "a1",
      sourceAbilityName: "Hail Rain",
      targetName: "Kira",
      dc: 15,
      rollLabel: "Physical Save — Evasion",
      now: 0,
      steps: stepsOf(HAIL_RAIN),
    });
    expect(pending.verdict).toBe("pending");
    expect(autoApplicable(pending, ON)).toEqual([]);
  });

  it("offers only what the verdict armed — a held save keeps the failure branch off", () => {
    const held = settleOutcome(failed({ steps: stepsOf(HAIL_RAIN) }), 20);
    expect(held.verdict).toBe("pass");
    expect(autoApplicable(held, ON)).toEqual([]);
  });

  // A declared "half on success" rider is still the page's own word about what a
  // successful save costs, so it is as applicable as the failure branch was.
  it("offers a declared half-on-success rider to a target that passed", () => {
    const held = settleOutcome(failed({ steps: stepsOf(PSYCHIC_SCREAM) }), 20);
    const auto = autoApplicable(held, ON);
    expect(auto.map((consequence) => consequence.expr)).toEqual(["2d8"]);
    expect(auto[0].half).toBe(true);
  });

  // The guard against a caller that re-runs. Whatever drives this may be asked
  // the same question many times over one card's life, and the answer has to
  // stop being yes the moment the hit lands.
  it("stops offering a consequence the moment it has been committed", () => {
    const outcome = failed({ steps: stepsOf(HAIL_RAIN) });
    const first = autoApplicable(outcome, ON);
    expect(first.length).toBe(2);
    const after = markApplied(outcome, first[0].id);
    expect(autoApplicable(after, ON).map((consequence) => consequence.id)).toEqual([first[1].id]);
    const both = markApplied(after, first[1].id);
    expect(autoApplicable(both, ON)).toEqual([]);
  });
});

// P2's standing promise: an ability with no block behaves exactly as it did
// before any of this existed. Auto-apply is the sharpest way to state it —
// switching the rule on must not change one thing about an undeclared card.
describe("an undeclared ability is untouched by any of this", () => {
  it("opens the same card and offers the same nothing under either setting", () => {
    const prose = failed({ effect: PSYCHIC_SCREAM.effect });
    expect(prose.consequences).toEqual(consequencesFor(PSYCHIC_SCREAM.effect));
    expect(autoApplicable(prose, OFF)).toEqual(autoApplicable(prose, ON));
  });

  it("treats an empty block as no block, not as a page that declared silence", () => {
    const none = failed({ effect: PSYCHIC_SCREAM.effect, steps: [] });
    expect(none.consequences).toEqual(consequencesFor(PSYCHIC_SCREAM.effect));
    // Whole-card equality, not just the consequences: an empty block that left
    // `fromBlock` set would still change what the card says it was reading.
    expect(none).toEqual(failed({ effect: PSYCHIC_SCREAM.effect }));
    expect(none.fromBlock).toBe(false);
    expect(autoApplicable(none, ON)).toEqual([]);
  });
});
