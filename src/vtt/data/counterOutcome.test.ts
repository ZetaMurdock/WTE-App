import { describe, it, expect } from "vitest";
import { parseAbilityEffects } from "../../game/abilityEffects";
import { consequencesFromCrossing, crossingLine, outcomeFromCrossing } from "./counterOutcome";
import {
  __resetOutcomeLedger,
  armedConsequences,
  autoApplicable,
  batchPlan,
  consequencesFromSteps,
  lapsePendingTargets,
  listOutcomes,
  openOutcome,
  outcomeTally,
  pushOutcome,
  type OutcomeConsequence,
  type PendingOutcome,
} from "./outcomeLedger";

const BLIGHT = [
  "- Save: Physical Save — Recovery, DV 18",
  "- Fail: Counter: Blight +1, cap 8",
  "- At 8: Damage: 1d100",
  "- At 8: Condition: Incapacitated",
].join("\n");

function steps(block: string) {
  const parsed = parseAbilityEffects(block);
  expect(parsed.errors).toEqual([]);
  return parsed.steps;
}

function card(block: string): PendingOutcome {
  return openOutcome({
    id: "oc-1",
    sourceAbilityId: "ab-1",
    sourceAbilityName: "Blight Touch",
    targets: [{ tokenId: "token-kira", name: "Kira" }],
    dc: 18,
    rollLabel: "Physical Save — Recovery",
    steps: steps(block),
    now: 1_000,
  });
}

function counterOf(outcome: PendingOutcome): OutcomeConsequence {
  const found = outcome.consequences.find((consequence) => consequence.kind === "counter");
  expect(found).toBeTruthy();
  return found as OutcomeConsequence;
}

describe("a counter as a consequence", () => {
  it("puts the track move on the card and keeps its marks off it", () => {
    // The whole edge case: deriving `At 8` here would land 1d100 on the FIRST
    // point of Blight, which is the opposite of what the page says.
    const outcome = card(BLIGHT);
    expect(outcome.consequences.map((consequence) => consequence.kind)).toEqual(["counter"]);
    expect(counterOf(outcome)).toMatchObject({ counter: "Blight", delta: 1, cap: 8, on: "fail", declared: true });
  });

  it("carries what each mark owes, because the page is out of scope by then", () => {
    const thresholds = counterOf(card(BLIGHT)).thresholds ?? [];
    expect(thresholds.map((threshold) => threshold.at)).toEqual([8]);
    expect(thresholds[0].consequences.map((consequence) => consequence.kind)).toEqual(["damage", "condition"]);
  });

  it("refuses to nest a track inside its own mark", () => {
    // `At 8: Counter: Blight +1` on the Blight track is a page asking for a
    // loop; the deriver declines to build one.
    const nested = counterOf(card(["- Counter: Blight +1, cap 8", "- At 8: Counter: Blight +1"].join("\n")));
    const inner = nested.thresholds?.[0]?.consequences ?? [];
    expect(inner).toHaveLength(1);
    expect(inner[0].thresholds).toBeUndefined();
  });

  it("says nothing about marks it could not read", () => {
    const parsed = parseAbilityEffects(["- Counter: Overload +1", "- At 4: Cost: 2 SS"].join("\n"));
    // A Cost is the caster's price, not a thing that lands on the target, so the
    // mark owes the card nothing and is dropped rather than left empty.
    const consequence = consequencesFromSteps(parsed.steps).find((entry) => entry.kind === "counter");
    expect(consequence?.thresholds).toBeUndefined();
  });
});

