import { beforeEach, describe, expect, it } from "vitest";
import cipherData from "../../game/data/ciphers.json";
import genusData from "../../game/data/genus.json";
import {
  armedConsequences,
  clearOutcomes,
  conditionTag,
  hpAfterConsequence,
  consequencesFor,
  damageAfterVerdict,
  declareVerdict,
  dismissOutcome,
  listOutcomes,
  markApplied,
  openOutcome,
  pruneOutcomes,
  pushOutcome,
  replaceOutcome,
  settleByRequest,
  settleOutcome,
  subscribeOutcomes,
  __resetOutcomeLedger,
  type OutcomeConsequence,
  type PendingOutcome,
} from "./outcomeLedger";

interface CorpusAbility {
  name: string;
  effect?: string | null;
}

// Prose comes out of the SHIPPED corpus, never out of this file. A deriver
// proven against invented sentences proves nothing: the whole claim is that it
// reads pages the app already carries. A missing ability throws by name, so a
// domain rework that rewrites one of these fails loudly here instead of quietly
// leaving the ledger tested against prose nobody plays with.
function genusEffect(domain: string, name: string): string {
  const domains = genusData as unknown as Record<string, { abilities: CorpusAbility[] } | undefined>;
  const hit = domains[domain]?.abilities.find((ability) => ability.name === name);
  if (!hit?.effect) throw new Error(`genus.json no longer ships ${domain} / ${name}`);
  return hit.effect;
}

function cipherEffect(paradigm: string, name: string): string {
  const paradigms = cipherData as unknown as Record<string, CorpusAbility[] | undefined>;
  const hit = paradigms[paradigm]?.find((ability) => ability.name === name);
  if (!hit?.effect) throw new Error(`ciphers.json no longer ships ${paradigm} / ${name}`);
  return hit.effect;
}

// "...or take 2d8 psychic damage and are Stunned for 1 round. On success: half
// damage, not Stunned." — damage, condition and the half rider in one cipher.
// It also costs the caster "1d4 psychic backlash damage regardless", which is
// why this ability guards the self-cost rule: an outcome speaks for the target,
// so the 1d4 the Inquisitor owes must never reach the target's card.
const PSYCHIC_SCREAM = cipherEffect("cognition", "PSYCHIC SCREAM");
// "...or takes 2d6 cold damage and is Slowed (movement halved) for 1 round."
const HAIL_RAIN = genusEffect("Elemental", "Hail Rain");
// "...or takes 1d6 Eldritch damage." — damage with nothing else attached.
const PASSIVE_DEATH = genusEffect("Eldritch", "Passive Death");
// "...or become Disoriented for 2 rounds." — a condition with no dice at all.
const REALITY_BREAK = genusEffect("Null", "Reality Break");
// "Target is Restrained" — a condition the prose never puts a clock on.
const LOCK_MOVE = genusEffect("Photonic", "Lock Move");
// "...against a d40 Dice Value" — the DV that must not become a damage die.
const BLINDING_RADIANCE = genusEffect("Photonic", "Blinding Radiance");
const LUMINANCE_OVERLOAD = genusEffect("Photonic", "Luminance Overload");
// A DV-gated Check whose payload is a transformation no parser can type.
const INVERSE_REVERSE = genusEffect("Eldritch", "Inverse Reverse");

