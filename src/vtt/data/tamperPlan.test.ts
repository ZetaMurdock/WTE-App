import { describe, it, expect } from "vitest";
import { pageTampers, planTamper, tamperRulingCard } from "./tamperPlan";
import { listTamperTargets, type TamperTarget } from "./tamperTargets";
import { defaultSceneData, type VttEffect, type VttSceneData, type VttToken } from "../types/scene";

const SIZE = 70;

const tok = (id: string, name: string, x = 0, y = 0, statuses?: string[]): VttToken => ({
  id,
  name,
  x,
  y,
  size: 1,
  color: "#fff",
  visible: true,
  ...(statuses ? { statuses } : {}),
});

const field = (id: string, name: string, extra: Partial<VttEffect["data"]> = {}, x = 0, y = 0): VttEffect => ({
  id,
  kind: "circle",
  x,
  y,
  data: { radius: 3, sourceAbilityId: `ab-${id}`, sourceAbilityName: name, ...extra },
});

function scene(round = 4): VttSceneData {
  const data = defaultSceneData();
  data.grid = { ...data.grid, size: SIZE };
  data.timeline = { round, turn: 0 };
  return data;
}

function rowFor(data: VttSceneData, match: (target: TamperTarget) => boolean): TamperTarget {
  const found = listTamperTargets(data).find(match);
  if (!found) throw new Error("no such tamperable row");
  return found;
}

describe("declaredTampers", () => {
  it("reads the page's bullets, and drops the branches no phase executes", () => {
    const block = [
      "## Actions",
      "- Tamper: negate",
      "- Tamper: delay, 2 rounds",
      "- Min: Tamper: end",
      "- At 8: Tamper: reflect",
    ].join("\n");
    expect(pageTampers(block)).toEqual([
      { id: "tm-0", mode: "negate", on: "always" },
      { id: "tm-1", mode: "delay", rounds: 2, on: "always" },
    ]);
    expect(pageTampers(null)).toEqual([]);
  });
});

