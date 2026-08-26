import { describe, expect, it } from "vitest";
import type { AbilityAction } from "../../game/abilityActions";
import type { RollAxisStats } from "../../game/rollAxis";
import { SAVE_DV_BASE } from "../../game/saveDv";
import { saveIntentChip, type SaveIntentInput } from "./abilitySaveIntent";

const SAVE: AbilityAction = {
  kind: "save",
  label: "Physical Save — Evasion · DV 13",
  stat: "Evasion",
  dc: 13,
  rollAxis: { axis: "physical", direction: "save", path: "evasion" },
};

const CHECK: AbilityAction = {
  kind: "self",
  label: "Physical Check — Power",
  expr: "1d20",
  rollAxis: { axis: "physical", direction: "check", path: "power" },
};

/** A sheet with nothing on it. The DV keys off the attacker's modifiers, so a
 *  blank one lands exactly on the base and any offset in a test is legible. */
const BLANK: RollAxisStats = {
  attr: { phy: 0, ap: 0, dex: 0, end: 0, wis: 0, int: 0, cha: 0 },
  spec: { wm: 0, pre: 0, bal: 0, adp: 0, mf: 0, per: 0, cun: 0 },
  derived: { atk: 0, ad: 0, ev: 0, rr: 0, nc: 0, pr: 0, inf: 0 },
};

function input(over: Partial<SaveIntentInput> = {}): SaveIntentInput {
  return {
    ability: { abilityId: "ab-reverse-reaction", name: "Reverse Reaction", effect: "The target is thrown back." },
    actions: [CHECK, SAVE],
    declared: false,
    axisStats: null,
    casterCharacterId: "ch-1",
    ...over,
  };
}

describe("saveIntentChip", () => {
  it("files the request under the ability's permanent id, not its loadout slot", () => {
    // An outcome outlives the row it was fired from: a card still open when the
    // player reshuffles their loadout has to keep pointing at the same page.
    const chip = saveIntentChip(SAVE, input());
    expect(chip.intent.abilityId).toBe("ab-reverse-reaction");
    expect(chip.intent.abilityName).toBe("Reverse Reaction");
    expect(chip.intent.effect).toBe("The target is thrown back.");
    expect(chip.intent.sourceCharacterId).toBe("ch-1");
  });

  it("keys the DV to the attacker and puts that number on the button", () => {
    const chip = saveIntentChip(SAVE, input({ axisStats: BLANK }));
    expect(chip.dv).toBe(SAVE_DV_BASE);
    expect(chip.fromPage).toBe(false);
    // The printed "· DV 13" is stripped, not doubled up beside the keyed one.
    expect(chip.label).toBe(`Physical Save — Evasion · DV ${SAVE_DV_BASE}`);
    expect(chip.intent.dc).toBe(SAVE_DV_BASE);
    expect(chip.intent.label).toBe(chip.label);
    expect(chip.title).toContain(`DV ${SAVE_DV_BASE} = ${SAVE_DV_BASE}`);
  });

  it("keys nothing without a caster, leaving the page's printed number standing", () => {
    // No character in scope — a target token asked for a save by a Curator with
    // no attacker selected still gets the page's own DV rather than none.
    const chip = saveIntentChip(SAVE, input());
    expect(chip.dv).toBeUndefined();
    expect(chip.label).toBe(SAVE.label);
    expect(chip.intent.dc).toBe(13);
  });

  it("prefers a DV the page DECLARED over the keyed one", () => {
    const chip = saveIntentChip(SAVE, input({ declared: true, axisStats: BLANK }));
    expect(chip.dv).toBe(13);
    expect(chip.fromPage).toBe(true);
    expect(chip.title).toContain("declared on this ability's page");
  });

  it("sends no steps at all for an ability that declared none", () => {
    // The undeclared corpus has to reach the ledger as the identical request it
    // always did; an empty `steps: []` riding along is a second way for it to
    // behave differently from the path it used before blocks existed.
    expect("steps" in saveIntentChip(SAVE, input()).intent).toBe(false);
    expect("steps" in saveIntentChip(SAVE, input({ steps: [] })).intent).toBe(false);
  });

  it("carries declared steps when the page wrote a block", () => {
    const steps = [{ verb: "damage", branch: "fail", who: "target", cadence: "once" }] as SaveIntentInput["steps"];
    expect(saveIntentChip(SAVE, input({ steps })).intent.steps).toBe(steps);
  });

  it("passes the save's stat and Roll Axis route through so the target answers on the right one", () => {
    // `stat` is what the shell builds the target's own dice from. Dropped, the
    // request still carries a keyed DV and a label that reads correctly, and the
    // target rolls a bare d20 at it — a failure with nothing on screen to show
    // for it, which is why it is asserted here beside the axis and not left to
    // the rendering tests.
    const intent = saveIntentChip(SAVE, input()).intent;
    expect(intent.stat).toBe("Evasion");
    expect(intent.rollAxis).toEqual({ path: "evasion", direction: "save" });
  });
});
