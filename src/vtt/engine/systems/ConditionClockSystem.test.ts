import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ConditionClockSystem,
  MAX_CONDITION_CLOCKS,
  UNDECLARED_STACKING,
  conditionOfTag,
  stackingForTag,
  type ConditionVitalsWriter,
} from "./ConditionClockSystem";
import { setCodexConditions, type CodexCondition, type ConditionStacking } from "../../../game/conditions";
import { defaultSceneData, type VttSceneData, type VttToken } from "../../types/scene";

/** A Conditions page as the loader hands it over — the Stacking field is the
 *  only thing this system reads, and it must come from the page, never here. */
function condition(name: string, stacking: ConditionStacking): CodexCondition {
  return {
    id: `wte.condition.${name.toLowerCase()}`,
    scope: "wte",
    name,
    aliases: [],
    effect: `${name} does what its page says.`,
    stacking,
  };
}

function tok(id: string, statuses?: string[]): VttToken {
  return { id, name: id, x: 35, y: 35, size: 1, color: "#fff", visible: true, ...(statuses ? { statuses } : {}) };
}

function scene(...tokens: VttToken[]): VttSceneData {
  const data = defaultSceneData();
  data.tokens = tokens.length ? tokens : [tok("t1")];
  return data;
}

/** The Curator's authorised path, stubbed: it commits and reports true, exactly
 *  as adjudicateTokenVitals does for a scene the Curator owns. */
function writer(data: VttSceneData): ConditionVitalsWriter & { calls: number } {
  const write = ((tokenId: string, statuses: string[]) => {
    const token = data.tokens.find((t) => t.id === tokenId);
    if (!token) return false;
    token.statuses = statuses;
    write.calls++;
    return true;
  }) as ConditionVitalsWriter & { calls: number };
  write.calls = 0;
  return write;
}

/** Apply through the system the way the engine does: plan, commit, store. */
function apply(
  system: ConditionClockSystem,
  data: VttSceneData,
  input: { tokenId: string; status: string; round: number; rounds?: number; potency?: number }
): ConditionStacking | null {
  const plan = system.plan(data, input);
  if (!plan) return null;
  const token = data.tokens.find((t) => t.id === input.tokenId);
  if (token) token.statuses = plan.statuses;
  if (plan.clocks.length) data.conditionClocks = plan.clocks;
  else delete data.conditionClocks;
  return plan.stacking;
}

const statusesOf = (data: VttSceneData, id = "t1"): string[] => data.tokens.find((t) => t.id === id)?.statuses ?? [];

afterEach(() => {
  setCodexConditions([]);
});

describe("reading the rule off the page", () => {
  it("resolves a tag that carries its rounds in the text", () => {
    setCodexConditions([condition("Slowed", "refresh")]);

    // conditionTag writes "Slowed (2)"; the page is named "Slowed".
    expect(conditionOfTag("Slowed (2)")).toBe("Slowed");
    expect(stackingForTag("Slowed (2)")).toBe("refresh");
    expect(stackingForTag("slowed")).toBe("refresh");
  });

  it("takes each of the four rules from the condition's own page", () => {
    setCodexConditions([
      condition("Slowed", "refresh"),
      condition("Frozen", "extend"),
      condition("Bleeding", "stack"),
      condition("Charmed", "highest"),
    ]);

    expect(stackingForTag("Slowed")).toBe("refresh");
    expect(stackingForTag("Frozen")).toBe("extend");
    expect(stackingForTag("Bleeding")).toBe("stack");
    expect(stackingForTag("Charmed")).toBe("highest");
  });

  it("falls back for a tag no page defines, and says so out loud", () => {
    setCodexConditions([condition("Slowed", "stack")]);

    // Named, not compared to itself: the fallback is a promise to the table
    // about undeclared text, so a change to it has to break something.
    expect(UNDECLARED_STACKING).toBe("refresh");
    expect(stackingForTag("Marked by the Curator")).toBe(UNDECLARED_STACKING);
    // A campaign that redefines Slowed as stacking must be obeyed, not defaulted.
    expect(stackingForTag("Slowed")).toBe("stack");
  });

  it("never lets an undefined tag multiply, however often it is applied", () => {
    setCodexConditions([]);
    const system = new ConditionClockSystem();
    const data = scene();

    apply(system, data, { tokenId: "t1", status: "Marked", round: 1, rounds: 2 });
    apply(system, data, { tokenId: "t1", status: "Marked", round: 2, rounds: 4 });

    // One pip and the longer clock — what `refresh` does, proven by behaviour
    // rather than by reading the constant back.
    expect(statusesOf(data)).toEqual(["Marked"]);
    expect(data.conditionClocks).toEqual([{ tokenId: "t1", status: "Marked", bornRound: 2, rounds: 4 }]);
  });
});

