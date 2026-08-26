// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { bakedCiphers, getGenusDomain, speciesInnate, zeroAttributes, zeroSpecialties } from "../../game/wte";
import type { CharacterRecord } from "../../lib/characters";
import { characterActionSet, characterEffectiveRollScores, characterRollAxisStats } from "./characterAbilities";

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

// `VttAbility.id` is positional — `cipher:LIGHT WEIGHT:0` — so it changes the
// moment a player reorders a loadout or a Curator renames the ability. An
// outcome filed under it could never be correlated back. `abilityId` is the
// permanent Codex id, carried alongside so the UI keying stays untouched.
describe("VTT ability rows carry the permanent Codex id", () => {
  const cipherName = bakedCiphers()["cognition"][0].name;
  const cipherId = bakedCiphers()["cognition"][0].id;

  const rec = {
    id: "ability-ids",
    campaignId: "table",
    name: "Ident",
    createdAt: 0,
    updatedAt: 0,
    sheet: {
      attributes: zeroAttributes(),
      specialties: zeroSpecialties(),
      paradigmId: "cognition",
      speciesId: "hyomen",
      rank: 3,
      cipherLoadout: [cipherName],
      innateChoice: ["Omen"],
      genusLoadout: ["Lark"],
      focusSpend: { genus: { Lark: 4 }, incepts: [] },
    },
  } as unknown as CharacterRecord;

  it("populates it for genus, cipher and racial rows", () => {
    const set = characterActionSet(rec);
    expect(set.genus.map((a) => a.abilityId)).toEqual(["wte.genus.lark"]);
    expect(set.cipher.map((a) => a.abilityId)).toEqual([cipherId]);
    expect(set.racial.map((a) => a.abilityId)).toEqual(["wte.innate.hyomen-omen"]);
  });

  it("leaves the positional id exactly as the UI already keys off it", () => {
    const set = characterActionSet(rec);
    expect(set.genus[0].id).toBe("genus:Lark:0");
    expect(set.cipher[0].id).toBe(`cipher:${cipherName}:0`);
    expect(set.racial[0].id).toBe("racial:Omen:0");
  });
});

// The panel asks abilityUnderstanding(effect, actions), so a row that arrives
// without its block silently falls back to the prose parse — the ability still
// renders, just with the edges between its steps lost again. Nothing about the
// screen looks broken, which is exactly why this needs asserting.
describe("VTT ability rows carry the page's declared steps", () => {
  const genus = getGenusDomain("Eldritch")!.abilities.find((a) => a.actions)!;
  const cipher = bakedCiphers()["science"].find((c) => c.actions)!;
  const innate = speciesInnate("seraph").find((a) => a.actions)!;

  const rec = {
    id: "declared-steps",
    campaignId: "table",
    name: "Declarer",
    createdAt: 0,
    updatedAt: 0,
    sheet: {
      attributes: zeroAttributes(),
      specialties: zeroSpecialties(),
      paradigmId: "science",
      speciesId: "seraph",
      rank: 3,
      cipherLoadout: [cipher.name],
      innateChoice: [innate.name],
      genusLoadout: [genus.name],
      focusSpend: { genus: { [genus.name]: 4 }, incepts: [] },
    },
  } as unknown as CharacterRecord;

  it("for genus, cipher and racial rows alike", () => {
    const set = characterActionSet(rec);
    expect(set.genus[0].actions).toBe(genus.actions);
    expect(set.cipher[0].actions).toBe(cipher.actions);
    expect(set.racial[0].actions).toBe(innate.actions);
  });

  it("and leaves a weapon row — which has no page to declare on — without one", () => {
    expect(characterActionSet(rec).actions.every((a) => !a.actions)).toBe(true);
  });
});
