import { describe, it, expect } from "vitest";
import { GENUS_DOMAIN_NAMES, getGenusDomain } from "./wte";
import { clauseLabel, countedClause, parseUsageLimit, type LimitClause } from "./abilityLimits";

const shape = (text: string): LimitClause[] => parseUsageLimit(text)!.clauses;

describe("reading an authored limit", () => {
  it("types the count and the window", () => {
    expect(shape("Twice per encounter")).toEqual([
      { kind: "per-period", count: 2, period: "encounter", everyN: 1, scopes: [], text: "Twice per encounter" },
    ]);
  });

  it("reads the count word and the bare number as the same count", () => {
    expect(shape("Four times per encounter")[0]).toMatchObject({ count: 4, period: "encounter" });
    expect(shape("4 per encounter")[0]).toMatchObject({ count: 4, period: "encounter" });
  });

  it("finds the window whichever side of the scope the author wrote it", () => {
    // The corpus writes both orders for the same rule. Ordering by position
    // would have made "Once per target per encounter" a per-target window and
    // "Once per encounter per target" a per-encounter one — the same limit
    // enforced two different ways depending on the sentence.
    for (const text of ["Once per encounter per target", "Once per target per encounter"]) {
      expect(shape(text)[0]).toMatchObject({ count: 1, period: "encounter", scopes: ["target"] });
    }
  });

  it("keeps a scope the parser has never heard of, because the setting names it", () => {
    expect(shape("Once per short rest per material pairing")[0]).toMatchObject({
      period: "short-rest",
      scopes: ["material pairing"],
    });
  });

  it("reads a window that spans several periods", () => {
    expect(shape("Once per 4 rounds")[0]).toMatchObject({ count: 1, period: "round", everyN: 4 });
  });

  it("separates a cap on live effects from a count of uses", () => {
    // "One active Link at a time" does not say how many Links you may start —
    // only how many may stand. Counting it as one use per anything would have
    // exhausted the ability after its first cast.
    expect(shape("One active Link at a time")).toEqual([
      { kind: "concurrent", count: 1, noun: "active Link", text: "One active Link at a time" },
    ]);
    expect(countedClause(parseUsageLimit("One active Link at a time"))).toBeNull();
  });

  it("refuses a cap that never said it was one", () => {
    // Without "at a time" / "up to" / "maximum", "5 SS" is a price, and typing
    // it as a cap of five SS would put a use counter on a cost.
    expect(parseUsageLimit("5 SS")).toMatchObject({ clauses: [], unreadable: ["5 SS"] });
  });

  it("reads unlimited as no count at all, not as a count of zero", () => {
    expect(shape("Unlimited within SS budget")).toEqual([
      { kind: "unlimited", gate: "SS budget", text: "Unlimited within SS budget" },
    ]);
  });

  it("types both halves of a compound limit", () => {
    expect(shape("One active Volume Increase at a time; 3 per short rest").map((c) => c.kind)).toEqual([
      "concurrent",
      "per-period",
    ]);
  });
});

