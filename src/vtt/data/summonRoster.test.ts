import { describe, expect, it } from "vitest";
import { resolveSummon, summonNameKey, summonProfileNote, type CodexSummonEntry } from "./summonRoster";
import type { QuickCreature } from "./quickCreatures";

const quick = (name: string, hp = 12): QuickCreature => ({ id: `qc-${name}`, name, hp });
const codex = (name: string, hp = 40): CodexSummonEntry => ({ name, hp, cls: 1, size: 1 });

describe("summonNameKey", () => {
  it("folds the spellings a page and a bestiary actually differ in", () => {
    // The Stygian incept conjures "100 Lesser Stygian Minions"; a bestiary page
    // names the singular. Neither author is wrong and neither should have to
    // change to make a count work.
    expect(summonNameKey("Lesser Stygian Minions")).toBe(summonNameKey("lesser  stygian minion"));
  });

  it("does not fold two different creatures together", () => {
    // The whole reason matching is exact-after-folding rather than fuzzy: a
    // swarm that quietly took the wrong statline is worse in every way than one
    // that reports it found nothing.
    expect(summonNameKey("Lesser Stygian")).not.toBe(summonNameKey("Greater Stygian"));
  });
});

describe("resolveSummon", () => {
  it("takes its numbers from content the table can open and edit", () => {
    const result = resolveSummon("Xryte", { codex: [codex("Xryte", 55)] });
    expect(result.status).toBe("resolved");
    if (result.status !== "resolved") return;
    expect(result.profile.source).toBe("codex-creature");
    expect(result.profile.spawn.hp).toBe(55);
  });

  it("prefers the campaign's own quick block and says the page was not used", () => {
    const result = resolveSummon("Xryte", { quick: [quick("Xryte", 9)], codex: [codex("Xryte", 55)] });
    expect(result.status).toBe("resolved");
    if (result.status !== "resolved") return;
    expect(result.profile.source).toBe("quick-creature");
    expect(result.profile.spawn.hp).toBe(9);
    // The loser is reported rather than dropped: two statlines under one name is
    // exactly when the wrong one lands silently.
    expect(result.shadowed.map((p) => p.source)).toEqual(["codex-creature"]);
  });

  it("refuses to pick between two entries of the same name in one store", () => {
    const result = resolveSummon("Xryte", { codex: [codex("Xryte", 55), codex("XRYTE", 5)] });
    expect(result.status).toBe("ambiguous");
  });

  it("reports rather than invents when the corpus states a profile only in prose", () => {
    // Seraph's Kirkndomou says a Vibra "without a dedicated profile uses 75 HP ·
    // Attack Power 10 · Evasion 10 · Action Priority 5 · all other resolutions
    // 7". Those numbers are the SETTING's, and typing them into TypeScript
    // would put them somewhere no table could fork. This test exists to fail if
    // someone ever does.
    const result = resolveSummon("Kirkndomou", { quick: [quick("Xryte")], codex: [codex("Lesser Stygian")] });
    expect(result.status).toBe("unstatted");
    const note = summonProfileNote(result);
    expect(note).not.toMatch(/75/);
    // And it must point at the two places a profile CAN be written, or the
    // Curator reads it as a wall instead of a fork in the road.
    expect(note).toMatch(/page/i);
    expect(note).toMatch(/quick/i);
  });

  it("treats a nameless summon as unstatted rather than matching everything", () => {
    expect(resolveSummon("   ", { quick: [quick("Xryte")] }).status).toBe("unstatted");
  });
});
