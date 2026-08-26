import { describe, it, expect, beforeEach } from "vitest";
import { parseUsageLimit } from "../../game/abilityLimits";
import {
  __resetUsageLedger,
  boundaryOf,
  clearUses,
  listUses,
  recordUse,
  subscribeUses,
  usageLabel,
  usageStatus,
  usageTitle,
  windowKey,
  type UsageWindow,
} from "./usageLedger";

const SCOPE = "camp-1";
const IN_FIGHT: UsageWindow = { sceneId: "sc1", encounterId: "en1", round: 3, turnId: "cb1" };
const ctx = (over: Partial<{ abilityId: string; characterId: string; window: UsageWindow; scopeValue: string }> = {}) => ({
  abilityId: "wte.genus.hail-rain",
  characterId: "ch1",
  window: IN_FIGHT,
  ...over,
});

const statusOf = (text: string, over: Parameters<typeof ctx>[0] = {}) =>
  usageStatus(parseUsageLimit(text), listUses(SCOPE), ctx(over));

const spend = (text: string, times: number, over: Parameters<typeof ctx>[0] = {}) => {
  for (let i = 0; i < times; i++) recordUse(SCOPE, parseUsageLimit(text), ctx(over));
};

beforeEach(() => __resetUsageLedger());

describe("which windows the app can actually see", () => {
  it("runs turns, rounds, encounters and scenes — and nothing else", () => {
    expect(["turn", "round", "encounter", "scene"].map(boundaryOf as never)).toEqual([
      "observed",
      "observed",
      "observed",
      "observed",
    ]);
    // The app has no rest, no Focus boundary, no SNR window, no downtime, no
    // day. Each of these is a rule the Curator owns, and claiming otherwise
    // would refill a player's abilities on a schedule the setting never wrote.
    expect(["short-rest", "long-rest", "synaptic-focus", "snr-window", "downtime", "day"].map(boundaryOf as never)).toEqual([
      "table",
      "table",
      "table",
      "table",
      "table",
      "table",
    ]);
  });

  it("separates one combatant's turn from another's inside the same round", () => {
    const mine = windowKey("turn", IN_FIGHT);
    const theirs = windowKey("turn", { ...IN_FIGHT, turnId: "cb2" });
    expect(mine).not.toBe(theirs);
    // Both still sit inside one round, so a per-round limit sees them as one.
    expect(windowKey("round", IN_FIGHT)).toBe(windowKey("round", { ...IN_FIGHT, turnId: "cb2" }));
  });

  it("refuses to count against a window that is not running", () => {
    expect(windowKey("encounter", { sceneId: "sc1" })).toBeNull();
    expect(windowKey("round", { encounterId: "en1" })).toBeNull();
    // The abilities panel opens with no scene loaded. A "once per scene" limit
    // keyed on the absent id would have put every such ability, on every
    // character, into one shared bucket named after nothing.
    expect(windowKey("scene", { encounterId: "en1" })).toBeNull();
    expect(windowKey("turn", { ...IN_FIGHT, turnId: null })).toBeNull();
    // A table period is always countable — the bucket is manual, so there is
    // no "not running" state for it to be in.
    expect(windowKey("short-rest", {})).toBe("table:short-rest");
  });
});

describe("counting uses", () => {
  it("counts up to the printed allowance and reports what is left", () => {
    expect(statusOf("Three times per encounter")).toMatchObject({ tracked: true, used: 0, remaining: 3 });
    spend("Three times per encounter", 2);
    expect(statusOf("Three times per encounter")).toMatchObject({ used: 2, remaining: 1, exhausted: false });
    expect(usageLabel(statusOf("Three times per encounter"))).toBe("2 of 3 used");
  });

  it("refills by itself when an observed window turns over", () => {
    spend("Once per round", 1);
    expect(statusOf("Once per round")).toMatchObject({ used: 1, exhausted: true });
    // Next round is a different key, so the same entries simply do not match.
    expect(statusOf("Once per round", { window: { ...IN_FIGHT, round: 4 } })).toMatchObject({ used: 0, exhausted: false });
  });

  it("keeps one character's spend off another's sheet", () => {
    spend("Once per encounter", 1);
    expect(statusOf("Once per encounter", { characterId: "ch2" })).toMatchObject({ used: 0 });
  });

  it("keeps one ability's spend off another's", () => {
    spend("Once per encounter", 1);
    expect(statusOf("Once per encounter", { abilityId: "wte.genus.other" })).toMatchObject({ used: 0 });
  });

  it("counts a keyed limit separately per key, which is the whole point of one", () => {
    // "Once per target per encounter" is not one use per encounter. Ignoring
    // the key would exhaust the ability on its second target.
    const limit = "Once per target per encounter";
    spend(limit, 1, { scopeValue: "tok-a" });
    expect(statusOf(limit, { scopeValue: "tok-a" })).toMatchObject({ used: 1, exhausted: true });
    expect(statusOf(limit, { scopeValue: "tok-b" })).toMatchObject({ used: 0, exhausted: false });
  });
});

