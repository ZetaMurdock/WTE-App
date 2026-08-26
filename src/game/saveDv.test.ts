import { describe, expect, it } from "vitest";
import { parseAbilityActions } from "./abilityActions";
import { effectStepsToActions, parseAbilityEffects } from "./abilityEffects";
import type { RollAxisStats } from "./rollAxis";
import { SAVE_DV_BASE, abilitySaveDv, pairedCheckPath, saveChipDv, saveDvBreakdown, savePlainLabel } from "./saveDv";

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

describe("which DV a save chip shows", () => {
  // Through the real grammar, not a hand-built action: the whole question is
  // what an AUTHOR's block does to the chip, and a `dc` typed straight into an
  // object would prove only that this function reads the field it is handed.
  const declaredSave = (block: string) => {
    const read = parseAbilityEffects(block);
    expect(read.errors).toEqual([]);
    return saveOf(effectStepsToActions(read.steps));
  };

  it("prefers the DV the page declared over the keyed formula", () => {
    const save = declaredSave("- Save: Physical Save — Recovery, DV 18");
    const keyed = abilitySaveDv(save, [save], stats)!;
    expect(keyed.dv).toBe(SAVE_DV_BASE + 5);
    expect(saveChipDv(save, keyed, true)).toEqual({ dv: 18, fromPage: true });
  });

  it("defers to the keyed DV when the page asked for one by writing DV keyed", () => {
    const save = declaredSave("- Save: Physical Save — Recovery, DV keyed");
    const keyed = abilitySaveDv(save, [save], stats)!;
    expect(saveChipDv(save, keyed, true)).toEqual({ dv: keyed.dv, fromPage: false });
  });

  it("defers to the keyed DV when the page declares a save and names no DV", () => {
    const save = declaredSave("- Save: Physical Save — Recovery");
    const keyed = abilitySaveDv(save, [save], stats)!;
    expect(saveChipDv(save, keyed, false)).toEqual({ dv: keyed.dv, fromPage: false });
  });

  // The whole shipped corpus. A printed DV recovered from a sentence is not an
  // authored one, and if it started winning here every save in the game would
  // quietly un-key itself back to numbers written before Roll Axis existed.
  it("never lets a PROSE-printed DV beat the keyed one", () => {
    const actions = parseAbilityActions("The target makes a Mental Save — Influence (DV 16) or is Frightened.");
    const save = saveOf(actions);
    expect(save.dc).toBe(16);
    const keyed = abilitySaveDv(save, actions, stats)!;
    expect(saveChipDv(save, keyed, false)).toEqual({ dv: keyed.dv, fromPage: false });
  });

  // Three shipped blocks write this shape — Decisive Grasp, Inhibit and PSYCHIC
  // SCREAM all declare "DV 13/14 + Neuronal Capacity Modifier". Nothing here
  // resolves that modifier, so preferring the bare number would send the target
  // a DV the page never named, under a tooltip crediting the page for it.
  it("keys a declared DV whose bonus term the engine cannot resolve", () => {
    const save = declaredSave("- Save: Mental Save — Influence, DV 14 + Neuronal Capacity Modifier");
    expect(save.dc).toBe(14);
    expect(save.dcBonus).toBe("Neuronal Capacity Modifier");
    const keyed = abilitySaveDv(save, [save], stats)!;
    expect(saveChipDv(save, keyed, true)).toEqual({ dv: keyed.dv, fromPage: false });
  });

  // No stats to key with — an unresolvable character, a bare creature token.
  it("leaves the chip with no DV at all when neither source has one", () => {
    const save = declaredSave("- Save: Physical Save — Recovery");
    expect(saveChipDv(save, null, true)).toEqual({ dv: undefined, fromPage: false });
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
