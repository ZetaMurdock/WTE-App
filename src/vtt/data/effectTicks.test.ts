import { describe, expect, it } from "vitest";
import {
  cadenceExtraSaves,
  cadenceGate,
  declaredAuraOwner,
  declaredPlacement,
  hasCadence,
  recurringTicks,
  zoneAttachOf,
  zoneExtraStatuses,
  zoneStatusOf,
} from "./effectTicks";
import { parseAbilityEffects } from "../../game/abilityEffects";

function steps(block: string) {
  const parsed = parseAbilityEffects(block);
  expect(parsed.errors).toEqual([]);
  return parsed.steps;
}

// NOT what ships. `src/game/data/ciphers.json` gives S1 — ABSOLUTE ZERO a
// once-only block ("- Save: Physical Save — Recovery, DV 18 / - Fail: Damage:
// 3d10 Cold / - Fail: Ruling: ... the Save repeats each round the field is
// sustained, up to 3 rounds"): the repetition is PROSE inside a Ruling, put to
// the Curator as a question, and no page in the corpus declares a `Zone:` or an
// `Each round:` line at all. This fixture is what a table would write if it
// forked that page into the cadence grammar, and it is labelled as a fork so
// nobody reads a test constant as a statement about the shipped setting.
const FORKED_ABSOLUTE_ZERO = `
## Actions
- Cost: 80 SS
- Zone: circle 30 ft, attach point, 2 rounds
- Each round: Save: Physical Save — Recovery, DV 18
- Each round: Fail: Damage: 3d10 Cold
- In zone: Condition: Slowed, 1 round
`;

describe("recurringTicks", () => {
  it("flattens a declared cadence into the gate and what it costs", () => {
    const ticks = recurringTicks(steps(FORKED_ABSOLUTE_ZERO));
    expect(ticks).toHaveLength(2);
    expect(ticks[0]).toMatchObject({ kind: "save", on: "always", dv: 18, path: "recovery", direction: "save" });
    expect(ticks[1]).toMatchObject({ kind: "damage", on: "fail", expr: "3d10", damageType: "Cold" });
    expect(cadenceGate(ticks)).toBe(ticks[0]);
  });

  it("leaves the once-only steps and the in-zone state out of it", () => {
    const ticks = recurringTicks(steps(FORKED_ABSOLUTE_ZERO));
    // The Cost fires once and the Zone IS the template. `In zone:` is a state
    // the SimulationSystem already grants and revokes by standing-in-it, so
    // re-firing it every round would be a second answer to a settled question.
    expect(ticks.map((t) => t.kind)).toEqual(["save", "damage"]);
  });

  it("carries the survivable residue and nothing structural", () => {
    const [gate] = recurringTicks(steps(FORKED_ABSOLUTE_ZERO));
    // A tick rides a scene snapshot to every peer. Anything that is not JSON —
    // a parsed roll ref, a typed duration — must not have come along.
    expect(JSON.parse(JSON.stringify(gate))).toEqual(gate);
  });

  it("drops a per-round price the CASTER pays", () => {
    const ticks = recurringTicks(
      steps(`
## Actions
- Each round: Cost (self): 6 SS
- Each round: Damage: 2d6 Cold
`)
    );
    // The card speaks for whoever is standing in the field. Charging them the
    // Scientist's upkeep would bill the victim for being frozen.
    expect(ticks.map((t) => t.kind)).toEqual(["damage"]);
  });

  it("leaves a keyed DV without a number rather than inventing one", () => {
    const ticks = recurringTicks(
      steps(`
## Actions
- Each round: Save: Physical Save — Recovery, DV keyed
`)
    );
    // A placed template has no attacker in scope to key against, so the verdict
    // stays the Curator's to declare — which is what a deferred DV always meant.
    expect(ticks[0].kind).toBe("save");
    expect(ticks[0].dv).toBeUndefined();
  });

  it("skips min and tie, which arm nothing anywhere else either", () => {
    const ticks = recurringTicks(
      steps(`
## Actions
- Each round: Min: Damage: 4d6 Cold
- Each round: Tie: Damage: 2d6 Cold
`)
    );
    expect(ticks).toEqual([]);
  });

  it("keeps a recurring condition with the clock the page declared", () => {
    const ticks = recurringTicks(
      steps(`
## Actions
- Each round: Fail: Condition: Slowed, 2 rounds
`)
    );
    expect(ticks[0]).toMatchObject({ kind: "condition", on: "fail", condition: "Slowed", rounds: 2 });
  });

  it("reports the recurring saves it cannot resolve instead of dropping them", () => {
    const ticks = recurringTicks(
      steps(`
## Actions
- Each round: Save: Physical Save — Recovery, DV 18
- Each round: Save: Mental Save — Perception, DV 15
`)
    );
    expect(cadenceGate(ticks)?.dv).toBe(18);
    // A page that declared two of them is asking for two resolutions, and the
    // card resolves one. A caller that cannot say so lets the page quietly do
    // less than it promised.
    expect(cadenceExtraSaves(ticks).map((t) => t.dv)).toEqual([15]);
  });
});

