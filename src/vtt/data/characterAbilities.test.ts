import { describe, expect, it } from "vitest";
import { zeroAttributes, zeroSpecialties } from "../../game/wte";
import type { CharacterRecord } from "../../lib/characters";
import { characterEffectiveRollScores, characterRollAxisStats } from "./characterAbilities";

describe("VTT effective roll scores", () => {
  it("matches the sheet's background, equipment, Soul, and specialty-cap stack", () => {
    const attributes = zeroAttributes();
    attributes.phy = 10;
    attributes.dex = 10;
    attributes.int = 10;
    const specialties = zeroSpecialties();
    specialties.bal = 70;
    specialties.ctrl = 10;
    const rec = {
      id: "effective-rolls",
      campaignId: "table",
      name: "Effective Rolls",
      createdAt: 0,
      updatedAt: 0,
      sheet: {
        attributes,
        specialties,
        sizeId: "small",
        morality: 0,
        background: {
          mode: "standard",
          assign: [],
          attrBonus: { phy: 2 },
          specBonus: { bal: 3 },
        },
        equipment: [{ id: "suit", name: "Roll Suit", weight: "light", equipped: true, mods: "DEX +2, Balance +4" }],
      },
    } as CharacterRecord;

    const scores = characterEffectiveRollScores(rec);
    expect(scores.attr).toMatchObject({ phy: 12, dex: 12, ap: 3, int: 13 });
    expect(scores.spec).toMatchObject({ bal: 75, ctrl: 13 });

    const axis = characterRollAxisStats(rec);
    expect(axis.attr).toMatchObject({ phy: 1, dex: 1, ap: -4, int: 1 });
    expect(axis.spec.bal).toBe(32);
  });
});