describe("reporting rather than guessing", () => {
  it("keeps the countable half and reports the rider it cannot enforce", () => {
    const limit = parseUsageLimit("Once per long rest; requires willing participant")!;
    expect(countedClause(limit)).toMatchObject({ count: 1, period: "long-rest" });
    expect(limit.unreadable).toEqual(["requires willing participant"]);
  });

  it("refuses a limit that states two different windows for two forms", () => {
    // "Twice per encounter (Short), Once per 24 hours (Long)" is two rules for
    // one ability. Taking either would enforce the wrong one on half the uses,
    // so the whole string goes to the table.
    const limit = parseUsageLimit("Twice per encounter (Short), Once per 24 hours (Long)")!;
    expect(limit.clauses).toEqual([]);
    expect(limit.unreadable).toHaveLength(1);
  });

  it("refuses two windows written into one clause", () => {
    // "Once per turn per round" states two windows for one count. Taking the
    // first would enforce the tighter rule, taking the last the looser one, and
    // the page has not said which it means.
    const limit = parseUsageLimit("Once per turn per round")!;
    expect(limit.clauses).toEqual([]);
    expect(limit.unreadable).toEqual(["Once per turn per round"]);
  });

  it("keeps no count against a page that says the count is unlimited", () => {
    // Photonic Swing is authored "Unlimited; once per action". The rate rides
    // beside a declaration that there IS no use count, so it is a budget, not
    // an allowance — counting it read "1 of 1 used" on an ability the corpus
    // calls unlimited, and the app runs no action boundary to clear it.
    const limit = parseUsageLimit("Unlimited; once per action")!;
    expect(limit.clauses.map((c) => c.kind)).toEqual(["unlimited", "per-period"]);
    expect(countedClause(limit)).toBeNull();
  });

  it("refuses a window that is conditional on what is being targeted", () => {
    const limit = parseUsageLimit("Once per long rest for creature merging; once per encounter for objects")!;
    expect(limit.clauses).toEqual([]);
    expect(limit.unreadable).toHaveLength(2);
  });

  it("reports an unknown period word instead of counting against a made-up window", () => {
    const limit = parseUsageLimit("Once per Vespant")!;
    expect(limit.clauses).toEqual([]);
    expect(limit.unreadable).toEqual(["Once per Vespant"]);
  });

  it("distinguishes no authored limit from an unlimited one", () => {
    expect(parseUsageLimit(null)).toBeNull();
    expect(parseUsageLimit("   ")).toBeNull();
    expect(parseUsageLimit("Unlimited")).toMatchObject({ clauses: [{ kind: "unlimited", gate: null }] });
  });

  it("does not split a number's comma into a second clause", () => {
    const limit = parseUsageLimit("Unlimited; 5 SS per 1,000 gallons beyond basic use")!;
    expect(limit.clauses).toHaveLength(1);
    expect(limit.unreadable).toEqual(["5 SS per 1,000 gallons beyond basic use"]);
  });
});

describe("reading back", () => {
  it("says the rule in the words a Curator would use", () => {
    expect(clauseLabel(countedClause(parseUsageLimit("Twice per encounter"))!)).toBe("2 per encounter");
    expect(clauseLabel(countedClause(parseUsageLimit("Once per target per scene"))!)).toBe("1 per scene, per target");
    expect(clauseLabel(countedClause(parseUsageLimit("Once per 4 rounds"))!)).toBe("1 per 4 rounds");
  });
});

/**
 * The corpus report, kept executable.
 *
 * These are the ONLY authored genus limits this grammar cannot fully type, and
 * every one of them is a real rule needing the Curator's decision rather than a
 * parser bug. Listing them here means a new page written in an unreadable shape
 * fails the gate instead of quietly landing on a card as "not tracked" — and
 * that a limit dropping OFF the list (because someone re-authored it, or
 * because the grammar grew) has to be an intentional edit.
 */
const UNREADABLE_CLAUSES = [
  "5 SS per 1,000 gallons beyond basic use",
  "5 ss per round/5 ss per 10 minutes",
  "2 SS per minute",
  "Each use accumulates 1 Wryde charge",
  "Must be consciously deactivated",
  "drains 2 SS per round maintained",
  "maintained as Concentration",
  "cannot Reconstruct deceased creatures",
  "cannot shape living matter",
  "requires willing participant",
  "Once per long rest for creature merging",
  "once per encounter for objects",
  "Twice per encounter (Short), Once per 24 hours (Long)",
];

describe("the shipped genus corpus", () => {
  const authored = [...new Set(
    GENUS_DOMAIN_NAMES.flatMap((name) => getGenusDomain(name)!.abilities)
      .map((ability) => ability.limit)
      .filter((limit): limit is string => typeof limit === "string" && limit.trim().length > 0)
  )];

  it("types every authored limit, or reports exactly the known roster", () => {
    const found = new Set<string>();
    for (const text of authored) for (const clause of parseUsageLimit(text)!.unreadable) found.add(clause);
    expect([...found].sort()).toEqual([...UNREADABLE_CLAUSES].sort());
  });

  it("leaves a countable window on the great majority of them", () => {
    const counted = authored.filter((text) => countedClause(parseUsageLimit(text)) != null);
    // 30 of the 47 distinct strings resolve to a window a tally can be kept
    // against; of the other 17, 14 are caps or budgets with no use count to
    // keep — "Unlimited; once per action" among them — and 3 name a window only
    // a Curator can settle. A drop is the parser regressing, not the corpus
    // moving: the corpus is authored prose and does not change itself.
    expect(counted.length).toBeGreaterThanOrEqual(30);
  });
});