describe("hasCadence", () => {
  it("is false for the whole once-only corpus", () => {
    expect(
      hasCadence(
        steps(`
## Actions
- Save: Physical Save — Recovery, DV 18
- Fail: Damage: 3d10 Cold
`)
      )
    ).toBe(false);
    expect(hasCadence(steps(FORKED_ABSOLUTE_ZERO))).toBe(true);
  });

  it("is false for an in-zone-only block, which needs no round hook", () => {
    expect(
      hasCadence(
        steps(`
## Actions
- Zone: circle 15 ft, attach self, scene
- In zone: Condition: Slowed, 1 round
`)
      )
    ).toBe(false);
  });
});

describe("the declared anchor", () => {
  it("reads `attach self` as the aura it is", () => {
    expect(
      zoneAttachOf(
        steps(`
## Actions
- Zone: circle 15 ft, attach self, scene
`)
      )
    ).toBe("self");
  });

  it("defaults to the ground for a page that named no anchor", () => {
    // A page that did not say put a thing on the floor, not on a body. Guessing
    // `self` would staple every declared template to whoever cast it.
    expect(zoneAttachOf(steps(`
## Actions
- Zone: circle 30 ft, 2 rounds
`))).toBe("point");
    expect(zoneAttachOf(steps(FORKED_ABSOLUTE_ZERO))).toBe("point");
    // And an ability with no zone at all anchors nothing.
    expect(zoneAttachOf([])).toBe("point");
  });
});

describe("the in-zone status", () => {
  it("is the tag the SimulationSystem grants for standing inside", () => {
    expect(zoneStatusOf(steps(FORKED_ABSOLUTE_ZERO))).toBe("Slowed");
    expect(zoneExtraStatuses(steps(FORKED_ABSOLUTE_ZERO))).toEqual([]);
  });

  it("reports the in-zone conditions one template cannot carry", () => {
    const declared = steps(`
## Actions
- Zone: circle 15 ft, attach self, scene
- In zone: Condition: Slowed, 1 round
- In zone: Condition: Blinded, 1 round
`);
    // `VttEffectData.status` is one field, so the second needs a second
    // template. A caller that cannot say so lets the page promise more than the
    // map delivers.
    expect(zoneStatusOf(declared)).toBe("Slowed");
    expect(zoneExtraStatuses(declared)).toEqual(["Blinded"]);
  });

  it("is null for a page that declared no in-zone state", () => {
    expect(zoneStatusOf(steps(`
## Actions
- Zone: circle 30 ft, 2 rounds
`))).toBeNull();
  });
});

// One derivation for every way a template can reach the map. The prompt's
// self/selected/centre modes drop it at once; its "click" mode arms the cursor
// and lands it on a later pointer event, from React state with no ability in
// scope. That second path used to read the page not at all, so a declared field
// aimed by clicking came down with no cadence, no in-zone tag and no provenance
// — inert, and silently so.
describe("declaredPlacement", () => {
  it("reads one page into everything a placement needs", () => {
    const placement = declaredPlacement(FORKED_ABSOLUTE_ZERO);
    expect(placement.status).toBe("Slowed");
    expect(placement.ticks.map((tick) => tick.kind)).toEqual(["save", "damage"]);
    expect(placement.attach).toBe("point");
    expect(placement.extraStatuses).toEqual([]);
    expect(placement.extraSaves).toEqual([]);
  });

  it("is empty for an ability that declared nothing, which is the whole shipped corpus", () => {
    // The governing invariant of this slice: an undeclared ability places
    // exactly as it did before any of it existed.
    for (const actions of [null, undefined, ""]) {
      expect(declaredPlacement(actions)).toEqual({
        status: null,
        ticks: [],
        attach: "point",
        extraStatuses: [],
        extraSaves: [],
      });
    }
  });

  it("hands back what one template cannot carry instead of dropping it", () => {
    const placement = declaredPlacement(`
## Actions
- Zone: circle 15 ft, attach self, scene
- In zone: Condition: Slowed, 1 round
- In zone: Condition: Blinded, 1 round
- Each round: Save: Physical Save — Recovery, DV 18
- Each round: Save: Mental Save — Perception, DV 15
`);
    expect(placement.status).toBe("Slowed");
    expect(placement.extraStatuses).toEqual(["Blinded"]);
    expect(placement.extraSaves.map((tick) => tick.dv)).toEqual([15]);
  });
});

describe("declaredAuraOwner", () => {
  const aura = () => declaredPlacement(`
## Actions
- Zone: circle 15 ft, attach self, scene
`);

  it("binds `attach self` to the CASTER, never to whatever was selected", () => {
    // The anchor the Curator aims at and the body an aura rides are different
    // questions. Answering both with the selected token bound a caster's own
    // field to their target, which is the token most likely to be selected when
    // an area ability goes off.
    expect(declaredAuraOwner(aura(), "caster-token")).toBe("caster-token");
  });

  it("binds nothing when the caster has no token on this scene", () => {
    // Nothing to ride. Stapling the field to a stand-in would be worse than
    // leaving it where it landed.
    expect(declaredAuraOwner(aura(), null)).toBeNull();
  });

  it("binds nothing for a page that put its zone on the ground", () => {
    expect(declaredAuraOwner(declaredPlacement(FORKED_ABSOLUTE_ZERO), "caster-token")).toBeNull();
    expect(declaredAuraOwner(declaredPlacement(null), "caster-token")).toBeNull();
  });
});