describe("end — the cascade", () => {
  /** A field over two bodies, each carrying its pip, each with a countdown
   *  watching that pip, and one of them also carrying a currency. */
  function burning(): VttSceneData {
    const data = scene(4);
    data.tokens = [tok("k", "Kira", 0, 0, ["Burning", "Blight 3/8"]), tok("v", "Vex", 70, 0, ["Burning"])];
    data.effects = [field("fx1", "Absolute Zero", { status: "Burning", rounds: 6, bornRound: 1 })];
    data.conditionClocks = [
      { tokenId: "k", status: "Burning", bornRound: 2, rounds: 6 },
      { tokenId: "v", status: "Burning", bornRound: 2, rounds: 6 },
    ];
    data.counterTracks = [{ tokenId: "k", name: "Blight", value: 3, cap: 8 }];
    return data;
  }

  it("takes the template, the pips it granted and the clocks watching them", () => {
    const data = burning();
    const plan = planTamper({ data, target: rowFor(data, (t) => t.kind === "effect"), mode: "negate" });

    expect(plan.verdict).toBe("commit");
    expect(plan.write?.removeEffects).toEqual(["fx1"]);
    // Both bodies lose the pip; each keeps everything else it was carrying.
    expect(plan.write?.statuses).toEqual([
      { tokenId: "k", tokenName: "Kira", statuses: ["Blight 3/8"] },
      { tokenId: "v", tokenName: "Vex", statuses: [] },
    ]);
    // The countdowns had nothing left to count. Leaving them would make the next
    // application of Burning stack against a ghost.
    expect(plan.write?.clockTokens.sort()).toEqual(["k", "v"]);
    expect(plan.write?.clocks).toEqual([]);
  });

  it("leaves counter tracks alone AND says so — the gap nothing records", () => {
    const data = burning();
    const plan = planTamper({ data, target: rowFor(data, (t) => t.kind === "effect"), mode: "negate" });
    // Nothing anywhere records which ability moved a track, so a cascade that
    // deleted this would be deleting a currency the table may have earned
    // somewhere else entirely.
    expect(plan.write?.tracks).toEqual([]);
    expect(plan.write?.trackTokens).toEqual([]);
    expect(plan.caveats.join(" ")).toContain("Kira's Blight 3/8");
    expect(plan.caveats.join(" ")).toContain("counter track");
  });

  it("leaves a pip that another field still grants", () => {
    const data = burning();
    // A second fire over Vex only. Ending the first must not un-burn her: the
    // survivor's occupancy decides, exactly as the round pass would have decided.
    // Tight enough to hold Vex's square and nothing else: a 0.4-cell radius is
    // 28px, and Kira's nearest sampled point is 49px away.
    data.effects.push(field("fx2", "Hail Rain", { status: "Burning", radius: 0.4 }, 70, 0));
    const plan = planTamper({ data, target: rowFor(data, (t) => t.effectId === "fx1"), mode: "end" });
    expect(plan.write?.statuses.map((entry) => entry.tokenId)).toEqual(["k"]);
    expect(plan.write?.clockTokens).toEqual(["k"]);
    expect(plan.caveats.join(" ")).toContain("1 other body keeps Burning");
  });

  it("reports the summoned bodies it deliberately does not touch", () => {
    const data = burning();
    data.tokens.push({
      ...tok("m1", "Lesser Stygian", 140, 0),
      meta: {
        summon: { batchId: "b1", name: "Lesser Stygian", sourceAbilityId: "ab-fx1", sourceAbilityName: "Absolute Zero" },
      },
    });
    const plan = planTamper({ data, target: rowFor(data, (t) => t.effectId === "fx1"), mode: "negate" });
    // The corpus says minions persist until dismissed, slain or separated, so a
    // negate must not sweep them up — but the Curator has to be told they stayed.
    expect(plan.write?.removeEffects).toEqual(["fx1"]);
    expect(plan.caveats.join(" ")).toContain("summoned by Absolute Zero");
  });

  it("refuses a field that expired on the round tick while the prompt was open", () => {
    const data = burning();
    const target = rowFor(data, (t) => t.kind === "effect");
    // The commonest race there is: the round advanced and the timeline system
    // removed the very effect the Curator is looking at a row for.
    data.effects = [];
    const plan = planTamper({ data, target, mode: "negate" });
    expect(plan.verdict).toBe("refused");
    expect(plan.refusal).toContain("no longer on this scene");
    expect(plan.write).toBeNull();
  });

  it("refuses the second negate of the same field rather than writing again", () => {
    const data = burning();
    const target = rowFor(data, (t) => t.kind === "effect");
    const first = planTamper({ data, target, mode: "negate" });
    expect(first.verdict).toBe("commit");
    // Commit it by hand, the way the engine would.
    data.effects = [];
    for (const entry of first.write?.statuses ?? []) {
      const token = data.tokens.find((candidate) => candidate.id === entry.tokenId);
      if (token) token.statuses = entry.statuses;
    }
    data.conditionClocks = first.write?.clocks ?? [];
    expect(planTamper({ data, target, mode: "negate" }).verdict).toBe("refused");
  });
});

describe("end — the dispel path", () => {
  it("clears one occurrence of a condition, and its countdown with it", () => {
    const data = scene(4);
    data.tokens = [tok("k", "Kira", 0, 0, ["Burning", "Burning", "Slowed"])];
    data.conditionClocks = [
      { tokenId: "k", status: "Burning", bornRound: 2, rounds: 6 },
      { tokenId: "k", status: "Burning", bornRound: 3, rounds: 6 },
      { tokenId: "k", status: "Slowed", bornRound: 2, rounds: 6 },
    ];
    const plan = planTamper({ data, target: rowFor(data, (t) => t.kind === "clock"), mode: "end" });
    // ONE, not both: a `stack` condition keeps its instances apart, and a
    // cleanse that took every one would be a larger act than the row offered.
    expect(plan.write?.statuses[0].statuses).toEqual(["Burning", "Slowed"]);
    expect(plan.write?.clocks).toHaveLength(2);
  });

  it("warns that a cleanse inside the field that granted it will not hold", () => {
    const data = scene(4);
    data.tokens = [tok("k", "Kira", 0, 0, ["Burning"])];
    data.effects = [field("fx1", "Absolute Zero", { status: "Burning" })];
    data.conditionClocks = [{ tokenId: "k", status: "Burning", bornRound: 2, rounds: 6 }];
    const plan = planTamper({ data, target: rowFor(data, (t) => t.kind === "clock"), mode: "end" });
    expect(plan.verdict).toBe("commit");
    // Said before the click. A status you are standing inside of is the zone's
    // to own, so the round pass puts it straight back.
    expect(plan.caveats.join(" ")).toContain("comes back on the next round");
  });

  it("wipes a counter track pip and record together", () => {
    const data = scene(4);
    data.tokens = [tok("v", "Vex", 0, 0, ["Blight 3/8", "Slowed"])];
    data.counterTracks = [{ tokenId: "v", name: "Blight", value: 3, cap: 8 }];
    const plan = planTamper({ data, target: rowFor(data, (t) => t.kind === "counter"), mode: "negate" });
    expect(plan.write?.statuses[0].statuses).toEqual(["Slowed"]);
    expect(plan.write?.trackTokens).toEqual(["v"]);
    expect(plan.write?.tracks).toEqual([]);
  });
});