describe("the round tick", () => {
  it("removes the condition on the round it runs out, and NOT a round early", () => {
    setCodexConditions([condition("Slowed", "refresh")]);
    const data = scene();
    const system = new ConditionClockSystem();
    const write = writer(data);

    apply(system, data, { tokenId: "t1", status: "Slowed (2)", round: 3, rounds: 2 });
    expect(statusesOf(data)).toEqual(["Slowed (2)"]);

    expect(system.expire(data, 3, write)).toEqual([]);
    expect(system.expire(data, 4, write)).toEqual([]);
    expect(statusesOf(data)).toEqual(["Slowed (2)"]);
    expect(data.conditionClocks).toHaveLength(1);

    expect(system.expire(data, 5, write)).toEqual(["Slowed (2)"]);
    expect(statusesOf(data)).toEqual([]);
    // The clock goes with it — an expired countdown left behind would fire again.
    expect(data.conditionClocks).toBeUndefined();
  });

  it("expires a one-round condition on the very next round", () => {
    setCodexConditions([condition("Stunned", "refresh")]);
    const data = scene();
    const system = new ConditionClockSystem();
    const write = writer(data);

    apply(system, data, { tokenId: "t1", status: "Stunned (1)", round: 7, rounds: 1 });
    expect(system.expire(data, 7, write)).toEqual([]);
    expect(system.expire(data, 8, write)).toEqual(["Stunned (1)"]);
  });

  it("never expires a condition applied without a duration", () => {
    setCodexConditions([condition("Restrained", "refresh")]);
    const data = scene();
    const system = new ConditionClockSystem();
    const write = writer(data);

    apply(system, data, { tokenId: "t1", status: "Restrained", round: 1 });
    expect(data.conditionClocks).toBeUndefined();

    for (let round = 2; round < 60; round++) expect(system.expire(data, round, write)).toEqual([]);
    expect(statusesOf(data)).toEqual(["Restrained"]);
  });

  it("leaves other tokens and other tags alone", () => {
    setCodexConditions([condition("Slowed", "refresh"), condition("Burning", "stack")]);
    const data = scene(tok("t1"), tok("t2"));
    const system = new ConditionClockSystem();
    const write = writer(data);

    apply(system, data, { tokenId: "t1", status: "Slowed (1)", round: 1, rounds: 1 });
    apply(system, data, { tokenId: "t1", status: "Burning (5)", round: 1, rounds: 5 });
    apply(system, data, { tokenId: "t2", status: "Slowed (4)", round: 1, rounds: 4 });

    expect(system.expire(data, 2, write)).toEqual(["Slowed (1)"]);
    expect(statusesOf(data, "t1")).toEqual(["Burning (5)"]);
    expect(statusesOf(data, "t2")).toEqual(["Slowed (4)"]);
    expect(data.conditionClocks).toHaveLength(2);
  });

  it("keeps the tag AND the clock when the authorised write is refused", () => {
    setCodexConditions([condition("Slowed", "refresh")]);
    const data = scene();
    const system = new ConditionClockSystem();
    const refuse = vi.fn(() => false);

    apply(system, data, { tokenId: "t1", status: "Slowed (1)", round: 1, rounds: 1 });
    expect(system.expire(data, 2, refuse)).toEqual([]);
    // Announcing a removal the engine would not commit is the one lie the whole
    // adjudication path exists to prevent.
    expect(statusesOf(data)).toEqual(["Slowed (1)"]);
    expect(data.conditionClocks).toHaveLength(1);

    const write = writer(data);
    expect(system.expire(data, 3, write)).toEqual(["Slowed (1)"]);
    expect(statusesOf(data)).toEqual([]);
  });

  it("costs nothing on a scene that has never used a clock", () => {
    const data = scene();
    const system = new ConditionClockSystem();
    const write = writer(data);
    const before = JSON.stringify(data);

    expect(system.expire(data, 12, write)).toEqual([]);
    expect(system.prune(data)).toBe(false);
    expect(system.restart(data, 12)).toBe(false);
    expect(write.calls).toBe(0);
    // The field stays ABSENT, so such a scene saves and syncs byte for byte
    // what a build that predates clocks would have written.
    expect("conditionClocks" in data).toBe(false);
    expect(JSON.stringify(data)).toBe(before);
  });
});

