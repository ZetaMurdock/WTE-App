// The declared blocks the SPECIES corpus carries, and the misreadings they fix.
//
// Eleven species abilities were being armed wrong by the prose parser — not
// because the parser is bad at English, but because a sentence does not say
// which SIDE of the table a die belongs to. "take 1d8 Bleed damage" is the
// caster's price in one clause and the target's wound in the next; "make a
// Mental Save — Perception" is the Venarian's own roll in a page whose every
// other save is the target's. A page cannot be reworded to fix that — it is
// Tyrek's prose — so each of these declares its steps instead.
//
// These assertions are about ATTRIBUTION, not about the numbers: the numbers
// live in the data files and are checked by round-tripping them. What is pinned
// here is who rolls, who bleeds, and which of the parser's old answers must
// never come back.
import { describe, expect, it } from "vitest";
import { effectLine, effectStepsToActions, parseAbilityEffects } from "./abilityEffects";
import { bakedSpecies, usableRacial } from "./wte";
import { consequencesFromSteps } from "../vtt/data/outcomeLedger";

/** One ability as both surfaces read it — `usableRacial` is what the sheet's
 *  Actions table and the VTT's racial group are both built from, so a block
 *  tested through it is tested where it is actually used. */
function ability(speciesId: string, variantName: string | undefined, name: string) {
  const found = usableRacial(speciesId, variantName).find((a) => a.name === name);
  if (!found) throw new Error(`${speciesId}/${variantName ?? "innate"} no longer carries "${name}"`);
  return found;
}

function steps(speciesId: string, variantName: string | undefined, name: string) {
  const read = parseAbilityEffects(ability(speciesId, variantName, name).actions);
  expect(read.errors, name).toEqual([]);
  return read.steps;
}

describe("every declared species block", () => {
  /** Innates, variant abilities and creation-time options that carry a block. */
  function declared(): Array<{ label: string; actions: string }> {
    const out: Array<{ label: string; actions: string }> = [];
    for (const species of bakedSpecies()) {
      for (const a of usableRacial(species.id)) if (a.actions) out.push({ label: `${species.id}/${a.name}`, actions: a.actions });
      for (const variant of species.variants) {
        for (const a of usableRacial(species.id, variant.name)) {
          if (a.actions && !out.some((o) => o.label === `${species.id}/${a.name}`)) {
            out.push({ label: `${species.id}/${variant.name}/${a.name}`, actions: a.actions });
          }
        }
      }
    }
    return out;
  }

  it("exists — a corpus that quietly emptied would pass every check below", () => {
    expect(declared().length).toBeGreaterThanOrEqual(15);
  });

  it("reads with no unreadable line", () => {
    // An unreadable bullet is the worst outcome available here: the ability
    // claims a step, the block silently drops it, and the sheet looks complete.
    for (const { label, actions } of declared()) {
      expect(parseAbilityEffects(actions).errors, label).toEqual([]);
    }
  });

  it("re-emits byte for byte", () => {
    // The Mechanics editor rebuilds a page from the parsed model, so a step it
    // cannot write back is a step it deletes the first time a Curator saves.
    for (const { label, actions } of declared()) {
      const written = parseAbilityEffects(actions).steps.map(effectLine).join("\n");
      expect(written, label).toBe(actions);
    }
  });
});

describe("the caster's own price is not the target's wound", () => {
  // Hincite: "Tear open part of your own flesh and take 1d8 Bleed damage" and
  // "A failed target also takes 1d8 Bleed damage at the start of each of its
  // turns" are two different 1d8s. The prose parser saw one untyped 1d8 and
  // gave it to the target, so a Resolution Card bound to the victim charged
  // them for the Nonsapn-Dokeru cutting itself.
  it("splits Hincite's two 1d8 Bleeds by side", () => {
    const damage = steps("seraph", "Nonsapn-Dokeru", "Hincite").filter((s) => s.verb === "damage");
    expect(damage.map((s) => [s.who, s.branch, s.cadence, s.expr, s.damageType])).toEqual([
      ["self", "always", "once", "1d8", "Bleed"],
      ["target", "fail", "each-round", "1d8", "Bleed"],
    ]);
  });

  it("splits Slfserv's two 1d8 Bleeds by side", () => {
    const damage = steps("seraph", "Nonsapn-Dokeru", "Slfserv").filter((s) => s.verb === "damage");
    expect(damage.map((s) => [s.who, s.expr, s.damageType])).toEqual([
      ["self", "1d8", "Bleed"],
      ["target", "1d8", "Bleed"],
    ]);
  });

  it("keeps the caster's dice off the target's card", () => {
    for (const name of ["Hincite", "Slfserv"]) {
      const read = steps("seraph", "Nonsapn-Dokeru", name);
      expect(read.filter((s) => s.verb === "damage").length, name).toBe(2);
      const card = consequencesFromSteps(read).filter((c) => c.kind === "damage");
      expect(card.map((c) => c.label), name).toEqual([expect.not.stringContaining("(self)")]);
    }
  });
});