describe("the card a crossing opens", () => {
  const crossing = (crossed: number[]) => {
    const outcome = card(BLIGHT);
    return outcomeFromCrossing({
      outcome,
      target: outcome.targets[0],
      consequence: counterOf(outcome),
      crossed,
      value: 8,
      now: 5_000,
    });
  };

  it("opens nothing when nothing was crossed", () => {
    expect(crossing([])).toBeNull();
  });

  it("opens nothing for a mark that owes the table nothing", () => {
    // `At 4: Cost: 2 SS` is the caster's price, so the deriver drops the mark
    // and the crossing has no rows to offer. A card with no rows is a
    // notification pretending to be a decision — and, worse, one the Curator
    // cannot clear by acting on it, because there is nothing on it to act on.
    const outcome = card(["- Counter: Overload +1", "- At 4: Cost: 2 SS"].join("\n"));
    expect(
      outcomeFromCrossing({
        outcome,
        target: outcome.targets[0],
        consequence: counterOf(outcome),
        crossed: [4],
        value: 4,
        now: 5_000,
      })
    ).toBeNull();
  });

  it("carries the mark's consequences, named by the mark", () => {
    const opened = crossing([8]) as PendingOutcome;
    expect(opened.rollLabel).toBe("Blight reached 8");
    expect(opened.consequences.map((consequence) => consequence.label)).toEqual([
      "At 8 · 1d100",
      "At 8 · Incapacitated",
    ]);
    expect(opened.fromBlock).toBe(true);
    expect(opened.unrolled).toBe(true);
  });

  it("names the ability that moved the track, not just the track", () => {
    // "Blight reached 8" with no ability leaves a Curator holding three Stygians
    // and no way to tell which of them did it.
    expect((crossing([8]) as PendingOutcome).sourceAbilityName).toBe("Blight Touch");
  });

  it("says where the track ended when it ran past the mark it fired", () => {
    const outcome = card(["- Counter: Fear +5", "- At 3: Condition: Frightened"].join("\n"));
    const opened = outcomeFromCrossing({
      outcome,
      target: outcome.targets[0],
      consequence: counterOf(outcome),
      crossed: [3],
      value: 5,
      now: 5_000,
    }) as PendingOutcome;
    expect(opened.rollLabel).toBe("Fear reached 3 — now 5");
  });

  it("keeps two marks crossed at once apart", () => {
    const consequence: OutcomeConsequence = {
      id: "ctr-0",
      kind: "counter",
      label: "Fear +5",
      on: "always",
      counter: "Fear",
      delta: 5,
      thresholds: [
        { at: 3, consequences: [{ id: "dmg-0", kind: "damage", label: "1d6", on: "always", expr: "1d6" }] },
        { at: 5, consequences: [{ id: "dmg-0", kind: "damage", label: "2d6", on: "always", expr: "2d6" }] },
      ],
    };
    const merged = consequencesFromCrossing(consequence, [5, 3]);
    // Ascending, and with distinct ids: the `applied` list is keyed by id, so a
    // collision would mark the 5-damage applied the moment the 3-damage landed.
    expect(merged.map((entry) => entry.id)).toEqual(["t3-dmg-0", "t5-dmg-0"]);
  });

  it("lands a duplicate delivery on the card that already exists", () => {
    expect((crossing([8]) as PendingOutcome).id).toBe((crossing([8]) as PendingOutcome).id);
  });
});

describe("a card with no roll behind it", () => {
  const opened = () => {
    const outcome = card(BLIGHT);
    return outcomeFromCrossing({
      outcome,
      target: outcome.targets[0],
      consequence: counterOf(outcome),
      crossed: [8],
      value: 8,
      now: 5_000,
    }) as PendingOutcome;
  };

  it("arms its consequences with no verdict, because the event already happened", () => {
    const crossing = opened();
    expect(crossing.targets[0].verdict).toBe("pending");
    expect(armedConsequences(crossing, crossing.targets[0])).toHaveLength(2);
  });

  it("still leaves a branch-armed mark to the Curator", () => {
    // `At 8: Fail: …` asks about a verdict this card does not have. Arming it
    // would answer a question the page put to the dice.
    const crossing = { ...opened(), consequences: [{ id: "x", kind: "damage" as const, label: "1d100", on: "fail" as const }] };
    expect(armedConsequences(crossing, crossing.targets[0])).toEqual([]);
  });

  it("outlives the roll TTL, because it is not waiting on a roll", () => {
    // The window exists to reap cards whose roll never came. A crossing already
    // HAPPENED — Blight reached 8 — so reaping it would delete the only record
    // of an event with consequences the page declared, and the Curator would
    // never learn a 1d100 was owed.
    __resetOutcomeLedger();
    const crossing = opened();
    pushOutcome("counter-ttl", crossing);
    expect(listOutcomes("counter-ttl", crossing.expiresAt + 1)).toHaveLength(1);
    // The card it came off IS waiting on one, and still expires on schedule.
    const rolled = card(BLIGHT);
    pushOutcome("counter-ttl", rolled);
    expect(listOutcomes("counter-ttl", rolled.expiresAt + 1).map((entry) => entry.id)).toEqual([crossing.id]);
    __resetOutcomeLedger();
  });

  it("is never marked lapsed by a passing round", () => {
    // A lapse refuses auto-apply and the batch act both, so a threshold card
    // would have gone dead one round after the track crossed — and told the
    // Curator it "never rolled" for a roll nobody owed.
    const crossing = opened();
    expect(lapsePendingTargets(crossing, 7)).toBe(crossing);
    expect(outcomeTally(crossing)).toMatchObject({ live: 1, waiting: 0, lapsed: 0 });
  });

  it("commits without a click only where the table opted in", () => {
    const crossing = opened();
    expect(autoApplicable(crossing, crossing.targets[0], { autoApplyDeclared: false })).toEqual([]);
    expect(autoApplicable(crossing, crossing.targets[0], { autoApplyDeclared: true })).toHaveLength(2);
  });

  it("is reachable by the one-click act only once a verdict is declared", () => {
    // `batchPlan` speaks for targets whose verdict matches; an unrolled card has
    // none until a human says so, which is the conservative direction.
    const crossing = opened();
    expect(batchPlan(crossing, "fail")).toEqual([]);
  });
});

describe("what the table is told", () => {
  it("reads the track even when nothing was crossed", () => {
    expect(crossingLine("Blight", 4, 8, [])).toBe("Blight 4/8");
    expect(crossingLine("Fear Points", 2, undefined, [])).toBe("Fear Points 2");
  });

  it("names every mark reached, ascending", () => {
    expect(crossingLine("Fear", 5, undefined, [5, 3])).toBe("Fear 5 — reached 3, 5");
  });
});