describe("stacking — refresh", () => {
  it("keeps one instance and lets the longer duration win", () => {
    setCodexConditions([condition("Slowed", "refresh")]);
    const data = scene();
    const system = new ConditionClockSystem();
    const write = writer(data);

    apply(system, data, { tokenId: "t1", status: "Slowed", round: 1, rounds: 2 }); // expires at 3
    apply(system, data, { tokenId: "t1", status: "Slowed", round: 2, rounds: 4 }); // expires at 6

    expect(statusesOf(data)).toEqual(["Slowed"]);
    expect(data.conditionClocks).toHaveLength(1);
    expect(system.expire(data, 3, write)).toEqual([]);
    expect(system.expire(data, 6, write)).toEqual(["Slowed"]);
  });

  it("does not let a shorter second application cut the first short", () => {
    setCodexConditions([condition("Slowed", "refresh")]);
    const data = scene();
    const system = new ConditionClockSystem();
    const write = writer(data);

    apply(system, data, { tokenId: "t1", status: "Slowed", round: 1, rounds: 5 }); // expires at 6
    apply(system, data, { tokenId: "t1", status: "Slowed", round: 2, rounds: 1 }); // would expire at 3

    expect(system.expire(data, 3, write)).toEqual([]);
    expect(system.expire(data, 6, write)).toEqual(["Slowed"]);
  });

  it("treats an endless application as the longer one, in both directions", () => {
    setCodexConditions([condition("Slowed", "refresh")]);
    const data = scene();
    const system = new ConditionClockSystem();
    const write = writer(data);

    apply(system, data, { tokenId: "t1", status: "Slowed", round: 1, rounds: 3 });
    apply(system, data, { tokenId: "t1", status: "Slowed", round: 1 }); // no duration = endless
    expect(data.conditionClocks).toBeUndefined();
    expect(system.expire(data, 40, write)).toEqual([]);

    // And a finite application cannot put an end to an endless one.
    apply(system, data, { tokenId: "t1", status: "Slowed", round: 2, rounds: 2 });
    expect(data.conditionClocks).toBeUndefined();
    expect(system.expire(data, 40, write)).toEqual([]);
    expect(statusesOf(data)).toEqual(["Slowed"]);
  });
});