describe("what an ability costs its target", () => {
  it("reads the damage, its type and the condition out of one cipher's prose", () => {
    const derived = consequencesFor(PSYCHIC_SCREAM);
    expect(derived.map((c) => c.id)).toEqual(["dmg-0", "cond-stunned"]);
  });
  it("leaves the caster's own price off the target's card", () => {
    // PSYCHIC SCREAM deals 2d8 to the target and costs the Inquisitor 1d4
    // backlash in the same effect. A card bound to the target that listed both
    // would charge them for being attacked.
    expect(PSYCHIC_SCREAM).toMatch(/1d4/);
    expect(consequencesFor(PSYCHIC_SCREAM).some((c) => c.expr === "1d4")).toBe(false);
  });

  it("reads restorative dice as healing rather than damage", () => {
    const derived = consequencesFor("The target heals 2d8 HP at the start of their turn.");
    expect(derived.map((c) => ({ kind: c.kind, on: c.on }))).toEqual([{ kind: "heal", on: "always" }]);
  });

  it("still reads damage in a clause that merely mentions the caster", () => {
    // "of you" names the acting character without making them the one taking
    // the dice — the self-cost window is verb-adjacent for exactly this case.
    const derived = consequencesFor("Creatures within 10 ft of you take 2d6 Fire damage.");
    expect(derived.map((c) => c.expr)).toEqual(["2d6"]);
  });

  it("types the damage and the condition it derived", () => {
    const derived = consequencesFor(PSYCHIC_SCREAM);
    expect(derived[0]).toMatchObject({
      kind: "damage",
      label: "2d8 Psychic",
      expr: "2d8",
      damageType: "Psychic",
      on: "fail",
    });
    expect(derived[1]).toMatchObject({
      kind: "condition",
      label: "Stunned · 1 round",
      condition: "Stunned",
      rounds: 1,
      on: "fail",
    });
  });

  it("marks damage as halved when the prose promises half on a success", () => {
    expect(consequencesFor(PSYCHIC_SCREAM).every((c) => c.kind !== "damage" || c.half)).toBe(true);
  });

  it("leaves damage whole when the prose promises nothing on a success", () => {
    const derived = consequencesFor(HAIL_RAIN);
    expect(derived.map((c) => c.id)).toEqual(["dmg-0", "cond-slowed"]);
    expect(derived[0]).toMatchObject({ expr: "2d6", damageType: "Cold", half: false });
    expect(derived[1]).toMatchObject({ condition: "Slowed", rounds: 1 });
  });

  it("derives damage alone from prose that inflicts nothing else", () => {
    const derived = consequencesFor(PASSIVE_DEATH);
    expect(derived).toHaveLength(1);
    expect(derived[0]).toMatchObject({ kind: "damage", expr: "1d6", damageType: "Eldritch" });
  });

  it("derives a condition alone from prose that deals no damage", () => {
    const derived = consequencesFor(REALITY_BREAK);
    expect(derived).toHaveLength(1);
    expect(derived[0]).toMatchObject({
      kind: "condition",
      condition: "Disoriented",
      rounds: 2,
      label: "Disoriented · 2 rounds",
    });
  });

  it("leaves a condition undated when the prose gives it no rounds", () => {
    expect(consequencesFor(LOCK_MOVE)).toEqual([
      {
        id: "cond-restrained",
        kind: "condition",
        label: "Restrained",
        on: "fail",
        condition: "Restrained",
        rounds: undefined,
      },
    ]);
  });

  it("never turns a rolled Dice Value into a damage die", () => {
    // "against a d40 Dice Value" is the gate the save rolls against. Without the
    // dmTail guard in parseAbilityActions every rolled DV also armed a phantom
    // d40 damage button — the card would offer a Curator dice nobody wrote.
    for (const prose of [BLINDING_RADIANCE, LUMINANCE_OVERLOAD]) {
      const dice = consequencesFor(prose).filter((c) => c.kind === "damage").map((c) => c.expr);
      expect(dice).toContain("1d10");
      expect(dice).not.toContain("1d40");
    }
  });

  it("proposes nothing for a payload no parser can type", () => {
    // Inverting an active ability is a Curator adjudication, and the deriver
    // stays silent rather than inventing a number for it.
    expect(consequencesFor(INVERSE_REVERSE)).toEqual([]);
  });

  it("proposes nothing for prose that is absent or blank", () => {
    expect(consequencesFor("")).toEqual([]);
    expect(consequencesFor("   \n  ")).toEqual([]);
    expect(consequencesFor(null)).toEqual([]);
    expect(consequencesFor(undefined)).toEqual([]);
  });
});

function open(over: Partial<PendingOutcome> = {}): PendingOutcome {
  return {
    ...openOutcome({
      id: "o1",
      requestId: "req-1",
      sourceAbilityId: "wte.cipher.psychic-scream",
      sourceAbilityName: "PSYCHIC SCREAM",
      effect: PSYCHIC_SCREAM,
      casterCharacterId: "char-ash",
      targetTokenId: "tok-kira",
      targetName: "Kira",
      dc: 14,
      rollLabel: "Mental Save — Influence",
      now: 1_000,
    }),
    ...over,
  };
}

