import { describe, expect, it } from "vitest";
import {
  isLegacyStatWord,
  legacyReport,
  legacyStatWords,
  scanLegacyRolls,
  scanLegacyVocabulary,
  translateLegacyStat,
  unmappedRollWords,
} from "./legacyVocabulary";
import { ROLL_AXIS_PATHS } from "./rollAxis";
import inceptData from "./data/incepts.json";

const ok = (term: string, direction: "check" | "save") => {
  const t = translateLegacyStat(term, direction);
  expect(t, `${term} ${direction}`).toBeTruthy();
  expect(t!.ok, `${term} ${direction} → ${t!.ok ? "" : t!.refusal.detail}`).toBe(true);
  return t!.ok ? t!.route : null!;
};

const refused = (term: string, direction: "check" | "save") => {
  const t = translateLegacyStat(term, direction);
  expect(t, `${term} ${direction}`).toBeTruthy();
  expect(t!.ok).toBe(false);
  return t!.ok ? null! : t!.refusal;
};

describe("the closed table", () => {
  it("routes the attribute names the old prose used", () => {
    expect(ok("Dexterity", "save").ref).toEqual({ axis: "physical", direction: "save", path: "evasion" });
    expect(ok("Endurance", "save").ref).toEqual({ axis: "physical", direction: "save", path: "recovery" });
    expect(ok("Wisdom", "check").ref).toEqual({ axis: "mental", direction: "check", path: "capacity" });
    expect(ok("Intelligence", "check").ref).toEqual({ axis: "mental", direction: "check", path: "perception" });
    expect(ok("Action Priority", "check").ref).toEqual({ axis: "physical", direction: "check", path: "density" });
    expect(ok("Charisma", "save").ref).toEqual({ axis: "mental", direction: "save", path: "influence" });
  });

  it("routes specialty names onto the path that carries them", () => {
    expect(ok("Mental Fortitude", "check").ref.path).toBe("capacity");
    expect(ok("Cunning", "check").ref.path).toBe("influence");
    expect(ok("Weapon Mastery", "check").ref.path).toBe("power");
    expect(ok("Adaptation", "save").ref.path).toBe("recovery");
    expect(ok("Adaption", "save").ref.path).toBe("recovery");
  });

  it("says which of a path's two sources the word named", () => {
    expect(ok("Wisdom", "check").source).toBe("attribute");
    expect(ok("Mental Fortitude", "check").source).toBe("specialty");
    // Perception names the specialty and the path with one word. Both readings
    // reach the same route, so no source is claimed.
    expect(ok("Perception", "check").source).toBeUndefined();
  });

  it("reads back in the vocabulary Genus and Cipher pages are authored in", () => {
    expect(ok("Dexterity", "save").label).toBe("Physical Save — Evasion");
    expect(ok("Wisdom", "check").label).toBe("Mental Check — Capacity");
  });

  it("returns null — not a refusal — for a word it does not know", () => {
    // "Not a statistic" and "a statistic that cannot be routed" are different
    // answers; collapsing them would bury the second in noise from the first.
    expect(translateLegacyStat("Opportunity", "check")).toBeNull();
    expect(translateLegacyStat("progression", "check")).toBeNull();
    expect(isLegacyStatWord("Targeting")).toBe(false);
  });
});

