import { describe, it, expect } from "vitest";
import { effectSuspended, resumeSuspended, suspensionRemaining } from "./effectSuspension";
import { EncounterSystem } from "./EncounterSystem";
import { TimelineSystem } from "./TimelineSystem";
import { SimulationSystem } from "./SimulationSystem";
import { ConditionClockSystem } from "./ConditionClockSystem";
import { RecurringEffectSystem } from "./RecurringEffectSystem";
import {
  defaultSceneData,
  type VttEffect,
  type VttEffectData,
  type VttSceneData,
  type VttToken,
} from "../../types/scene";

const SIZE = 70;

const fx = (id: string, data: VttEffectData, x = 0, y = 0): VttEffect => ({ id, kind: "circle", x, y, data });

const tok = (id: string, x: number, y: number, statuses?: string[]): VttToken => ({
  id,
  name: id,
  x,
  y,
  size: 1,
  color: "#fff",
  visible: true,
  ...(statuses ? { statuses } : {}),
});

function scene(effects: VttEffect[], tokens: VttToken[], round = 1): VttSceneData {
  const data = defaultSceneData();
  data.grid = { ...data.grid, size: SIZE };
  data.effects = effects;
  data.tokens = tokens;
  data.timeline = { round, turn: 0 };
  return data;
}

const commit = (data: VttSceneData) => (id: string, statuses: string[]) => {
  const token = data.tokens.find((t) => t.id === id);
  if (!token) return false;
  token.statuses = statuses;
  return true;
};

function encounter(): EncounterSystem {
  return new EncounterSystem(
    new TimelineSystem(),
    new SimulationSystem(),
    new ConditionClockSystem(),
    new RecurringEffectSystem()
  );
}

/** Advance the scene one round the way the engine does — set the timeline first,
 *  then run the hook, because every system on it reads `data.timeline.round`. */
function advance(system: EncounterSystem, data: VttSceneData, round: number, proposals?: unknown[]): void {
  data.timeline = { round, turn: 0 };
  system.onRound(data, round, SIZE, commit(data), (batch) => proposals?.push(...batch));
}

describe("effectSuspended", () => {
  it("is asleep below its wake round and awake on it", () => {
    const effect = fx("f", { radius: 3, suspendedAt: 2, suspendedUntil: 4 });
    expect(effectSuspended(effect, 3)).toBe(true);
    expect(effectSuspended(effect, 4)).toBe(false);
    expect(suspensionRemaining(effect, 3)).toBe(1);
    expect(suspensionRemaining(effect, 4)).toBe(0);
  });

  it("treats a garbage wake round as awake rather than freezing forever", () => {
    // A peer on a build that never heard of the field, or a hand-edited scene,
    // must not be able to produce an effect nothing can ever wake.
    const effect = fx("f", { radius: 3, suspendedUntil: Number.NaN as unknown as number });
    expect(effectSuspended(effect, 99)).toBe(false);
  });
});

describe("resumeSuspended", () => {
  it("hands back exactly the rounds it slept", () => {
    const data = scene([fx("f", { radius: 3, rounds: 3, bornRound: 1, suspendedAt: 2, suspendedUntil: 5 })], []);
    expect(resumeSuspended(data, 5)).toEqual(["f"]);
    // Born on 1 with 3 rounds would have expired at 4; three rounds asleep push
    // that to 7, so it burns for the three rounds the page wrote.
    expect(data.effects[0].data.bornRound).toBe(4);
    expect(data.effects[0].data.suspendedUntil).toBeUndefined();
    expect(data.effects[0].data.suspendedAt).toBeUndefined();
  });

  it("wakes nothing twice, so a hook that fires again cannot pay the same rounds", () => {
    const data = scene([fx("f", { radius: 3, rounds: 3, bornRound: 1, suspendedAt: 2, suspendedUntil: 5 })], []);
    resumeSuspended(data, 5);
    expect(resumeSuspended(data, 5)).toEqual([]);
    expect(data.effects[0].data.bornRound).toBe(4);
  });

  it("never shortens a life when the two halves of the record disagree", () => {
    const data = scene([fx("f", { radius: 3, rounds: 3, bornRound: 1, suspendedAt: 9, suspendedUntil: 5 })], []);
    resumeSuspended(data, 5);
    expect(data.effects[0].data.bornRound).toBe(1);
  });
});

describe("a suspended field over a body", () => {
  it("takes back its pip while it sleeps and grants it again when it wakes", () => {
    const system = encounter();
    const data = scene([fx("f", { radius: 3, status: "Burning", bornRound: 1 })], [tok("kira", 0, 0)]);
    advance(system, data, 2);
    expect(data.tokens[0].statuses).toEqual(["Burning"]);

    data.effects[0].data.suspendedAt = 2;
    data.effects[0].data.suspendedUntil = 4;
    advance(system, data, 3);
    // THE STRANDING TEST. The sim only revokes a status some live effect claims,
    // so a suspended zone has to stay in the owner list while containing nobody.
    // Dropping it instead would leave this pip on for the rest of the campaign.
    expect(data.tokens[0].statuses).toEqual([]);

    advance(system, data, 4);
    expect(data.tokens[0].statuses).toEqual(["Burning"]);
  });

  it("proposes nothing while asleep and still owes its full count of rounds afterwards", () => {
    const ticks = [{ id: "t0", kind: "damage" as const, label: "1d6", on: "always" as const, expr: "1d6" }];
    const rounds = 3;

    // The control: never suspended, born on 1, ticking on 2, 3 and 4.
    const plain = scene([fx("f", { radius: 3, rounds, bornRound: 1, ticks })], [tok("kira", 0, 0)]);
    const plainSystem = encounter();
    const untouched: unknown[] = [];
    for (let round = 2; round <= 9; round++) advance(plainSystem, plain, round, untouched);

    // The same field, asleep for rounds 1 and 2.
    const delayed = scene([fx("f", { radius: 3, rounds, bornRound: 1, ticks })], [tok("kira", 0, 0)]);
    delayed.effects[0].data.suspendedAt = 1;
    delayed.effects[0].data.suspendedUntil = 3;
    const delayedSystem = encounter();

    const asleep: unknown[] = [];
    advance(delayedSystem, delayed, 2, asleep);
    expect(asleep).toHaveLength(0);
    // The guard runs BEFORE the stamp: a round marked paid while nothing
    // happened would be a round the field never gets back.
    expect(delayed.effects[0].data.tickedRound).toBeUndefined();

    const after: unknown[] = [];
    for (let round = 3; round <= 9; round++) advance(delayedSystem, delayed, round, after);

    // Delay SHIFTS the field; it does not shorten it. Waking re-anchors
    // `bornRound`, so the wake round is its new arrival — nothing is owed for it
    // — and the three rounds the page wrote all still land, later.
    expect(after).toHaveLength(untouched.length);
    expect(after).toHaveLength(rounds);
  });

  it("does not age while asleep, so a delay is never a slower end", () => {
    const system = encounter();
    // Born on 1 with 2 rounds: without suspension it is gone by round 3.
    const data = scene([fx("f", { radius: 3, rounds: 2, bornRound: 1 })], []);
    data.effects[0].data.suspendedAt = 1;
    data.effects[0].data.suspendedUntil = 3;
    advance(system, data, 2);
    expect(data.effects).toHaveLength(1);
    advance(system, data, 3);
    // Woke on 3 with its bornRound pushed to 3, so it lives through 4 and goes on 5.
    expect(data.effects).toHaveLength(1);
    advance(system, data, 4);
    expect(data.effects).toHaveLength(1);
    advance(system, data, 5);
    expect(data.effects).toHaveLength(0);
  });
});
