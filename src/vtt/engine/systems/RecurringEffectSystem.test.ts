import { describe, expect, it } from "vitest";
import { MAX_ROUND_PROPOSALS, RecurringEffectSystem } from "./RecurringEffectSystem";
import { EncounterSystem } from "./EncounterSystem";
import { TimelineSystem } from "./TimelineSystem";
import { SimulationSystem } from "./SimulationSystem";
import { ConditionClockSystem } from "./ConditionClockSystem";
import { defaultSceneData, type VttEffectTick, type VttSceneData } from "../../types/scene";

const GRID = 70;

/** A forked Absolute Zero's cadence, as `recurringTicks` flattens it. The
 *  shipped page declares no `Each round:` line — see effectTicks.test.ts — so
 *  this is the grammar under test, not a claim about the corpus. */
const TICKS: VttEffectTick[] = [
  { id: "tick-1", kind: "save", label: "Physical Save — Recovery, DV 18", on: "always", dv: 18, path: "recovery", direction: "save" },
  { id: "tick-2", kind: "damage", label: "3d10 Cold", on: "fail", expr: "3d10", damageType: "Cold" },
];

function field(bornRound: number, rounds = 0): VttSceneData {
  const data = defaultSceneData();
  data.tokens = [{ id: "kira", name: "Kira", x: 100, y: 100, size: 1, color: "#fff", visible: true }];
  data.effects = [
    {
      id: "freeze",
      kind: "circle",
      x: 100,
      y: 100,
      data: { radius: 3, bornRound, rounds, ticks: TICKS, sourceAbilityName: "Absolute Zero" },
    },
  ];
  return data;
}

describe("RecurringEffectSystem.propose", () => {
  it("does not fire on the round the field was placed", () => {
    const data = field(3);
    // The round hook runs on a round CHANGE, so by the time it could see round 3
    // that round is over — billing for it charges a round that ended before the
    // fire existed.
    expect(new RecurringEffectSystem().propose(data, 3, GRID)).toEqual([]);
  });

  it("fires on the round after, naming the ability that caused it", () => {
    const data = field(3);
    const proposals = new RecurringEffectSystem().propose(data, 4, GRID);
    expect(proposals).toHaveLength(1);
    expect(proposals[0]).toMatchObject({
      effectId: "freeze",
      tokenId: "kira",
      tokenName: "Kira",
      round: 4,
      sourceAbilityName: "Absolute Zero",
    });
    expect(proposals[0].gate).toMatchObject({ kind: "save", dv: 18 });
    expect(proposals[0].ticks).toEqual(TICKS);
  });

  it("never fires twice for the same round number", () => {
    const data = field(3);
    const system = new RecurringEffectSystem();
    expect(system.propose(data, 4, GRID)).toHaveLength(1);
    // A re-render, a peer echo, or a Curator stepping the round back and forward
    // is not a second round of standing in the fire.
    expect(system.propose(data, 4, GRID)).toEqual([]);
    expect(data.effects[0].data.tickedRound).toBe(4);
  });

  it("carries the guard in the scene, so a reload cannot be charged twice", () => {
    const data = field(3);
    new RecurringEffectSystem().propose(data, 4, GRID);
    const reloaded: VttSceneData = JSON.parse(JSON.stringify(data));
    // A different system instance, exactly as a fresh mount would be.
    expect(new RecurringEffectSystem().propose(reloaded, 4, GRID)).toEqual([]);
  });

  it("stops for a token that walked out and starts for one that walked in", () => {
    const data = field(3);
    const system = new RecurringEffectSystem();
    expect(system.propose(data, 4, GRID)).toHaveLength(1);

    data.tokens[0].x = 2_000;
    expect(system.propose(data, 5, GRID)).toEqual([]);

    data.tokens[0].x = 100;
    expect(system.propose(data, 6, GRID)).toHaveLength(1);
  });

  it("proposes for everyone standing in it, in scene order", () => {
    const data = field(3);
    data.tokens.push({ id: "vaun", name: "Vaun", x: 140, y: 100, size: 1, color: "#fff", visible: true });
    const proposals = new RecurringEffectSystem().propose(data, 4, GRID);
    expect(proposals.map((p) => p.tokenId)).toEqual(["kira", "vaun"]);
  });

  it("leaves props out — a crate does not make a Physical Save", () => {
    const data = field(3);
    data.tokens.push({ id: "crate", name: "Crate", x: 100, y: 120, size: 1, color: "#fff", visible: true, prop: true });
    const proposals = new RecurringEffectSystem().propose(data, 4, GRID);
    expect(proposals.map((p) => p.tokenId)).toEqual(["kira"]);
  });

  it("still burns a token the Curator has hidden", () => {
    const data = field(3);
    data.tokens[0].visible = false;
    expect(new RecurringEffectSystem().propose(data, 4, GRID)).toHaveLength(1);
  });

  it("ignores effects that declared no cadence at all", () => {
    const data = field(3);
    delete data.effects[0].data.ticks;
    expect(new RecurringEffectSystem().propose(data, 4, GRID)).toEqual([]);
    // And leaves no bookkeeping behind on an effect it had no business touching.
    expect(data.effects[0].data.tickedRound).toBeUndefined();
  });

  it("caps one round's proposals rather than burying the Curator", () => {
    const data = field(3);
    data.tokens = Array.from({ length: MAX_ROUND_PROPOSALS + 25 }, (_, i) => ({
      id: `t${i}`,
      name: `T${i}`,
      x: 100,
      y: 100,
      size: 1,
      color: "#fff",
      visible: true,
    }));
    expect(new RecurringEffectSystem().propose(data, 4, GRID)).toHaveLength(MAX_ROUND_PROPOSALS);
  });
});