describe("refusals", () => {
  it("will not invent a direction a path does not have", () => {
    // The bug this whole module exists to prevent: Capacity is a check only, so
    // "Wisdom Saving Throw" cannot become a Capacity save, and it must not be
    // slid onto Evasion or Recovery because those are the saves that exist.
    const wisdom = refused("Wisdom", "save");
    expect(wisdom.code).toBe("direction-not-on-path");
    expect(wisdom.detail).toContain("Capacity");
    expect(refused("Dexterity", "check").code).toBe("direction-not-on-path");
    expect(refused("Balance", "check").code).toBe("direction-not-on-path");
    expect(refused("Strength", "save").code).toBe("direction-not-on-path");
  });

  it("refuses specialties no path carries", () => {
    for (const term of ["Inspiration", "Weight", "Control"]) {
      expect(refused(term, "check").code).toBe("off-axis-statistic");
    }
  });

  it("refuses words that name no W.T.E statistic at all", () => {
    for (const term of ["CON", "Constitution", "ADA", "Insight"]) {
      expect(refused(term, "check").code).toBe("undeclared-statistic");
    }
  });

  it("never hands back a route the Roll Axis does not have", () => {
    // Exhaustive: every word × both directions. Whatever routes must be a real
    // path that really allows that direction.
    for (const term of legacyStatWords()) {
      for (const direction of ["check", "save"] as const) {
        const t = translateLegacyStat(term, direction)!;
        if (!t.ok) continue;
        const path = ROLL_AXIS_PATHS.find((p) => p.id === t.route.ref.path)!;
        expect(path, term).toBeTruthy();
        expect(path.directions).toContain(direction);
        expect(path.axis).toBe(t.route.ref.axis);
      }
    }
  });
});

describe("phrase scanning", () => {
  it("reads the shapes the corpus is actually written in", () => {
    expect(scanLegacyRolls("The target gains Disadvantage on Dexterity Saving Throws.")[0].translation).toMatchObject({
      ok: true,
      route: { ref: { path: "evasion", direction: "save" } },
    });
    expect(scanLegacyRolls("Roll an Intelligence Check (DC 10).")[0].translation).toMatchObject({
      ok: true,
      route: { ref: { path: "perception", direction: "check" } },
    });
    expect(scanLegacyRolls("gain Advantage on Mental Fortitude Checks")[0].translation).toMatchObject({
      ok: true,
      route: { ref: { path: "capacity" } },
    });
    // A decorative middle word does not change the statistic.
    expect(scanLegacyRolls("must succeed on a Perception Skill Check")[0].translation).toMatchObject({
      ok: true,
      route: { stat: "Perception" },
    });
  });

  it("distributes one direction word over a list of statistics", () => {
    const found = scanLegacyRolls("you gain +1 to Dexterity and Cunning Checks");
    expect(found.map((f) => (f.translation.ok ? f.translation.route.stat : f.translation.refusal.stat))).toEqual([
      "Dexterity",
      "Cunning",
    ]);
    // Dexterity sits on Evasion, which is a save — so half this sentence routes
    // and half of it is a question for the author.
    expect(found[0].translation.ok).toBe(false);
    expect(found[1].translation.ok).toBe(true);
  });

  it("reads the hybrid form the species pages are written in", () => {
    // Half Roll Axis, half legacy. Neither parser recognised it before, so both
    // of these sentences reached no dice at all.
    const seraph = scanLegacyVocabulary("the Kadexiln can force a Perception Save - Intelligence upon the enemy");
    expect(seraph).toHaveLength(1);
    expect(seraph[0].translation).toMatchObject({
      ok: true,
      route: { stat: "Intelligence", label: "Mental Save — Perception" },
    });
    expect(scanLegacyVocabulary("resist the condition by making a Mental Check - Wisdom")[0].translation).toMatchObject({
      ok: true,
      route: { stat: "Wisdom", label: "Mental Check — Capacity" },
    });
  });

  it("refuses a hybrid whose halves disagree", () => {
    // Wisdom sits on Capacity, which is mental. Letting the head win would roll
    // a different statistic than the tail names; letting the tail win would
    // silently discard the author's other half.
    const found = scanLegacyVocabulary("the target makes a Physical Check - Wisdom");
    expect(found[0].translation.ok).toBe(false);
    expect(found[0].translation.ok ? null : found[0].translation.refusal.code).toBe("contradictory-hybrid");
  });

  it("does not report a hybrid twice", () => {
    // "Perception Save" is a legal bare phrase in its own right, and it sits
    // inside every hybrid that starts with it.
    const found = scanLegacyVocabulary("force a Perception Save - Intelligence");
    expect(found).toHaveLength(1);
    expect(found[0].phrase).toContain("Intelligence");
  });

  it("marks a plural direction word, which the old prose uses for standing penalties", () => {
    // "Disadvantage on Balance Checks" is a condition someone carries; "make a
    // Balance Check" is dice on the table. A caller arming a roll needs the
    // difference, and only the scanner can see which word was written.
    expect(scanLegacyRolls("Disadvantage on Dexterity Saving Throws")[0].plural).toBe(true);
    expect(scanLegacyRolls("must make a Dexterity Saving Throw")[0].plural).toBe(false);
    expect(scanLegacyVocabulary("Disadvantage on Physical Saves - Dexterity")[0].plural).toBe(true);
    expect(scanLegacyVocabulary("force a Perception Save - Intelligence")[0].plural).toBe(false);
  });

  it("leaves ordinary prose alone", () => {
    expect(scanLegacyRolls("you may reroll the check and take the new result")).toEqual([]);
    expect(scanLegacyRolls("Applies to Cipher activation, progression checks")).toEqual([]);
    expect(scanLegacyRolls("+5 to all Opportunity Rolls and immunity to Fear")).toEqual([]);
    expect(scanLegacyRolls("")).toEqual([]);
  });
});

