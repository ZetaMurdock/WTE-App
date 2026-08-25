import { describe, expect, it } from "vitest";
import { parseAbilityActions } from "./abilityActions";
import type { RollAxisStats } from "./rollAxis";
import { SAVE_DV_BASE, abilitySaveDv, pairedCheckPath, saveDvBreakdown, savePlainLabel } from "./saveDv";

// Capacity routes: WIS +1 / Mental Fortitude +0, NC derived +4 → best total +5.
// Power routes: STR +2 / Weapon Mastery +4, ATK derived +3 → best total +7.
const stats: RollAxisStats = {
  attr: { phy: 2, ap: 1, dex: 2, end: 0, wis: 1, int: 3, cha: -1 },
  spec: { wm: 4, pre: 3, bal: -2, adp: 1, mf: 0, per: 5, cun: -3 },
  derived: { atk: 3, ad: 2, ev: -3, rr: -1, nc: 4, pr: 1, inf: -2 },
};

const saveOf = (actions: ReturnType<typeof parseAbilityActions>) => {
  const save = actions.find((action) => action.kind === "save");
  expect(save).toBeDefined();
  return save!;
};

describe("pairedCheckPath", () => {
  it("uses the ability's own named check", () => {
    const actions = parseAbilityActions(
      "You make a Physical Check — Power. The target makes a Physical Save — Evasion (DV 13) or is knocked prone."
    );
    expect(pairedCheckPath(actions)).toEqual({ id: "power", fromAbility: true });
  });

  it("defaults to the Capacity casting check when prose names none", () => {
    const actions = parseAbilityActions("The target makes a Mental Save — Influence (DV 16) or is Frightened.");
    expect(pairedCheckPath(actions)).toEqual({ id: "capacity", fromAbility: false });
  });
});

describe("abilitySaveDv", () => {
  it("keys the DV to the ability's own check and keeps the printed DV as provenance", () => {
    const actions = parseAbilityActions(
      "You make a Physical Check — Power. The target makes a Physical Save — Evasion (DV 13) or is knocked prone."
    );
    const keyed = abilitySaveDv(saveOf(actions), actions, stats);
    expect(keyed).toMatchObject({
      dv: SAVE_DV_BASE + 7,
      checkPathId: "power",
      checkMod: 7,
      sourceLabel: "Weapon Mastery",
      fromAbility: true,
      printed: 13,
    });
  });

  it("keys prose without a named check to Capacity", () => {
    const actions = parseAbilityActions("The target makes a Mental Save — Influence (DV 16) or is Frightened.");
    const keyed = abilitySaveDv(saveOf(actions), actions, stats);
    expect(keyed).toMatchObject({ dv: SAVE_DV_BASE + 5, checkPathId: "capacity", fromAbility: false, printed: 16 });
  });

  it("takes the stronger route — the attribute side when the specialty is weaker", () => {
    const attrHeavy: RollAxisStats = {
      ...stats,
      // Capacity: WIS +6 beats Mental Fortitude −25 (untrained). NC +4 → +10.
      attr: { ...stats.attr, wis: 6 },
      spec: { ...stats.spec, mf: -25 },
    };
    const actions = parseAbilityActions("The target makes a Physical Save — Recovery (DV 12).");
    const keyed = abilitySaveDv(saveOf(actions), actions, attrHeavy);
    expect(keyed).toMatchObject({ dv: SAVE_DV_BASE + 10, sourceLabel: "Wisdom" });
  });

  it("computes a DV even for plain stat saves with no printed number", () => {
    const actions = parseAbilityActions("The target makes an Endurance Save or is Poisoned.");
    const keyed = abilitySaveDv(saveOf(actions), actions, stats);
    expect(keyed).toMatchObject({ dv: SAVE_DV_BASE + 5, checkPathId: "capacity", printed: undefined });
  });

  it("returns null for non-save actions", () => {
    const actions = parseAbilityActions("You make a Physical Check — Power.");
    expect(abilitySaveDv(actions[0], actions, stats)).toBeNull();
  });
});

describe("labels", () => {
  it("strips printed DV/DC tails so the computed DV can stand alone", () => {
    const axis = parseAbilityActions("The target makes a Mental Save — Influence (DV 16) or is Frightened.");
    expect(savePlainLabel(saveOf(axis))).toBe("Mental Save — Influence");
    const plain = parseAbilityActions("The target makes an Endurance Save (DC 18) or is Poisoned.");
    expect(savePlainLabel(saveOf(plain))).toBe("Endurance save");
  });

  it("spells the whole derivation in the breakdown", () => {
    const actions = parseAbilityActions("The target makes a Mental Save — Influence (DV 16) or is Frightened.");
    const keyed = abilitySaveDv(saveOf(actions), actions, stats)!;
    expect(saveDvBreakdown(keyed)).toBe(`DV ${SAVE_DV_BASE + 5} = ${SAVE_DV_BASE} + Capacity check +5 (Wisdom) · printed DV 16`);
  });
});