describe("a roll the page gives to the user is not offered to the target", () => {
  // Space Modulation and Dilation both read "On an AP Check failure …" — the
  // trigger is a check the USER already failed, and both pages resolve
  // "Automatic". The parser armed that AP Check as a target-side save chip, so
  // the sheet asked the victim to roll the reaction's own precondition.
  // An AP Check is the Density path, which is what the prose parser already
  // resolved "AP check" to — so declaring `Roll:` moves the roll to the side the
  // sentence puts it on. Arming NOTHING was the first attempt at this, and it is
  // not a fix: it takes the reaction's trigger off the sheet altogether, leaving
  // the player with no button where they previously had a wrong one.
  it("arms the AP Check on the user for Space Modulation and Dilation", () => {
    for (const [sp, vn, an] of [["hyomen", "Spatians", "Space Modulation"], ["inderi", "AI'N", "Dilation"]] as const) {
      expect(effectStepsToActions(steps(sp, vn, an)), an).toEqual([
        { kind: "self", label: "Physical Check — Density", rollAxis: { axis: "physical", direction: "check", path: "density" } },
      ]);
    }
  });

  it("arms Primed Instinct's Save on the Venarian, not on the target", () => {
    // The page gives this Mental Save — Perception to the VENARIAN. The block
    // says so with `Save (self)`, and `effectStepsToActions` now lets the
    // selector decide the side — before, it read the verb alone, so a save could
    // only ever be a target-side chip and the sole way to suppress a wrong-sided
    // one was to declare no step. A chip reading "vs Mental Save — Perception"
    // is the bug; no chip at all was the workaround, not the baseline.
    const read = steps("insectoid", "Venarian", "Primed Instinct");
    expect(effectStepsToActions(read)).toEqual([
      { kind: "self", label: "Mental Save — Perception (self)", rollAxis: { axis: "mental", direction: "save", path: "perception" } },
    ]);
  });

  it("leaves the pillar-escape Check to the creature that is anchored", () => {
    // Iudicius names three routes and the prose parser armed the third twice —
    // once as the Salaris' own check and once as the target's save. It is
    // neither: a Hard Anchored creature rolls it later, on its own turn.
    const read = steps("subdermin", "Salaris", "Iudicius");
    expect(read.filter((s) => s.ref).map((s) => `${s.ref!.direction}:${s.ref!.path}`)).toEqual([
      "check:capacity",
      "save:evasion",
    ]);
  });

  it("drops Dyn Formn's phantom self check", () => {
    // "Endurance Save vs Prone (Pinched targets)" is ONE roll. The parser read
    // the words "Endurance" twice and produced a self Endurance check as well
    // as the targets' save, so the Oriyu was handed a d20 nothing asked for.
    const read = steps("oriyu", undefined, "Dyn Formn");
    expect(read.filter((s) => s.ref).map((s) => `${s.verb}:${s.ref!.path}`)).toEqual(["save:recovery"]);
    expect(read.some((s) => s.verb === "condition" && s.condition === "Prone")).toBe(true);
  });
});

describe("a passive is not a button", () => {
  it("gives Indomitable Will its Advantage instead of a Mental Fortitude d20", () => {
    // "Passive (Self) · Always · Automatic. You gain Advantage on Wisdom and
    // Mental Fortitude checks" — both of those are the Capacity path's two
    // sources, so the whole rule is one Advantage on Mental Check — Capacity.
    // The parser armed a d20 for a passive that rolls nothing.
    const read = steps("hyomen", undefined, "Indomitable Will");
    expect(effectStepsToActions(read)).toEqual([]);
    expect(read.filter((s) => s.verb === "modify").map((s) => [s.modify, s.who, s.ref!.path])).toEqual([
      ["advantage", "self", "capacity"],
    ]);
  });

  it("stops Parasitic Shadow arming its threshold as damage", () => {
    // "where the natural d20 meets or exceeds your threshold" is the trigger
    // condition, and the parser armed it as a d20 damage button — the last of
    // the phantom-damage class. The threshold is a value the player DECLARES,
    // so nothing in the grammar can hold it and the page states it as a ruling.
    expect(effectStepsToActions(steps("stygians", undefined, "Parasitic Shadow"))).toEqual([]);
  });
});

describe("a promise the prose made and the parse dropped", () => {
  it("keeps Forsaken Touch's 'half' on the damage", () => {
    // "Resolution: Endurance save, half" — the save halves the 1d10, it does
    // not switch it off, and the parser carried neither fact: the damage was
    // armed unconditionally and the half was lost with the sentence.
    const damage = steps("subdermin", undefined, "Forsaken Touch").filter((s) => s.verb === "damage");
    expect(damage.map((s) => [s.expr, s.damageType, s.half, s.branch])).toEqual([["1d10", "Entropy", true, "always"]]);
  });

  it("says Venyl restores 15 SS", () => {
    // "restores 15 SS at the start of each turn" reached the sheet as nothing
    // at all. It is not a `Heal:` — that verb's amount is applied as HP by the
    // Resolution Card, and 15 SS restored as 15 HP is the same class of error
    // this whole pass exists to remove. Stated, not silently mis-applied.
    const rulings = steps("inderi", "Inderelict", "Venyl").filter((s) => s.verb === "ruling");
    expect(rulings.some((s) => s.prompt?.includes("restores 15 SS at the start of each turn"))).toBe(true);
    expect(steps("inderi", "Inderelict", "Venyl").some((s) => s.verb === "heal")).toBe(false);
  });
});