describe("opening an outcome", () => {
  it("starts pending, with nothing applied and the prose already read", () => {
    const outcome = open();
    expect(outcome.verdict).toBe("pending");
    expect(outcome.applied).toEqual([]);
    expect(outcome.rollTotal).toBeUndefined();
    expect(outcome.consequences.map((c) => c.id)).toEqual(["dmg-0", "cond-stunned"]);
  });

  it("expires with the roll-request window unless the caller names its own", () => {
    expect(open().expiresAt).toBe(1_000 + 5 * 60_000);
    expect(
      openOutcome({
        id: "o2",
        sourceAbilityId: "a",
        sourceAbilityName: "A",
        targetName: "Kira",
        rollLabel: "Physical Save — Evasion",
        now: 1_000,
        ttlMs: 250,
      }).expiresAt
    ).toBe(1_250);
  });
});

describe("settling against the DV", () => {
  it("counts meeting the DV as a pass, the same >= the save chip prints", () => {
    expect(settleOutcome(open({ dc: 14 }), 14)).toMatchObject({ verdict: "pass", rollTotal: 14 });
  });

  it("counts falling one short as a fail", () => {
    expect(settleOutcome(open({ dc: 14 }), 13)).toMatchObject({ verdict: "fail", rollTotal: 13 });
  });

  it("records the roll but leaves the verdict alone when there is no DV", () => {
    const settled = settleOutcome(open({ dc: undefined }), 31);
    expect(settled.verdict).toBe("pending");
    expect(settled.rollTotal).toBe(31);
  });

  it("lets a Curator declare the verdict a roll could not decide", () => {
    const settled = settleOutcome(open({ dc: undefined }), 31);
    expect(declareVerdict(settled, "fail")).toMatchObject({ verdict: "fail", rollTotal: 31 });
  });
});

describe("what a verdict arms", () => {
  it("arms nothing while the roll has not arrived", () => {
    expect(armedConsequences(open())).toEqual([]);
  });

  it("arms every failure consequence on a fail", () => {
    expect(armedConsequences(settleOutcome(open(), 9)).map((c) => c.id)).toEqual(["dmg-0", "cond-stunned"]);
  });

  it("drops the condition on a pass but keeps the dice — 'half damage, not Stunned'", () => {
    expect(armedConsequences(settleOutcome(open(), 20)).map((c) => c.id)).toEqual(["dmg-0"]);
  });

  it("arms nothing on a pass when the prose offered no half", () => {
    const passed = settleOutcome(open({ consequences: consequencesFor(HAIL_RAIN) }), 20);
    expect(armedConsequences(passed)).toEqual([]);
  });

  it("arms an always-on consequence under either verdict", () => {
    const backlash: OutcomeConsequence = {
      id: "always-1",
      kind: "damage",
      label: "1d4 Psychic",
      on: "always",
      expr: "1d4",
    };
    const outcome = open({ consequences: [backlash] });
    expect(armedConsequences(settleOutcome(outcome, 20)).map((c) => c.id)).toEqual(["always-1"]);
    expect(armedConsequences(settleOutcome(outcome, 3)).map((c) => c.id)).toEqual(["always-1"]);
  });
});

describe("damage after the verdict", () => {
  const half = consequencesFor(PSYCHIC_SCREAM)[0];
  const whole = consequencesFor(HAIL_RAIN)[0];

  it("rounds a halved hit DOWN on a pass", () => {
    expect(damageAfterVerdict(settleOutcome(open(), 20), half, 7)).toBe(3);
    expect(damageAfterVerdict(settleOutcome(open(), 20), half, 8)).toBe(4);
  });

  it("takes the whole hit on a fail even when a half rider exists", () => {
    expect(damageAfterVerdict(settleOutcome(open(), 9), half, 7)).toBe(7);
  });

  it("takes the whole hit either way when the prose named no half", () => {
    expect(damageAfterVerdict(settleOutcome(open(), 20), whole, 7)).toBe(7);
    expect(damageAfterVerdict(settleOutcome(open(), 9), whole, 7)).toBe(7);
  });
});

