// @vitest-environment happy-dom
//
// The Curator's automatic genus contest: both sides read off real records —
// no hand-typed opponent numbers, which is the jank this replaced.
import { describe, expect, it } from "vitest";
import { zeroAttributes, zeroSpecialties } from "../../game/wte";
import type { CharacterRecord } from "../../lib/characters";
import { characterActionSet } from "./characterAbilities";
import { bestContestAnswer, contestTokens } from "./genusContest";

function combatant(opts: {
  id: string;
  name: string;
  rank?: number;
  ctrl?: number;
  genus?: Record<string, number>; // ability name → invested Focus
}): CharacterRecord {
  const specialties = zeroSpecialties();
  specialties.ctrl = opts.ctrl ?? 25;
  return {
    id: opts.id,
    campaignId: "table",
    name: opts.name,
    createdAt: 0,
    updatedAt: 0,
    sheet: {
      attributes: zeroAttributes(),
      specialties,
      paradigmId: "cognition",
      rank: opts.rank ?? 3,
      genusLoadout: Object.keys(opts.genus ?? {}),
      // Stored as an OBJECT on real sheets — parseSpend rejects strings.
      focusSpend: { genus: opts.genus ?? {}, incepts: [] },
    },
  } as unknown as CharacterRecord;
}

describe("the defender's answer", () => {
  it("is their most strongly focused genus", () => {
    const defender = combatant({ id: "d", name: "Vex", genus: { Reflect: 2, Negate: 4 } });
    expect(bestContestAnswer(defender)?.name).toBe("Negate");
    expect(bestContestAnswer(defender)?.focus).toBe(4);
  });

  it("is null when they know no genus — nothing to contest with", () => {
    const defender = combatant({ id: "d", name: "Vex", genus: {} });
    expect(bestContestAnswer(defender)).toBeNull();
  });
});

describe("contestTokens", () => {
  it("resolves a Focus mismatch without dice, higher Focus winning", () => {
    const attacker = combatant({ id: "a", name: "Ash", genus: { Lark: 4 } });
    const defender = combatant({ id: "d", name: "Vex", genus: { Reflect: 2 } });
    const ability = characterActionSet(attacker).genus.find((g) => g.name === "Lark")!;
    expect(ability.focus).toBe(4);

    const outcome = contestTokens(attacker, ability, defender)!;
    expect(outcome.result.winner).toBe("a");
    expect(outcome.result.byFocus).toBe(true);
    expect(outcome.result.aRoll).toBeUndefined(); // no dice on a Focus win
    expect(outcome.defenderAbility).toBe("Reflect");
    expect(outcome.verdict).toContain("overpowers");
  });

  it("rolls contested Control on equal Focus, both rolls surfaced", () => {
    const attacker = combatant({ id: "a", name: "Ash", genus: { Lark: 3 }, ctrl: 40, rank: 5 });
    const defender = combatant({ id: "d", name: "Vex", genus: { Reflect: 3 }, ctrl: 40, rank: 5 });
    const ability = characterActionSet(attacker).genus.find((g) => g.name === "Lark")!;

    const outcome = contestTokens(attacker, ability, defender)!;
    expect(outcome.result.byFocus).toBe(false);
    // Both real d40s exist so the whole table can see what was thrown.
    expect(outcome.result.aRoll).toBeDefined();
    expect(outcome.result.bRoll).toBeDefined();
    expect(["a", "b"]).toContain(outcome.result.winner);
    expect(outcome.verdict).toContain("takes the contest");
  });

  it("reads Control and rank from the records, not from typed-in numbers", () => {
    const attacker = combatant({ id: "a", name: "Ash", genus: { Lark: 3 }, ctrl: 60, rank: 9 });
    const defender = combatant({ id: "d", name: "Vex", genus: { Reflect: 3 }, ctrl: 10, rank: 1 });
    const ability = characterActionSet(attacker).genus.find((g) => g.name === "Lark")!;

    const outcome = contestTokens(attacker, ability, defender)!;
    expect(outcome.attacker.control).toBe(60);
    expect(outcome.attacker.rank).toBe(9);
    expect(outcome.defender.control).toBe(10);
    expect(outcome.defender.rank).toBe(1);
    expect(outcome.attacker.label).toContain("Ash");
    expect(outcome.defender.label).toContain("Vex");
  });

  it("returns null against a defender with no genus", () => {
    const attacker = combatant({ id: "a", name: "Ash", genus: { Lark: 3 } });
    const defender = combatant({ id: "d", name: "Bystander", genus: {} });
    const ability = characterActionSet(attacker).genus.find((g) => g.name === "Lark")!;
    expect(contestTokens(attacker, ability, defender)).toBeNull();
  });
});