function encounter(): EncounterSystem {
  return new EncounterSystem(
    new TimelineSystem(),
    new SimulationSystem(),
    new ConditionClockSystem(),
    new RecurringEffectSystem()
  );
}

const NO_WRITE = () => true;

describe("the round boundary through EncounterSystem", () => {
  it("burns for exactly the rounds the page declared", () => {
    // Placed on round 3, declared to last 2 rounds.
    const data = field(3, 2);
    const system = encounter();
    const fired: number[] = [];
    const sink = (proposals: { round: number }[]) => fired.push(...proposals.map((p) => p.round));

    system.onRound(data, 3, GRID, NO_WRITE, sink); // the round it was placed on
    system.onRound(data, 4, GRID, NO_WRITE, sink);
    system.onRound(data, 5, GRID, NO_WRITE, sink);
    system.onRound(data, 6, GRID, NO_WRITE, sink);

    // Two rounds declared, two rounds burned — not one, which is what a pass
    // running AFTER TimelineSystem.expire would have produced, because expiry
    // removes the effect at bornRound + rounds and would eat the last tick.
    expect(fired).toEqual([4, 5]);
    expect(data.effects).toEqual([]);
  });

  it("reports the round as changed only when the tick actually landed on someone", () => {
    const data = field(3, 5);
    const system = encounter();
    expect(system.onRound(data, 4, GRID, NO_WRITE, () => {})).toBe(true);

    data.tokens[0].x = 2_000;
    // A `tickedRound` stamp on an effect nobody was standing in is bookkeeping
    // no reader can see; spending a redraw and a scene write on it is waste.
    expect(system.onRound(data, 5, GRID, NO_WRITE, () => {})).toBe(false);
  });

  it("ticks an aura from where its owner is NOW, not where it was placed", () => {
    const data = field(3, 5);
    data.effects[0].data.auraTokenId = "kira";
    data.effects[0].data.auraDx = 0;
    data.effects[0].data.auraDy = 0;
    data.tokens.push({ id: "vaun", name: "Vaun", x: 2_000, y: 2_000, size: 1, color: "#fff", visible: true });

    // The caster walks across the map to stand beside Vaun. A field left at its
    // placement square would burn nobody and Vaun would be untouched.
    data.tokens[0].x = 2_000;
    data.tokens[0].y = 2_000;

    const fired: string[] = [];
    encounter().onRound(data, 4, GRID, NO_WRITE, (proposals) => fired.push(...proposals.map((p) => p.tokenId)));
    expect(fired).toEqual(["kira", "vaun"]);
  });

  it("takes an aura off the map when its owner leaves, and stops it ticking", () => {
    const data = field(3, 5);
    data.effects[0].data.auraTokenId = "kira";
    data.tokens = [];
    const fired: unknown[] = [];
    encounter().onRound(data, 4, GRID, NO_WRITE, (proposals) => fired.push(...proposals));
    expect(data.effects).toEqual([]);
    expect(fired).toEqual([]);
  });
});
