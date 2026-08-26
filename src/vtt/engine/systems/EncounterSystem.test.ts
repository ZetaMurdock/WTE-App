import { afterEach, describe, expect, it } from "vitest";
import { EncounterSystem } from "./EncounterSystem";
import { TimelineSystem } from "./TimelineSystem";
import { SimulationSystem } from "./SimulationSystem";
import { ConditionClockSystem } from "./ConditionClockSystem";
import { setCodexConditions, type CodexCondition } from "../../../game/conditions";
import { defaultSceneData, type VttSceneData } from "../../types/scene";

const SLOWED: CodexCondition = {
  id: "wte.condition.slowed",
  scope: "wte",
  name: "Slowed",
  aliases: [],
  effect: "The target is slowed to a crawl.",
  stacking: "refresh",
};

function encounter(): { system: EncounterSystem; data: VttSceneData; written: string[][] } {
  const data = defaultSceneData();
  data.tokens = [{ id: "t1", name: "Kira", x: 35, y: 35, size: 1, color: "#fff", visible: true }];
  const written: string[][] = [];
  const system = new EncounterSystem(new TimelineSystem(), new SimulationSystem(), new ConditionClockSystem());
  return { system, data, written };
}

/** Stands in for adjudicateTokenVitals: commits, and reports that it did. */
function write(data: VttSceneData, written: string[][]) {
  return (tokenId: string, statuses: string[]): boolean => {
    const token = data.tokens.find((t) => t.id === tokenId);
    if (!token) return false;
    token.statuses = statuses;
    written.push(statuses);
    return true;
  };
}

afterEach(() => {
  setCodexConditions([]);
});

describe("EncounterSystem.onRound", () => {
  it("runs timed effects and condition clocks out on the same tick", () => {
    setCodexConditions([SLOWED]);
    const { system, data, written } = encounter();
    data.effects = [{ id: "e1", kind: "circle", x: 0, y: 0, data: { radius: 3, rounds: 2, bornRound: 1 } }];
    data.tokens[0].statuses = ["Slowed (2)"];
    data.conditionClocks = [{ tokenId: "t1", status: "Slowed (2)", bornRound: 1, rounds: 2 }];

    expect(system.onRound(data, 2, 70, write(data, written))).toBe(false);
    expect(data.effects).toHaveLength(1);
    expect(data.tokens[0].statuses).toEqual(["Slowed (2)"]);

    expect(system.onRound(data, 3, 70, write(data, written))).toBe(true);
    expect(data.effects).toEqual([]);
    expect(data.tokens[0].statuses).toEqual([]);
    expect(data.conditionClocks).toBeUndefined();
  });

  it("lets a zone put back the status a clock just took off", () => {
    setCodexConditions([SLOWED]);
    const { system, data, written } = encounter();
    // The token is standing in the zone that applies Slowed, so the tag is the
    // zone's truth this round — the clock only ends the ABILITY's application.
    data.effects = [{ id: "z1", kind: "zone", x: 0, y: 0, data: { w: 4, h: 4, status: "Slowed" } }];
    data.tokens[0].statuses = ["Slowed"];
    data.conditionClocks = [{ tokenId: "t1", status: "Slowed", bornRound: 1, rounds: 1 }];

    expect(system.onRound(data, 2, 70, write(data, written))).toBe(true);
    expect(written).toEqual([[]]); // the removal was committed through the writer
    expect(data.tokens[0].statuses).toEqual(["Slowed"]); // and the zone re-applied it
    // No clock survives: the tag on the token now belongs to the zone.
    expect(data.conditionClocks).toBeUndefined();
  });

  it("prunes a clock whose token left the scene, without writing to it", () => {
    setCodexConditions([SLOWED]);
    const { system, data, written } = encounter();
    data.conditionClocks = [{ tokenId: "ghost", status: "Slowed", bornRound: 1, rounds: 9 }];

    expect(system.onRound(data, 2, 70, write(data, written))).toBe(true);
    expect(written).toEqual([]);
    expect(data.conditionClocks).toBeUndefined();
  });

  it("reports a change on a round where only a condition ran out", () => {
    setCodexConditions([SLOWED]);
    const { system, data, written } = encounter();
    // No timed effect, no zone, nothing to prune afterwards: the expiry is the
    // only thing that happened, so it alone has to be worth a redraw.
    data.tokens[0].statuses = ["Slowed (1)"];
    data.conditionClocks = [{ tokenId: "t1", status: "Slowed (1)", bornRound: 1, rounds: 1 }];

    expect(system.onRound(data, 2, 70, write(data, written))).toBe(true);
    expect(data.tokens[0].statuses).toEqual([]);
  });

  it("reports no change on a quiet round", () => {
    const { system, data, written } = encounter();

    expect(system.onRound(data, 4, 70, write(data, written))).toBe(false);
    expect(written).toEqual([]);
    expect("conditionClocks" in data).toBe(false);
  });
});
