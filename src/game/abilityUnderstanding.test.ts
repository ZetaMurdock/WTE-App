// The precedence rule, stated as tests.
//
// Two readers can describe one ability. If both are allowed to answer, a page
// that declares `Fail: Damage: 3d10 Cold` next to prose reading "takes 3d10 Cold
// damage" hands the table TWO damage buttons for one effect — and the second one
// is the kind of bug nobody reports, because it looks like a feature until
// somebody rolls it.
import { describe, expect, it } from "vitest";
import { parseAbilityActions } from "./abilityActions";
import { abilityUnderstanding } from "./abilityUnderstanding";

const PROSE =
  "The Inquisitor freezes the air solid. The target makes a Physical Save — Recovery (DV 15) " +
  "or takes 2d8 Cold damage.";

describe("an ability that declares nothing", () => {
  it("is read exactly as the prose parser reads it", () => {
    const read = abilityUnderstanding(PROSE);
    expect(read.declared).toBe(false);
    expect(read.actions).toEqual(parseAbilityActions(PROSE));
    expect(read.chips).toEqual([]);
    expect(read.errors).toEqual([]);
  });

  it("is unchanged by an absent, empty or whitespace block", () => {
    // The realistic shape of a missing block is not `undefined` — it is a page
    // section that parsed to an empty string, or a null database column.
    for (const blank of [undefined, null, "", "\n   \n"]) {
      expect(abilityUnderstanding(PROSE, blank)).toEqual(abilityUnderstanding(PROSE));
    }
  });

  it("keeps answering from prose when the whole block is unreadable", () => {
    // A block of nothing but authoring errors declares nothing, so the ability
    // must not lose the behaviour it already had — but the errors still travel,
    // because the Curator is the only one who can fix them.
    const read = abilityUnderstanding(PROSE, "- Smite: everything nearby");
    expect(read.declared).toBe(false);
    expect(read.actions).toEqual(parseAbilityActions(PROSE));
    expect(read.errors).toHaveLength(1);
  });
});

describe("a declared block supersedes the prose parse", () => {
  const BLOCK = [
    "- Cost: 6 SS",
    "- Save (target): Physical Save — Recovery, DV 18",
    "- Fail: Damage: 3d10 Cold, half on success",
    "- Fail: Condition: Slowed, 2 rounds",
    "- Ruling: brittle objects shatter — Curator adjudicates",
  ].join("\n");

  it("answers with the declared steps and nothing from the prose", () => {
    const read = abilityUnderstanding(PROSE, BLOCK);
    expect(read.declared).toBe(true);
    expect(read.errors).toEqual([]);
    expect(read.actions.filter((a) => a.kind === "save")).toHaveLength(1);
    expect(read.actions.find((a) => a.kind === "save")!.dc).toBe(18);
  });

  it("deals the declared damage once, not once per reader", () => {
    // The prose says 2d8 and the block says 3d10. Merging would arm both; the
    // block wins outright, which is also what makes a Curator's edit meaningful.
    const damage = abilityUnderstanding(PROSE, BLOCK).actions.filter((a) => a.kind === "damage");
    expect(damage).toHaveLength(1);
    expect(damage[0].expr).toBe("3d10");
    expect(damage[0].damageType).toBe("Cold");
  });

  it("arms the same Roll Axis route the prose parser would have found", () => {
    // One renderer, one DV keying path: a declared save has to carry the route
    // in the same shape, or the sheet's keyed-DV chip silently stops keying.
    const declared = abilityUnderstanding(PROSE, BLOCK).actions.find((a) => a.kind === "save")!;
    const parsed = parseAbilityActions(PROSE).find((a) => a.kind === "save")!;
    expect(declared.rollAxis).toEqual(parsed.rollAxis);
  });

  it("shows every step that has no dice of its own as a chip", () => {
    // Cost, Condition and Ruling produce no AbilityAction. Left undrawn, a fully
    // declared ability would render as strictly less than the prose it replaced.
    const chips = abilityUnderstanding(PROSE, BLOCK).chips;
    expect(chips.map((c) => c.label)).toEqual([
      "6 SS",
      "On fail · Slowed · 2 rounds",
      "Curator rules",
    ]);
    expect(chips[1].title).toBe("Applies Slowed to the target when the resolution fails");
    expect(chips[2].title).toBe("brittle objects shatter — Curator adjudicates");
  });

  it("gives each chip a key that survives a re-render", () => {
    // Two `Condition:` lines on one ability is ordinary authoring; keys drawn
    // from the label alone would collide and React would reuse the wrong node.
    const chips = abilityUnderstanding("", "- Condition: Slowed\n- Condition: Slowed").chips;
    expect(new Set(chips.map((c) => c.key)).size).toBe(2);
  });

  it("automates the part it declares while the prose stays on the page", () => {
    // A partial block is first-class: declaring only the cost must not delete
    // the ability's other reading, and the effect text is still the thing a
    // human reads — both surfaces render it whether or not a block exists.
    const read = abilityUnderstanding(PROSE, "- Cost: 6 SS");
    expect(read.declared).toBe(true);
    expect(read.actions).toEqual([]);
    expect(read.chips.map((c) => c.label)).toEqual(["6 SS"]);
  });

  it("tells the caster's own dice apart from the target's", () => {
    // Unravel Spacia's collapse hits everything adjacent INCLUDING the user, so
    // it declares the same dice twice with different selectors. Two buttons
    // reading "3d10 Force" would be two rolls a table cannot tell apart — and
    // only one of them is the caster's own price.
    const read = abilityUnderstanding("", "- Damage: 3d10 Force\n- Damage (self): 3d10 Force");
    expect(read.actions.map((a) => a.label)).toEqual(["3d10 Force", "3d10 Force (self)"]);
    expect(read.actions.map((a) => a.self)).toEqual([undefined, true]);
  });

  it("says whose roll a non-default selector moved", () => {
    // Modify defaults to the caster, so Blinding Radiance's `Modify (target)`
    // chip would otherwise read as though the USER took the disadvantage.
    const read = abilityUnderstanding("", "- Fail: Modify (target): Disadvantage on Physical Check — Density, 2 rounds");
    expect(read.chips.map((c) => c.label)).toEqual([
      "On fail · Disadvantage · Physical Check — Density (target)",
    ]);
    expect(read.chips[0].title).toBe("Disadvantage for the target when the resolution fails");
  });

  it("reports a line it could not read beside the steps it could", () => {
    const read = abilityUnderstanding(PROSE, "- Cost: 6 SS\n- Save: Physical Save — Power");
    expect(read.declared).toBe(true);
    expect(read.chips.map((c) => c.label)).toEqual(["6 SS"]);
    // Power is a check and has no save: the route does not exist, so no button
    // is offered for it — but the page says so out loud.
    expect(read.errors).toHaveLength(1);
  });
});