describe("where HP lands", () => {
  it("subtracts damage and stops at zero", () => {
    expect(hpAfterConsequence(30, 40, 12)).toBe(18);
    expect(hpAfterConsequence(5, 40, 12)).toBe(0);
  });

  it("adds healing but never past the maximum the sheet granted", () => {
    expect(hpAfterConsequence(20, 40, -12)).toBe(32);
    expect(hpAfterConsequence(38, 40, -12)).toBe(40);
  });

  it("heals without a ceiling when the token tracks no maximum", () => {
    expect(hpAfterConsequence(20, undefined, -12)).toBe(32);
  });
});

describe("committing a consequence", () => {
  it("records the commit once, so re-applying takes a deliberate act", () => {
    const applied = markApplied(open(), "dmg-0");
    expect(applied.applied).toEqual(["dmg-0"]);
    // The same object back: a card re-rendering must not read as a second hit.
    expect(markApplied(applied, "dmg-0")).toBe(applied);
    expect(markApplied(applied, "cond-stunned").applied).toEqual(["dmg-0", "cond-stunned"]);
  });

  it("writes a condition pip that carries its own duration", () => {
    expect(conditionTag(consequencesFor(PSYCHIC_SCREAM)[1])).toBe("Stunned (1)");
    expect(conditionTag(consequencesFor(LOCK_MOVE)[0])).toBe("Restrained");
    expect(conditionTag(consequencesFor(HAIL_RAIN)[0])).toBe("");
  });
});