describe("stacking — extend", () => {
  it("adds the durations together", () => {
    setCodexConditions([condition("Frozen", "extend")]);
    const data = scene();
    const system = new ConditionClockSystem();
    const write = writer(data);

    apply(system, data, { tokenId: "t1", status: "Frozen", round: 1, rounds: 2 }); // expires at 3
    apply(system, data, { tokenId: "t1", status: "Frozen", round: 2, rounds: 3 }); // + 3 = expires at 6

    expect(statusesOf(data)).toEqual(["Frozen"]);
    expect(data.conditionClocks).toHaveLength(1);
    expect(system.expire(data, 5, write)).toEqual([]);
    expect(system.expire(data, 6, write)).toEqual(["Frozen"]);
  });

  it("adds even when the second application is shorter than the first", () => {
    setCodexConditions([condition("Frozen", "extend")]);
    const data = scene();
    const system = new ConditionClockSystem();
    const write = writer(data);

    apply(system, data, { tokenId: "t1", status: "Frozen", round: 1, rounds: 4 }); // expires at 5
    apply(system, data, { tokenId: "t1", status: "Frozen", round: 2, rounds: 1 }); // + 1 = expires at 6

    expect(system.expire(data, 5, write)).toEqual([]);
    expect(system.expire(data, 6, write)).toEqual(["Frozen"]);
  });

  it("cannot extend an endless instance into a finite one", () => {
    setCodexConditions([condition("Frozen", "extend")]);
    const data = scene();
    const system = new ConditionClockSystem();
    const write = writer(data);

    apply(system, data, { tokenId: "t1", status: "Frozen", round: 1 });
    apply(system, data, { tokenId: "t1", status: "Frozen", round: 2, rounds: 3 });

    expect(data.conditionClocks).toBeUndefined();
    expect(system.expire(data, 90, write)).toEqual([]);
  });
});

describe("stacking — stack", () => {
  it("counts instances separately and expires them one at a time", () => {
    setCodexConditions([condition("Bleeding", "stack")]);
    const data = scene();
    const system = new ConditionClockSystem();
    const write = writer(data);

    apply(system, data, { tokenId: "t1", status: "Bleeding", round: 1, rounds: 2 }); // expires at 3
    apply(system, data, { tokenId: "t1", status: "Bleeding", round: 2, rounds: 3 }); // expires at 5

    // Two instances, two pips, two clocks — nothing is merged.
    expect(statusesOf(data)).toEqual(["Bleeding", "Bleeding"]);
    expect(data.conditionClocks).toHaveLength(2);

    expect(system.expire(data, 3, write)).toEqual(["Bleeding"]);
    expect(statusesOf(data)).toEqual(["Bleeding"]);
    expect(data.conditionClocks).toHaveLength(1);

    expect(system.expire(data, 5, write)).toEqual(["Bleeding"]);
    expect(statusesOf(data)).toEqual([]);
    expect(data.conditionClocks).toBeUndefined();
  });

  it("expires two stacks that run out on the same round together", () => {
    setCodexConditions([condition("Bleeding", "stack")]);
    const data = scene();
    const system = new ConditionClockSystem();
    const write = writer(data);

    apply(system, data, { tokenId: "t1", status: "Bleeding", round: 1, rounds: 2 });
    apply(system, data, { tokenId: "t1", status: "Bleeding", round: 1, rounds: 2 });

    expect(system.expire(data, 3, write)).toEqual(["Bleeding", "Bleeding"]);
    expect(statusesOf(data)).toEqual([]);
    expect(write.calls).toBe(1); // one authorised write per token, not per stack
  });

  it("keeps an endless stack while a timed one beside it runs out", () => {
    setCodexConditions([condition("Bleeding", "stack")]);
    const data = scene();
    const system = new ConditionClockSystem();
    const write = writer(data);

    apply(system, data, { tokenId: "t1", status: "Bleeding", round: 1 });
    apply(system, data, { tokenId: "t1", status: "Bleeding", round: 1, rounds: 1 });

    expect(system.expire(data, 2, write)).toEqual(["Bleeding"]);
    expect(statusesOf(data)).toEqual(["Bleeding"]);
    expect(data.conditionClocks).toBeUndefined();
  });
});