describe("reflect", () => {
  it("turns an aura back onto the body that raised it", () => {
    const data = scene(4);
    data.tokens = [tok("k", "Kira", 0, 0), tok("n", "Null", 350, 210)];
    data.effects = [
      field("fx1", "Absolute Zero", { status: "Frozen", auraTokenId: "k", auraDx: 0, auraDy: 0, casterCharacterId: "ch-null" }),
    ];
    const plan = planTamper({
      data,
      target: rowFor(data, (t) => t.kind === "effect"),
      mode: "reflect",
      sourceTokenId: "n",
      sourceName: "Null",
    });
    const moved = plan.write?.putEffects[0];
    expect(moved?.x).toBe(350);
    expect(moved?.y).toBe(210);
    // An aura stays an aura: reflecting changes who it stands on, not what it is.
    expect(moved?.data.auraTokenId).toBe("n");
    expect(moved?.data.status).toBe("Frozen");
    expect(plan.write?.removeEffects).toEqual([]);
  });

  it("centres a rect zone's body on the source rather than its corner", () => {
    const data = scene(4);
    data.tokens = [tok("n", "Null", 350, 210)];
    data.effects = [
      { id: "fx1", kind: "zone", x: 0, y: 0, data: { w: 4, h: 2, sourceAbilityName: "Null Zone", casterCharacterId: "ch-null" } },
    ];
    const plan = planTamper({
      data,
      target: rowFor(data, (t) => t.kind === "effect"),
      mode: "reflect",
      sourceTokenId: "n",
    });
    // A zone anchors top-LEFT, which `addEffectAt` already states. Centring it
    // the way a circle centres would drop the field down and right of the body.
    expect(plan.write?.putEffects[0].x).toBe(350 - (4 * SIZE) / 2);
    expect(plan.write?.putEffects[0].y).toBe(210 - (2 * SIZE) / 2);
  });

  it("refuses, by name, when the caster has left the scene", () => {
    const data = scene(4);
    data.tokens = [tok("k", "Kira", 0, 0)];
    data.effects = [field("fx1", "Absolute Zero", { casterCharacterId: "ch-null" })];
    const plan = planTamper({
      data,
      target: rowFor(data, (t) => t.kind === "effect"),
      mode: "reflect",
      // The caller looked for a token and found none.
      sourceTokenId: undefined,
      sourceName: "Null",
    });
    expect(plan.verdict).toBe("refused");
    expect(plan.refusal).toContain("Null");
    expect(plan.refusal).toContain("no token on this scene");
    expect(plan.write).toBeNull();
  });

  it("refuses an effect that was placed with no caster recorded", () => {
    const data = scene(4);
    data.effects = [field("fx1", "Absolute Zero")];
    const plan = planTamper({ data, target: rowFor(data, (t) => t.kind === "effect"), mode: "reflect" });
    expect(plan.verdict).toBe("refused");
    expect(plan.refusal).toContain("no caster recorded");
  });

  it("refuses a condition and a track, because neither records who applied it", () => {
    const data = scene(4);
    data.tokens = [tok("k", "Kira", 0, 0, ["Slowed", "Blight 1"])];
    data.conditionClocks = [{ tokenId: "k", status: "Slowed", bornRound: 2, rounds: 6 }];
    data.counterTracks = [{ tokenId: "k", name: "Blight", value: 1 }];
    for (const kind of ["clock", "counter"] as const) {
      const plan = planTamper({ data, target: rowFor(data, (t) => t.kind === kind), mode: "reflect" });
      expect(plan.verdict).toBe("refused");
      expect(plan.refusal).toContain("no source to turn it back on");
    }
  });
});