describe("the outcome ledger store", () => {
  beforeEach(() => __resetOutcomeLedger());

  it("lists the card the Curator just caused first", () => {
    pushOutcome("table", open({ id: "a" }));
    pushOutcome("table", open({ id: "b" }));
    expect(listOutcomes("table").map((o) => o.id)).toEqual(["b", "a"]);
  });

  it("moves a re-pushed card to the front rather than stacking a duplicate", () => {
    pushOutcome("table", open({ id: "a" }));
    pushOutcome("table", open({ id: "b" }));
    pushOutcome("table", open({ id: "a", targetName: "Vex" }));
    expect(listOutcomes("table").map((o) => o.id)).toEqual(["a", "b"]);
    expect(listOutcomes("table")[0].targetName).toBe("Vex");
  });

  it("replaces a card in place, leaving the order alone", () => {
    pushOutcome("table", open({ id: "a" }));
    pushOutcome("table", open({ id: "b" }));
    replaceOutcome("table", markApplied(open({ id: "a" }), "dmg-0"));
    expect(listOutcomes("table").map((o) => o.id)).toEqual(["b", "a"]);
    expect(listOutcomes("table")[1].applied).toEqual(["dmg-0"]);
  });

  it("ignores a replace for a card that is already gone", () => {
    pushOutcome("table", open({ id: "a" }));
    replaceOutcome("table", open({ id: "ghost" }));
    expect(listOutcomes("table").map((o) => o.id)).toEqual(["a"]);
  });

  it("dismisses one card and leaves the rest", () => {
    pushOutcome("table", open({ id: "a" }));
    pushOutcome("table", open({ id: "b" }));
    dismissOutcome("table", "a");
    expect(listOutcomes("table").map((o) => o.id)).toEqual(["b"]);
  });

  it("keeps at most 24 open cards, dropping the oldest", () => {
    for (let i = 0; i < 30; i++) pushOutcome("table", open({ id: `o${i}` }));
    const ids = listOutcomes("table").map((o) => o.id);
    expect(ids).toHaveLength(24);
    expect(ids[0]).toBe("o29");
    expect(ids[23]).toBe("o6");
  });

  it("settles the card the request id names", () => {
    pushOutcome("table", open({ id: "a", requestId: "req-a" }));
    pushOutcome("table", open({ id: "b", requestId: "req-b" }));
    expect(settleByRequest("table", "req-b", 20)).toMatchObject({ id: "b", verdict: "pass", rollTotal: 20 });
    expect(listOutcomes("table").find((o) => o.id === "b")?.verdict).toBe("pass");
    expect(listOutcomes("table").find((o) => o.id === "a")?.verdict).toBe("pending");
  });

  it("returns null for a request nobody opened a card for", () => {
    pushOutcome("table", open({ id: "a", requestId: "req-a" }));
    expect(settleByRequest("table", "req-nobody", 20)).toBeNull();
  });

  it("prunes cards whose roll never came but keeps every settled one", () => {
    pushOutcome("table", open({ id: "stale", expiresAt: 10 }));
    pushOutcome("table", settleOutcome(open({ id: "settled", expiresAt: 10 }), 20));
    pushOutcome("table", open({ id: "live", expiresAt: 9_000 }));
    pruneOutcomes("table", 5_000);
    expect(listOutcomes("table").map((o) => o.id)).toEqual(["live", "settled"]);
  });

  it("keeps a card past its expiry once the roll landed, DV or no DV", () => {
    // A DV-less outcome stays `pending` until a Curator rules on it. Expiring it
    // would take that ruling away from them and call the silence an answer.
    pushOutcome("table", settleOutcome(open({ id: "ruling", dc: undefined, expiresAt: 10 }), 22));
    pruneOutcomes("table", 5_000);
    expect(listOutcomes("table").map((o) => o.id)).toEqual(["ruling"]);
    expect(listOutcomes("table", 5_000).map((o) => o.id)).toEqual(["ruling"]);
  });

  it("hides an expired pending card from a time-filtered list without dropping it", () => {
    pushOutcome("table", open({ id: "stale", expiresAt: 10 }));
    expect(listOutcomes("table", 5_000)).toEqual([]);
    expect(listOutcomes("table")).toHaveLength(1);
  });

  it("notifies subscribers on every mutation and stops after unsubscribe", () => {
    let n = 0;
    const off = subscribeOutcomes("table", () => n++);
    pushOutcome("table", open({ id: "a", requestId: "req-a" }));
    expect(n).toBe(1);
    settleByRequest("table", "req-a", 20);
    expect(n).toBe(2);
    dismissOutcome("table", "a");
    expect(n).toBe(3);
    off();
    pushOutcome("table", open({ id: "b" }));
    expect(n).toBe(3);
  });

  it("stays quiet when a dismiss or a prune changes nothing", () => {
    let n = 0;
    subscribeOutcomes("table", () => n++);
    pushOutcome("table", open({ id: "a", expiresAt: 9_000 }));
    dismissOutcome("table", "ghost");
    pruneOutcomes("table", 1_000);
    expect(n).toBe(1);
  });

  it("keeps two tables from ever seeing each other's cards", () => {
    let mine = 0;
    subscribeOutcomes("table-a", () => mine++);
    pushOutcome("table-a", open({ id: "a" }));
    pushOutcome("table-b", open({ id: "b" }));
    expect(listOutcomes("table-a").map((o) => o.id)).toEqual(["a"]);
    expect(listOutcomes("table-b").map((o) => o.id)).toEqual(["b"]);
    dismissOutcome("table-b", "b");
    expect(listOutcomes("table-a").map((o) => o.id)).toEqual(["a"]);
    expect(mine).toBe(1); // table-b's traffic never reached table-a's listener
  });

  it("forgets a scope the table has left, settled cards included", () => {
    // A settled card never expires, so only an explicit clear stops last
    // session's "apply 27 damage" from being offered against today's HP.
    let n = 0;
    subscribeOutcomes("table", () => n++);
    pushOutcome("table", settleOutcome(open({ id: "done" }), 20));
    pushOutcome("table-b", open({ id: "other" }));
    clearOutcomes("table");
    expect(listOutcomes("table")).toEqual([]);
    expect(listOutcomes("table-b").map((o) => o.id)).toEqual(["other"]);
    expect(n).toBe(2); // the push, then the clear

    clearOutcomes("table");
    expect(n).toBe(2); // clearing an empty scope tells nobody anything
  });

  it("hands back a stable list reference when nothing changed", () => {
    // useSyncExternalStore compares snapshots by identity: a fresh array per
    // read is an infinite render loop, not a cosmetic waste.
    expect(listOutcomes("empty")).toBe(listOutcomes("empty"));
    expect(listOutcomes("empty", 5_000)).toBe(listOutcomes("empty"));
    // Every unknown scope shares this one array, so a caller that pushed into a
    // result would seed phantom cards into tables it never touched.
    expect(Object.isFrozen(listOutcomes("empty"))).toBe(true);
    pushOutcome("table", open({ id: "a", expiresAt: 9_000 }));
    expect(listOutcomes("table", 1_000)).toBe(listOutcomes("table"));
  });
});