describe("stacking — highest", () => {
  it("lets the stronger application take over, duration included", () => {
    setCodexConditions([condition("Charmed", "highest")]);
    const data = scene();
    const system = new ConditionClockSystem();
    const write = writer(data);

    apply(system, data, { tokenId: "t1", status: "Charmed", round: 1, rounds: 6, potency: 2 }); // expires at 7
    apply(system, data, { tokenId: "t1", status: "Charmed", round: 1, rounds: 2, potency: 9 }); // expires at 3

    expect(statusesOf(data)).toEqual(["Charmed"]);
    expect(data.conditionClocks).toHaveLength(1);
    // The weaker application is discarded outright — its longer duration does
    // not survive the application that beat it.
    expect(system.expire(data, 3, write)).toEqual(["Charmed"]);
  });

  it("discards the weaker application even when it would last longer", () => {
    setCodexConditions([condition("Charmed", "highest")]);
    const data = scene();
    const system = new ConditionClockSystem();
    const write = writer(data);

    apply(system, data, { tokenId: "t1", status: "Charmed", round: 1, rounds: 2, potency: 9 }); // expires at 3
    apply(system, data, { tokenId: "t1", status: "Charmed", round: 1, rounds: 8, potency: 1 });

    expect(system.expire(data, 3, write)).toEqual(["Charmed"]);
    expect(data.conditionClocks).toBeUndefined();
  });

  it("measures strength by the declared duration when no potency is given", () => {
    setCodexConditions([condition("Charmed", "highest")]);
    const data = scene();
    const system = new ConditionClockSystem();
    const write = writer(data);

    apply(system, data, { tokenId: "t1", status: "Charmed", round: 1, rounds: 5 }); // expires at 6
    // Weaker (3 < 5), so it is discarded — where `refresh` would have compared
    // what is LEFT (4 rounds at round 2) and kept the longer of the two.
    apply(system, data, { tokenId: "t1", status: "Charmed", round: 2, rounds: 3 });

    expect(system.expire(data, 5, write)).toEqual([]);
    expect(system.expire(data, 6, write)).toEqual(["Charmed"]);
  });

  it("is not renewed by an application that only matches it", () => {
    setCodexConditions([condition("Charmed", "highest")]);
    const data = scene();
    const system = new ConditionClockSystem();
    const write = writer(data);

    apply(system, data, { tokenId: "t1", status: "Charmed", round: 1, rounds: 3, potency: 4 }); // expires at 4
    // Equal strength is not GREATER strength: the running clock stands, and the
    // second casting does not buy three more rounds off the back of the first.
    apply(system, data, { tokenId: "t1", status: "Charmed", round: 3, rounds: 3, potency: 4 });

    expect(data.conditionClocks).toEqual([{ tokenId: "t1", status: "Charmed", bornRound: 1, rounds: 3, potency: 4 }]);
    expect(system.expire(data, 4, write)).toEqual(["Charmed"]);
  });

  it("cannot be beaten by a finite application once it is endless", () => {
    setCodexConditions([condition("Charmed", "highest")]);
    const data = scene();
    const system = new ConditionClockSystem();
    const write = writer(data);

    apply(system, data, { tokenId: "t1", status: "Charmed", round: 1 });
    apply(system, data, { tokenId: "t1", status: "Charmed", round: 1, rounds: 3, potency: 1_000 });

    expect(data.conditionClocks).toBeUndefined();
    expect(system.expire(data, 50, write)).toEqual([]);
    expect(statusesOf(data)).toEqual(["Charmed"]);
  });
});

