// Where an ability fires from, read off the two places a page can say it.
import { describe, expect, it } from "vitest";
import { declaredOrigin, originMatchText, originOf } from "./abilityOrigin";
import { parseAbilityEffects } from "./abilityEffects";
import { bakedCiphers } from "./wte";

const ALL_CIPHERS = Object.values(bakedCiphers()).flat();

describe("the block's own word", () => {
  it("reads an Origin bullet", () => {
    const origin = declaredOrigin(null, "- Origin: Medium\n- Damage: 2d8");
    expect(origin.text).toBe("Medium");
    expect(origin.source).toBe("block");
  });

  it("takes the first of two, because an ability fires from one place", () => {
    // A page listing two origins has not said which, and picking the last would
    // make the answer depend on bullet order for no reason a reader could see.
    expect(originOf(parseAbilityEffects("- Origin: Medium\n- Origin: Shadow").steps)).toBe("Medium");
  });

  it("says nothing for the abilities that never said", () => {
    const origin = declaredOrigin("Deal 3d10 Cold to one creature.", "- Damage: 3d10 Cold");
    expect(origin.text).toBeNull();
    expect(origin.source).toBeNull();
  });
});

describe("the header every shipped Cipher already carries", () => {
  it("reads Component as an origin, so 148 pages gain one without an edit", () => {
    const weaponize = ALL_CIPHERS.find((c) => c.id === "wte.cipher.weaponize");
    const origin = declaredOrigin(weaponize?.effect, null);
    expect(origin.component).toBe("Inanimate Object");
    expect(origin.source).toBe("component");
    expect(origin.isSelf).toBe(false);
  });

  it("gives every official Cipher an origin", () => {
    // The census's claim, held against the data rather than asserted in a
    // comment: if a Cipher ever ships without the header, the origin frame
    // silently stops covering it and nobody finds out at the table.
    const missing = ALL_CIPHERS.filter((c) => !declaredOrigin(c.effect, c.actions).text);
    expect(missing.map((c) => c.name)).toEqual([]);
  });

  it("lets a block's bullet override the header, because the author meant it", () => {
    const weaponize = ALL_CIPHERS.find((c) => c.id === "wte.cipher.weaponize");
    const origin = declaredOrigin(weaponize?.effect, "- Origin: The Medium");
    expect(origin.text).toBe("The Medium");
    expect(origin.source).toBe("block");
    // The header is still reported — a table looking at a wrong anchor needs to
    // see both halves to know which line to edit.
    expect(origin.component).toBe("Inanimate Object");
  });
});

describe("an origin that IS the caster", () => {
  it("recognises the two ways the corpus writes it", () => {
    // MASS DETECTION mounts on `Animate (self)`; S2 — ARMY OF ONE on
    // `Self (all Cipher slots)`. Both fire from the body, and prompting a
    // Curator to go find a "Self" on the map would be an origin question about
    // abilities that never had one.
    const mass = ALL_CIPHERS.find((c) => c.id === "wte.cipher.mass-detection");
    const army = ALL_CIPHERS.find((c) => c.id === "wte.cipher.s2-army-of-one");
    expect(declaredOrigin(mass?.effect, null).isSelf).toBe(true);
    expect(declaredOrigin(army?.effect, null).isSelf).toBe(true);
  });

  it("does not mistake a Component that names OTHER bodies for the caster", () => {
    // CHAIN COMMAND mounts on `Group of targets (up to 4)`. A looser self-test
    // would anchor a four-target Cipher to the Inquisitor.
    const chain = ALL_CIPHERS.find((c) => c.id === "wte.cipher.chain-command");
    expect(declaredOrigin(chain?.effect, null).isSelf).toBe(false);
  });
});

describe("the words worth matching against a map", () => {
  it("drops the qualifier no token will ever repeat", () => {
    expect(originMatchText("Inanimate object (light-interacting)")).toBe("inanimate object");
    expect(originMatchText("Group of targets (up to 4)")).toBe("group of targets");
  });

  it("keeps every remaining word, because guessing which one is the noun binds the wrong body", () => {
    expect(originMatchText("Battlefield environment")).toBe("battlefield environment");
  });
});