describe("what the app refuses to count", () => {
  it("reports a keyed limit rather than counting it as if the key did not exist", () => {
    const status = statusOf("Once per target per encounter");
    expect(status.tracked).toBe(false);
    expect(status.untracked).toContain("per target");
    expect(recordUse(SCOPE, parseUsageLimit("Once per target per encounter"), ctx())).toBeNull();
    expect(listUses(SCOPE)).toHaveLength(0);
  });

  it("reports a multi-period window instead of inventing where it starts", () => {
    // "Once per 4 rounds" never says which round the window opens on. Aligning
    // it to round 1 would be the app writing the rule the page left out.
    expect(statusOf("Once per 4 rounds")).toMatchObject({ tracked: false });
    expect(statusOf("Once per 4 rounds").untracked).toContain("no declared start");
  });

  it("reports that nothing is running rather than counting against the wrong window", () => {
    const status = statusOf("Once per encounter", { window: { sceneId: "sc1" } });
    expect(status).toMatchObject({ tracked: false, allowed: 1 });
    expect(status.untracked).toContain("No encounter is running");
  });

  it("counts nothing for a cap or a budget, which are not use counts", () => {
    for (const text of ["One active Link at a time", "Unlimited within SS budget", "Maximum 3 charges at a time"]) {
      expect(statusOf(text)).toMatchObject({ tracked: false, allowed: null, clause: null });
    }
  });

  it("counts nothing for an ability with no authored limit", () => {
    expect(usageStatus(null, listUses(SCOPE), ctx())).toMatchObject({ tracked: false, allowed: null });
  });
});

describe("periods only the table can close", () => {
  it("counts a short rest under one manual bucket and says whose call the reset is", () => {
    spend("Twice per short rest", 2);
    const status = statusOf("Twice per short rest");
    expect(status).toMatchObject({ tracked: true, boundary: "table", used: 2, exhausted: true });
    expect(usageTitle(parseUsageLimit("Twice per short rest")!, status)).toContain("the table's call");
  });

  it("does not refill a table period when an observed one turns over", () => {
    // A new encounter is not a rest. If it cleared rest-limited abilities, the
    // app would have decided that fights include one — a rule nothing wrote.
    spend("Once per long rest", 1);
    expect(statusOf("Once per long rest", { window: { ...IN_FIGHT, encounterId: "en2" } })).toMatchObject({ used: 1 });
  });

  it("clears on the Curator's word, and only for the ability they cleared", () => {
    spend("Once per long rest", 1);
    spend("Once per long rest", 1, { abilityId: "wte.genus.other" });
    clearUses(SCOPE, { abilityId: "wte.genus.hail-rain", characterId: "ch1" });
    expect(statusOf("Once per long rest")).toMatchObject({ used: 0 });
    expect(statusOf("Once per long rest", { abilityId: "wte.genus.other" })).toMatchObject({ used: 1 });
  });
});

describe("exhaustion informs, it does not veto", () => {
  it("records a use past the printed limit instead of refusing it", () => {
    // A Curator overruling a limit is ordinary play. The ledger's job is to say
    // what happened, not to decide whether it was allowed.
    spend("Once per encounter", 3);
    const status = statusOf("Once per encounter");
    expect(status).toMatchObject({ used: 3, allowed: 1, remaining: 0, exhausted: true, over: 2 });
    expect(usageLabel(status)).toBe("3 of 1 used");
    expect(usageTitle(parseUsageLimit("Once per encounter")!, status)).toContain("2 uses past the printed limit");
  });

  it("shows the rider it could not read beside the count it could", () => {
    const limit = parseUsageLimit("Once per long rest; requires willing participant")!;
    const title = usageTitle(limit, usageStatus(limit, listUses(SCOPE), ctx()));
    expect(title).toContain("Not machine-readable: requires willing participant");
  });
});

describe("the store", () => {
  it("hands back a stable empty array, so a subscribed panel does not re-render forever", () => {
    expect(listUses("nobody")).toBe(listUses("nobody"));
  });

  it("tells its listeners when a use lands and when one is cleared", () => {
    let beats = 0;
    const stop = subscribeUses(SCOPE, () => beats++);
    spend("Once per encounter", 1);
    clearUses(SCOPE);
    stop();
    spend("Once per encounter", 1);
    expect(beats).toBe(2);
  });

  it("stays bounded when a session is left open", () => {
    // A long fight is a few dozen uses. The cap exists so a client left running
    // for days cannot grow this array without end; the oldest rows fall off,
    // which is why it is set far above any plausible night of play.
    spend("Once per encounter", 600);
    expect(listUses(SCOPE).length).toBeLessThanOrEqual(500);
    expect(listUses(SCOPE).length).toBeGreaterThan(400);
  });

  it("keeps one scope's uses out of another's", () => {
    spend("Once per encounter", 1);
    expect(usageStatus(parseUsageLimit("Once per encounter"), listUses("other-camp"), ctx())).toMatchObject({ used: 0 });
  });
});