describe("applying", () => {
  it("refuses a token that is not on the scene, or an empty tag", () => {
    setCodexConditions([condition("Slowed", "refresh")]);
    const system = new ConditionClockSystem();
    const data = scene();

    expect(system.plan(data, { tokenId: "ghost", status: "Slowed", round: 1, rounds: 2 })).toBeNull();
    expect(system.plan(data, { tokenId: "t1", status: "   ", round: 1, rounds: 2 })).toBeNull();
  });

  it("ignores a duration that is not a whole round", () => {
    setCodexConditions([condition("Slowed", "refresh")]);
    const system = new ConditionClockSystem();
    const data = scene();

    apply(system, data, { tokenId: "t1", status: "Slowed", round: 1, rounds: 0 });
    expect(statusesOf(data)).toEqual(["Slowed"]);
    expect(data.conditionClocks).toBeUndefined();

    apply(system, data, { tokenId: "t1", status: "Slowed", round: 1, rounds: Number.NaN });
    expect(data.conditionClocks).toBeUndefined();

    // A fraction is cut DOWN, never up: half a round is not a round, and a clock
    // must never outlast the duration whoever declared it could have meant. On a
    // clean scene, because the endless pip above would outlast any of them.
    const fresh = scene();
    apply(system, fresh, { tokenId: "t1", status: "Slowed", round: 1, rounds: 2.9 });
    expect(fresh.conditionClocks).toEqual([{ tokenId: "t1", status: "Slowed", bornRound: 1, rounds: 2 }]);
  });

  it("collapses duplicate pips and their clocks when the page says one instance", () => {
    setCodexConditions([condition("Slowed", "refresh")]);
    const system = new ConditionClockSystem();
    // Two pips and two clocks: the page used to say `stack` and the table has
    // since forked it. A rule that says one instance cannot leave two standing.
    const data = scene(tok("t1", ["Slowed", "Slowed"]));
    data.conditionClocks = [
      { tokenId: "t1", status: "Slowed", bornRound: 1, rounds: 2 },
      { tokenId: "t1", status: "Slowed", bornRound: 1, rounds: 3 },
    ];

    apply(system, data, { tokenId: "t1", status: "Slowed", round: 2, rounds: 4 });
    expect(statusesOf(data)).toEqual(["Slowed"]);
    expect(data.conditionClocks).toEqual([{ tokenId: "t1", status: "Slowed", bornRound: 2, rounds: 4 }]);
  });

  it("collapses duplicate endless pips without inventing a clock for them", () => {
    setCodexConditions([condition("Slowed", "refresh")]);
    const system = new ConditionClockSystem();
    const data = scene(tok("t1", ["Slowed", "Slowed"]));

    // Both pips are clockless, so both are endless, and endless outlasts 2 rounds.
    apply(system, data, { tokenId: "t1", status: "Slowed", round: 1, rounds: 2 });
    expect(statusesOf(data)).toEqual(["Slowed"]);
    expect(data.conditionClocks).toBeUndefined();
  });

  it("treats a stale clock on a tag the Curator cleared as no clock at all", () => {
    setCodexConditions([condition("Slowed", "refresh")]);
    const system = new ConditionClockSystem();
    const data = scene();
    const write = writer(data);
    data.conditionClocks = [{ tokenId: "t1", status: "Slowed", bornRound: 1, rounds: 99 }];

    apply(system, data, { tokenId: "t1", status: "Slowed", round: 2, rounds: 2 });
    expect(data.conditionClocks).toEqual([{ tokenId: "t1", status: "Slowed", bornRound: 2, rounds: 2 }]);
    expect(system.expire(data, 4, write)).toEqual(["Slowed"]);
  });

  it("refuses rather than losing the clock when the scene is at its ceiling", () => {
    setCodexConditions([condition("Bleeding", "stack")]);
    const system = new ConditionClockSystem();
    const data = scene();
    data.conditionClocks = Array.from({ length: MAX_CONDITION_CLOCKS }, (_, i) => ({
      tokenId: "t1",
      status: `Filler ${i}`,
      bornRound: 0,
      rounds: 10_000,
    }));

    expect(system.plan(data, { tokenId: "t1", status: "Bleeding", round: 1, rounds: 2 })).toBeNull();
    // A condition with no clock to store is still applicable at the ceiling.
    expect(system.plan(data, { tokenId: "t1", status: "Bleeding", round: 1 })).toMatchObject({ statuses: ["Bleeding"] });
  });
});