// ── The shipped corpus ─────────────────────────────────────────────────────
// The table was built by enumerating these strings. These two tests are what
// keep that true: one fails if a new legacy word is authored, the other pins the
// exact list of phrases that still need the user's decision.

const CORPUS: { id: string; text: string }[] = Object.entries(
  inceptData as Record<string, { incepts: { name: string; effect?: string }[] }>
).flatMap(([speciesId, pool]) =>
  (pool.incepts ?? []).map((incept) => ({ id: `${speciesId}/${incept.name}`, text: incept.effect ?? "" }))
);

describe("the shipped Incept corpus", () => {
  it("names a rolled word the table does not carry", () => {
    // The corpus assertion below expects an EMPTY list, which a tripwire that
    // never fires satisfies just as well as a clean corpus does. This is the
    // half that proves the tripwire works: gut `unmappedRollWords` and this
    // dies, while the corpus test goes on passing.
    expect(unmappedRollWords("the target must make a Willpower Save (DC 12)")).toEqual(["Willpower"]);
    expect(unmappedRollWords("gain Advantage on Fortitude Checks")).toEqual(["Fortitude"]);
    expect(unmappedRollWords("Disadvantage on Reflex Saving Throws")).toEqual(["Reflex"]);
    // A word the table DOES carry is not a report, however it is spelled.
    expect(unmappedRollWords("Disadvantage on Dexterity Saving Throws")).toEqual([]);
    expect(unmappedRollWords("gain Advantage on Mental Fortitude Checks")).toEqual([]);
    // Nor is prose that names no statistic in the first place.
    expect(unmappedRollWords("Applies to Cipher activation, progression checks")).toEqual([]);
  });

  it("contains no rolled word the table has never heard of", () => {
    const unknown = new Set<string>();
    for (const entry of CORPUS) for (const word of unmappedRollWords(entry.text)) unknown.add(word);
    expect([...unknown].sort()).toEqual([]);
  });

  it("still needs the user's decision on exactly these", () => {
    const open = new Set<string>();
    for (const entry of CORPUS) {
      for (const refusal of legacyReport(entry.text).refusals) open.add(`${refusal.stat} ${refusal.direction}`);
    }
    // Each line is a rule the user owns: either the statistic gets a Roll Axis
    // seat, or the prose stops rolling it. Nothing here is routed to a
    // neighbour in the meantime.
    expect([...open].sort()).toEqual([
      "ADA check",
      "Balance check",
      "CON check",
      "Dexterity check",
      "Insight check",
      "Inspiration check",
      "Wisdom save",
    ]);
  });

  it("routes the rest", () => {
    const routed = new Set<string>();
    for (const entry of CORPUS) for (const route of legacyReport(entry.text).routes) routed.add(route.label);
    expect([...routed].sort()).toEqual([
      "Mental Check — Capacity",
      "Mental Check — Influence",
      "Mental Check — Perception",
      "Physical Check — Density",
      "Physical Save — Evasion",
      "Physical Save — Recovery",
    ]);
  });
});