describe("delay", () => {
  it("suspends a field and takes its pip back for the duration", () => {
    const data = scene(4);
    data.tokens = [tok("k", "Kira", 0, 0, ["Burning"])];
    data.effects = [field("fx1", "Absolute Zero", { status: "Burning", rounds: 6, bornRound: 1 })];
    const plan = planTamper({ data, target: rowFor(data, (t) => t.kind === "effect"), mode: "delay", rounds: 2 });
    const asleep = plan.write?.putEffects[0];
    expect(asleep?.data.suspendedAt).toBe(4);
    expect(asleep?.data.suspendedUntil).toBe(6);
    // Now, not on the next round tick: a Curator who delayed a fire and watched
    // everyone in it stay Burning would conclude the verb did nothing.
    expect(plan.write?.statuses).toEqual([{ tokenId: "k", tokenName: "Kira", statuses: [] }]);
  });

  it("extends an existing sleep from where it started, never from now", () => {
    const data = scene(4);
    data.effects = [field("fx1", "Absolute Zero", { suspendedAt: 2, suspendedUntil: 5 })];
    const plan = planTamper({ data, target: rowFor(data, (t) => t.kind === "effect"), mode: "delay", rounds: 2 });
    // Resetting `suspendedAt` to 4 would hand back only the rounds since the
    // second delay, quietly shortening the field by the length of the first.
    expect(plan.write?.putEffects[0].data.suspendedAt).toBe(2);
    expect(plan.write?.putEffects[0].data.suspendedUntil).toBe(7);
  });

  it("pauses a condition by moving its start, which is the only way a clock holds still", () => {
    const data = scene(4);
    data.tokens = [tok("k", "Kira", 0, 0, ["Slowed"])];
    data.conditionClocks = [{ tokenId: "k", status: "Slowed", bornRound: 2, rounds: 4 }];
    const plan = planTamper({ data, target: rowFor(data, (t) => t.kind === "clock"), mode: "delay", rounds: 2 });
    expect(plan.write?.clocks).toEqual([{ tokenId: "k", status: "Slowed", bornRound: 4, rounds: 4 }]);
    // The pip itself does not move, so nothing on the map changes until the
    // round it would have run out on.
    expect(plan.write?.statuses).toEqual([]);
  });

  it("refuses a counter track, which nothing about a round advances", () => {
    const data = scene(4);
    data.tokens = [tok("v", "Vex", 0, 0, ["Blight 3/8"])];
    data.counterTracks = [{ tokenId: "v", name: "Blight", value: 3, cap: 8 }];
    const plan = planTamper({ data, target: rowFor(data, (t) => t.kind === "counter"), mode: "delay", rounds: 2 });
    expect(plan.verdict).toBe("refused");
    expect(plan.refusal).toContain("no clock to pause");
  });
});

describe("redirect and copy", () => {
  it("are rulings, with no writes at all", () => {
    const data = scene(4);
    data.effects = [field("fx1", "Absolute Zero", { casterCharacterId: "ch-null" })];
    const target = rowFor(data, (t) => t.kind === "effect");
    for (const mode of ["redirect", "copy"] as const) {
      const plan = planTamper({ data, target, mode });
      expect(plan.verdict).toBe("ruling");
      expect(plan.write).toBeNull();
      expect(plan.ruling).toContain("yours to rule");
    }
  });

  it("open an unrolled card carrying exactly one ruling row", () => {
    const data = scene(4);
    data.tokens = [tok("k", "Kira", 0, 0)];
    data.effects = [field("fx1", "Absolute Zero", { auraTokenId: "k", casterCharacterId: "ch-null" })];
    const proposal = planTamper({ data, target: rowFor(data, (t) => t.kind === "effect"), mode: "redirect" });
    const card = tamperRulingCard({
      proposal,
      sourceAbilityId: "ab-null",
      sourceAbilityName: "Reflect",
      now: 1000,
    });
    expect(card?.unrolled).toBe(true);
    expect(card?.consequences).toHaveLength(1);
    expect(card?.consequences[0].kind).toBe("ruling");
    expect(card?.targets[0].tokenId).toBe("k");
  });

  it("builds no card for a mode that is not a ruling", () => {
    const data = scene(4);
    data.effects = [field("fx1", "Absolute Zero")];
    const proposal = planTamper({ data, target: rowFor(data, (t) => t.kind === "effect"), mode: "negate" });
    expect(tamperRulingCard({ proposal, sourceAbilityId: "a", sourceAbilityName: "n", now: 0 })).toBeNull();
  });
});