describe("orphans", () => {
  it("drops the clocks of a deleted token", () => {
    setCodexConditions([condition("Slowed", "refresh")]);
    const system = new ConditionClockSystem();
    const data = scene(tok("t1"), tok("t2"));

    apply(system, data, { tokenId: "t1", status: "Slowed", round: 1, rounds: 4 });
    apply(system, data, { tokenId: "t2", status: "Slowed", round: 1, rounds: 4 });
    data.tokens = data.tokens.filter((t) => t.id !== "t1");

    expect(system.prune(data)).toBe(true);
    expect(data.conditionClocks).toEqual([{ tokenId: "t2", status: "Slowed", bornRound: 1, rounds: 4 }]);
    expect(system.prune(data)).toBe(false);
  });

  it("drops the clock of a status a Curator cleared by hand", () => {
    setCodexConditions([condition("Slowed", "refresh")]);
    const system = new ConditionClockSystem();
    const data = scene();

    apply(system, data, { tokenId: "t1", status: "Slowed", round: 1, rounds: 4 });
    data.tokens[0].statuses = [];

    expect(system.prune(data)).toBe(true);
    expect(data.conditionClocks).toBeUndefined();
  });

  it("drops surplus clocks down to the pips the token actually carries", () => {
    setCodexConditions([condition("Bleeding", "stack")]);
    const system = new ConditionClockSystem();
    const data = scene(tok("t1", ["Bleeding"]));
    data.conditionClocks = [
      { tokenId: "t1", status: "Bleeding", bornRound: 1, rounds: 2 },
      { tokenId: "t1", status: "Bleeding", bornRound: 1, rounds: 9 },
    ];

    expect(system.prune(data)).toBe(true);
    expect(data.conditionClocks).toEqual([{ tokenId: "t1", status: "Bleeding", bornRound: 1, rounds: 2 }]);
  });

  it("drops malformed clocks a peer or an old save handed over", () => {
    const system = new ConditionClockSystem();
    const data = scene(tok("t1", ["Slowed"]));
    data.conditionClocks = [
      { tokenId: "t1", status: "Slowed", bornRound: Number.NaN, rounds: 2 },
      { tokenId: "", status: "Slowed", bornRound: 1, rounds: 2 },
      { tokenId: "t1", status: "Slowed", bornRound: 1, rounds: 0 },
    ];

    expect(system.prune(data)).toBe(true);
    expect(data.conditionClocks).toBeUndefined();
  });

  it("never fires a vitals write at a token that is gone", () => {
    setCodexConditions([condition("Slowed", "refresh")]);
    const system = new ConditionClockSystem();
    const data = scene();
    const write = writer(data);

    apply(system, data, { tokenId: "t1", status: "Slowed", round: 1, rounds: 1 });
    data.tokens = [];

    expect(system.expire(data, 9, write)).toEqual([]);
    expect(write.calls).toBe(0);
    expect(data.conditionClocks).toBeUndefined();
  });
});

describe("the counter starting over", () => {
  it("carries only the rounds a condition had left into the next fight", () => {
    setCodexConditions([condition("Slowed", "refresh")]);
    const system = new ConditionClockSystem();
    const data = scene();
    const write = writer(data);

    // Round 9 of a long fight, for 3 rounds: rounds 9, 10 and 11 are its own.
    apply(system, data, { tokenId: "t1", status: "Slowed", round: 9, rounds: 3 });
    // The fight ends on round 10, so exactly one round was still owed.
    expect(system.restart(data, 10)).toBe(true);

    // Round 1 of the NEXT encounter is that round, and round 2 is not. Without
    // the re-anchor the absolute expiry of 12 would have stood through eleven.
    expect(system.expire(data, 1, write)).toEqual([]);
    expect(statusesOf(data)).toEqual(["Slowed"]);
    expect(system.expire(data, 2, write)).toEqual(["Slowed"]);
    expect(data.conditionClocks).toBeUndefined();
  });

  it("gives a clock whose removal was refused one more round, not immortality", () => {
    setCodexConditions([condition("Slowed", "refresh")]);
    const system = new ConditionClockSystem();
    const data = scene();
    const write = writer(data);

    apply(system, data, { tokenId: "t1", status: "Slowed", round: 2, rounds: 1 }); // expired at 3
    expect(system.restart(data, 8)).toBe(true);

    expect(system.expire(data, 1, write)).toEqual(["Slowed"]);
    expect(data.conditionClocks).toBeUndefined();
  });

  it("leaves an endless condition endless, and a scene with no clocks untouched", () => {
    setCodexConditions([condition("Slowed", "refresh")]);
    const system = new ConditionClockSystem();
    const data = scene();

    apply(system, data, { tokenId: "t1", status: "Slowed", round: 4 });
    expect(system.restart(data, 9)).toBe(false);
    expect("conditionClocks" in data).toBe(false);
    expect(statusesOf(data)).toEqual(["Slowed"]);
  });
});
