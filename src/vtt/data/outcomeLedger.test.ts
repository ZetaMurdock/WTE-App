import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import cipherData from "../../game/data/ciphers.json";
import genusData from "../../game/data/genus.json";
import { parseAbilityEffects, type EffectStep } from "../../game/abilityEffects";
import {
  armedConsequences,
  clearOutcomes,
  conditionTag,
  consequencesFromSteps,
  hpAfterConsequence,
  consequencesFor,
  damageAfterVerdict,
  declareVerdict,
  dismissOutcome,
  listOutcomes,
  markApplied,
  markOutcomeApplied,
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
  /** The `## Actions` block, for the pages that declare one. */
  actions?: string | null;
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

/** The declared block a shipped page carries, from the same data the app reads.
 *  A block invented in this file would prove the parser, never the corpus. */
function genusBlock(domain: string, name: string): string {
  const domains = genusData as unknown as Record<string, { abilities: CorpusAbility[] } | undefined>;
  const hit = domains[domain]?.abilities.find((ability) => ability.name === name);
  if (!hit?.actions) throw new Error(`genus.json no longer declares ${domain} / ${name}`);
  return hit.actions;
}

function cipherBlock(paradigm: string, name: string): string {
  const paradigms = cipherData as unknown as Record<string, CorpusAbility[] | undefined>;
  const hit = paradigms[paradigm]?.find((ability) => ability.name === name);
  if (!hit?.actions) throw new Error(`ciphers.json no longer declares ${paradigm} / ${name}`);
  return hit.actions;
}

/** Parse a block the way every surface does, refusing to test against one the
 *  grammar could not read: a step dropped as an authoring error would look
 *  exactly like a step this bridge chose to skip. */
function stepsOf(block: string): EffectStep[] {
  const read = parseAbilityEffects(block);
  expect(read.errors).toEqual([]);
  return read.steps;
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

  it("ignores a condition word used as ordinary description", () => {
    // The Stygian innate Locked in Time says a target's "Action Priority is
    // suppressed" — prose about a stat, not the Suppressed condition. A
    // case-blind scanner gave it a real chip.
    const innate = JSON.parse(
      readFileSync(new URL("../../game/data/speciesInnate.json", import.meta.url), "utf8")
    ) as Record<string, { name: string; effect: string }[]>;
    const locked = Object.values(innate).flat().find((a) => a.name === "Locked in Time");
    expect(locked?.effect).toMatch(/is suppressed/);
    expect(consequencesFor(locked!.effect).some((c) => c.condition === "Suppressed")).toBe(false);
    // The capitalised form is still read.
    expect(consequencesFor("The target is Suppressed for 2 rounds.")[0]).toMatchObject({
      condition: "Suppressed",
      rounds: 2,
    });
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

  it("never invents a Curator ruling out of any sentence in the corpus", () => {
    // The `ruling` kind is the one consequence that means "the engine has no
    // answer". Deriving one from prose would be the engine claiming authority
    // it does not have, on the exact card where authority matters most — and it
    // would do it silently, across 414 abilities at once. A sweep rather than a
    // sample: the guard has to hold for prose nobody thought to try.
    let scanned = 0;
    const sweep = (prose: string | null | undefined) => {
      if (!prose) return;
      scanned += 1;
      expect(consequencesFor(prose).some((c) => c.kind === "ruling")).toBe(false);
    };
    for (const entry of Object.values(genusData as unknown as Record<string, { abilities: CorpusAbility[] }>)) {
      for (const ability of entry.abilities) sweep(ability.effect);
    }
    for (const list of Object.values(cipherData as unknown as Record<string, CorpusAbility[]>)) {
      for (const ability of list) sweep(ability.effect);
    }
    expect(scanned).toBeGreaterThan(100);
  });
});

// ── The declared bridge ────────────────────────────────────────────────────
// `consequencesFromSteps` is the edge between a block an author wrote and the
// card a Curator clicks. Everything above it guesses; this reads. What it must
// never do is read MORE than the page said — a branch the author did not write,
// a ruling nobody declared, or the caster's own price landing on the target.

// "- Cost: 5 SS / - Save: Physical Save — Evasion / - Fail: Damage: 2d6 Cold /
//  - Fail: Condition: Slowed, 1 round / - Ruling: …" — a whole ability in five
// bullets, and the shape most declared pages are in.
const HAIL_RAIN_BLOCK = genusBlock("Elemental", "Hail Rain");
// Declares its damage on no branch at all, half on success, and the caster's
// own 1d4 backlash as a separate `Damage (self)` step.
const PSYCHIC_SCREAM_BLOCK = cipherBlock("cognition", "PSYCHIC SCREAM");
// Two `Modify (target)` steps with durations — the roll penalties.
const BLINDING_RADIANCE_BLOCK = genusBlock("Photonic", "Blinding Radiance");
// A ruling bound to the failure branch, with no dice anywhere in the block.
const DECISIVE_GRASP_BLOCK = genusBlock("Null", "Decisive Grasp");

describe("what a declared ability costs its target", () => {
  it("reads a shipped page's block from the markdown through to the card", () => {
    // The round trip the whole format rests on: the bullets a Curator can see
    // on the Codex page are the bullets genus.json ships, and those bullets are
    // what the card offers. A build step that reformatted the block on its way
    // into the data would break the first link and nothing else would notice.
    const page = readFileSync(new URL("../../rules/Elemental_Genus.md", import.meta.url), "utf8").replace(
      /\r\n/g,
      "\n"
    );
    const at = page.indexOf("\n### Hail Rain\n");
    if (at < 0) throw new Error("Elemental_Genus.md no longer carries ### Hail Rain");
    const next = page.indexOf("\n### ", at + 1);
    const section = page.slice(at, next < 0 ? undefined : next);
    const marker = section.indexOf("#### Actions");
    if (marker < 0) throw new Error("Hail Rain no longer declares an #### Actions block");

    const fromPage = section.slice(marker + "#### Actions".length);
    expect(stepsOf(fromPage)).toEqual(stepsOf(HAIL_RAIN_BLOCK));

    const derived = consequencesFromSteps(stepsOf(fromPage));
    expect(derived.map((c) => ({ id: c.id, kind: c.kind, on: c.on, label: c.label }))).toEqual([
      { id: "dmg-2", kind: "damage", on: "fail", label: "On fail · 2d6 Cold" },
      { id: "cond-3", kind: "condition", on: "fail", label: "On fail · Slowed · 1 round" },
      {
        id: "rule-4",
        kind: "ruling",
        on: "always",
        label:
          "the area becomes difficult terrain for 2 rounds after, and any creature that starts its turn in the cylinder repeats the Save",
      },
    ]);
    expect(derived[0]).toMatchObject({ expr: "2d6", damageType: "Cold" });
    expect(derived[1]).toMatchObject({ condition: "Slowed", rounds: 1 });
  });

  it("hangs each consequence on the branch the page wrote", () => {
    // The edge prose could never recover: which verdict arms which step.
    const derived = consequencesFromSteps(
      stepsOf(
        [
          "- Fail: Damage: 3d10 Cold",
          "- Success: Heal: 1d6",
          "- Condition: Burning, 2 rounds",
        ].join("\n")
      )
    );
    expect(derived.map((c) => c.on)).toEqual(["fail", "pass", "always"]);
  });

  it("skips the branches no phase resolves rather than treating them as failures", () => {
    // Min and tie are real in the corpus's vocabulary and unreal in the
    // resolution pipeline. Folding them into `fail` would apply damage on a
    // verdict the page never promised it on — and it would look correct.
    const block = [
      "- Fail: Damage: 3d10 Cold",
      "- Min: Damage: 1d10 Cold",
      "- Tie: Condition: Slowed, 1 round",
    ].join("\n");
    expect(stepsOf(block).map((s) => s.branch)).toEqual(["fail", "min", "tie"]);
    expect(consequencesFromSteps(stepsOf(block)).map((c) => c.id)).toEqual(["dmg-0"]);
  });

  it("carries the half-on-success rider the page declared", () => {
    const derived = consequencesFromSteps(stepsOf(PSYCHIC_SCREAM_BLOCK));
    const damage = derived.find((c) => c.kind === "damage")!;
    expect(damage).toMatchObject({ expr: "2d8", damageType: "Psychic", half: true, on: "always" });
  });

  it("leaves damage whole when the page promises nothing on a success", () => {
    // `half: undefined`, not `false` — the grammar only sets the flag when the
    // author writes ", half on success", and inventing `false` here would be a
    // second place that decides what silence means.
    expect(consequencesFromSteps(stepsOf(HAIL_RAIN_BLOCK))[0].half).toBeUndefined();
  });

  it("reads a declared heal as healing rather than as damage", () => {
    const derived = consequencesFromSteps(stepsOf("- Heal: 2d8"));
    expect(derived).toHaveLength(1);
    expect(derived[0]).toMatchObject({ id: "heal-0", kind: "heal", expr: "2d8", on: "always", label: "Heal 2d8" });
    expect(derived[0].damageType).toBeUndefined();
  });

  it("keeps the rounds a declared condition names", () => {
    expect(consequencesFromSteps(stepsOf("- Fail: Condition: Slowed, 2 rounds"))[0]).toMatchObject({
      kind: "condition",
      condition: "Slowed",
      rounds: 2,
    });
  });

  it("leaves a condition undated when the page gives it no rounds", () => {
    // Antheosis declares `Fail: Condition: Frightened` with no clock on it. A
    // duration invented here would print a countdown the page never wrote.
    const derived = consequencesFromSteps(stepsOf(genusBlock("Eldritch", "Antheosis")));
    expect(derived.find((c) => c.kind === "condition")).toMatchObject({
      condition: "Frightened",
      rounds: undefined,
      label: "On fail · Frightened",
    });
  });

  it("leaves a non-round duration off the pip rather than mislabelling it", () => {
    // A scene is a real duration and not a number of rounds. `rounds` is what
    // the tag prints, so filling it from a scene would put "(1)" on a pip that
    // lasts all encounter.
    const derived = consequencesFromSteps(stepsOf("- Fail: Condition: Blinded, scene"));
    expect(derived[0].rounds).toBeUndefined();
    expect(derived[0].label).toBe("On fail · Blinded · scene");
  });

  it("does not read a duration in minutes as that many rounds", () => {
    // The dangerous half of the same rule: `minutes` carries a `count` exactly
    // as `rounds` does, so a guard that read the count instead of the KIND would
    // pass every scene-duration test and still print "Blinded (10)" for ten
    // minutes — a countdown ten times shorter than the page wrote.
    const derived = consequencesFromSteps(stepsOf("- Fail: Condition: Blinded, 10 minutes"));
    expect(derived[0].rounds).toBeUndefined();
    expect(conditionTag(derived[0])).toBe("Blinded");
    expect(derived[0].label).toBe("On fail · Blinded · 10 min");
  });

  it("does not read a Modify in minutes as that many rounds either", () => {
    // Same guard, second copy of it — the Modify branch computes `rounds` on its
    // own line, so proving the Condition branch proves nothing about this one.
    const derived = consequencesFromSteps(
      stepsOf("- Fail: Modify (target): Disadvantage on Physical Check — Density, 10 minutes")
    );
    expect(derived[0].rounds).toBeUndefined();
    expect(conditionTag(derived[0])).toBe("Disadv: Physical Check — Density");
  });

  it("turns a declared roll penalty into a tag a table can see", () => {
    // A Modify is a condition as far as the token is concerned: the table wants
    // a pip saying which route is hobbled and for how long.
    const derived = consequencesFromSteps(stepsOf(BLINDING_RADIANCE_BLOCK));
    expect(derived.filter((c) => c.kind === "condition").map((c) => ({ id: c.id, condition: c.condition, rounds: c.rounds }))).toEqual([
      { id: "mod-3", condition: "Disadv: Mental Save — Perception", rounds: 2 },
      { id: "mod-4", condition: "Disadv: Physical Check — Density", rounds: 2 },
    ]);
    expect(conditionTag(derived.find((c) => c.id === "mod-3")!)).toBe("Disadv: Mental Save — Perception (2)");
  });

  it("names the direction a Modify moves the roll", () => {
    expect(consequencesFromSteps(stepsOf("- Modify (target): Advantage on Physical Check — Density"))[0]).toMatchObject({
      condition: "Adv: Physical Check — Density",
      rounds: undefined,
    });
  });

  it("emits a ruling because the page declared one, on the branch it declared it", () => {
    // The deriver never invents a ruling; an author may write one, and Decisive
    // Grasp writes its whole payload as one — bound to the failure branch.
    const derived = consequencesFromSteps(stepsOf(DECISIVE_GRASP_BLOCK));
    expect(derived).toHaveLength(1);
    expect(derived[0]).toMatchObject({ id: "rule-2", kind: "ruling", on: "fail" });
    expect(derived[0].label).toMatch(/^the target is completely immobilized for 2 rounds/);
    expect(derived[0].expr).toBeUndefined();
  });

  it("contributes nothing for the steps that resolve rather than land", () => {
    // Cost is the caster's price, and Roll and Save are the resolution the card
    // is waiting on — a card that offered them as consequences would ask the
    // Curator to apply the question rather than the answer.
    const block = [
      "- Cost: 5 SS",
      "- Roll: Mental Check — Capacity, DV 12",
      "- Save: Physical Save — Evasion, DV 18",
    ].join("\n");
    expect(stepsOf(block).map((s) => s.verb)).toEqual(["cost", "roll", "save"]);
    expect(consequencesFromSteps(stepsOf(block))).toEqual([]);
  });

  it("keeps the caster's own price off the target's card", () => {
    // PSYCHIC SCREAM declares `Damage (self): 1d4 Psychic` one bullet below the
    // 2d8 it deals. Both landing on a card bound to the target would charge them
    // for being screamed at — the same rule the prose deriver has always held.
    expect(PSYCHIC_SCREAM_BLOCK).toMatch(/Damage \(self\): 1d4/);
    const derived = consequencesFromSteps(stepsOf(PSYCHIC_SCREAM_BLOCK));
    expect(derived.some((c) => c.expr === "1d4")).toBe(false);
    expect(derived.map((c) => c.id)).toEqual(["dmg-2", "cond-3", "rule-5"]);
  });

  it("proposes nothing for a block with no steps at all", () => {
    expect(consequencesFromSteps([])).toEqual([]);
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

describe("a declared block supersedes the prose deriver", () => {
  /** The same outcome, opened with and without the ability's declared steps. */
  function opened(steps?: readonly EffectStep[] | null) {
    return openOutcome({
      id: "o-precedence",
      sourceAbilityId: "wte.cipher.psychic-scream",
      sourceAbilityName: "PSYCHIC SCREAM",
      effect: PSYCHIC_SCREAM,
      targetName: "Kira",
      rollLabel: "Mental Save — Influence",
      now: 1_000,
      steps,
    });
  }

  it("reads the block and does not also read the prose beside it", () => {
    // PSYCHIC SCREAM's prose and its block describe the SAME 2d8 and the SAME
    // Stunned. Letting both answer puts two damage buttons on one card, and a
    // table applies 4d8 to a target the page charged 2d8.
    const declared = opened(stepsOf(PSYCHIC_SCREAM_BLOCK));
    expect(declared.consequences).toEqual(consequencesFromSteps(stepsOf(PSYCHIC_SCREAM_BLOCK)));
    expect(declared.consequences.filter((c) => c.kind === "damage")).toHaveLength(1);
    // The prose deriver has no ruling to give; the block does, so its presence
    // is proof of which reader answered.
    expect(declared.consequences.some((c) => c.kind === "ruling")).toBe(true);
    expect(consequencesFor(PSYCHIC_SCREAM).some((c) => c.kind === "ruling")).toBe(false);
  });

  it("takes the branch from the block even where the prose disagrees", () => {
    // The prose says "or takes 2d8", which the deriver can only read as a
    // failure. The block declares that damage on no branch at all — it happens,
    // half on a success. Superseding is the difference between those readings.
    expect(consequencesFor(PSYCHIC_SCREAM)[0].on).toBe("fail");
    expect(opened(stepsOf(PSYCHIC_SCREAM_BLOCK)).consequences[0].on).toBe("always");
  });

  it("reads the prose exactly as before when the page declares nothing", () => {
    // The invariant the whole arc rests on: an ability with no block behaves
    // byte for byte as it did before the bridge existed. Absent, null and empty
    // are all the same silence — an empty array is what a page with an
    // unreadable block hands over, and it must not blank the card.
    const prose = consequencesFor(PSYCHIC_SCREAM);
    for (const steps of [undefined, null, [] as EffectStep[]]) {
      expect(opened(steps).consequences).toEqual(prose);
    }
  });

  it("changes nothing else about the outcome it opened", () => {
    // Superseding is about the consequences and nothing more: the same card,
    // the same window, the same pending verdict either way.
    //
    // `fromBlock` is the one exception, and it is not an exception at all: it
    // records WHICH of the two sides opened this card, so the surfaces that
    // must tell them apart can. Comparing it here would only assert that the
    // flag does not work.
    const declared = opened(stepsOf(PSYCHIC_SCREAM_BLOCK));
    const derived = opened();
    expect(declared.fromBlock).toBe(true);
    expect(derived.fromBlock).toBe(false);
    const shape = (outcome: PendingOutcome) => ({ ...outcome, consequences: [], fromBlock: false });
    expect(shape(declared)).toEqual(shape(derived));
  });

  it("still supersedes with a block that declares no consequences at all", () => {
    // A block of nothing but Cost and Save yields an empty card, and that is
    // the honest answer: the author said what happens, and none of it lands on
    // the target. Falling back to the prose here would let the deriver overrule
    // a page that had already spoken.
    const steps = stepsOf("- Cost: 50 SS\n- Save: Mental Save — Influence, DV 14");
    expect(steps).toHaveLength(2);
    expect(opened(steps).consequences).toEqual([]);
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

  // Two consequences committed from ONE snapshot — which is what auto-apply
  // does, and what a Curator clicking twice never does, because a re-render puts
  // a fresh card in their hands between the clicks. Folding the second id into
  // the stale snapshot would put back a card that had forgotten the first, and
  // the forgotten row comes back armed with its roll still on screen.
  it("accumulates applied marks even when the caller holds a stale card", () => {
    const stale = open({ id: "a" });
    pushOutcome("table", stale);
    markOutcomeApplied("table", "a", "dmg-0");
    markOutcomeApplied("table", "a", "cond-1");
    expect(stale.applied).toEqual([]);
    expect(listOutcomes("table")[0].applied).toEqual(["dmg-0", "cond-1"]);
  });

  it("ignores a mark for a card that is already gone, and one already made", () => {
    pushOutcome("table", open({ id: "a" }));
    markOutcomeApplied("table", "ghost", "dmg-0");
    markOutcomeApplied("table", "a", "dmg-0");
    const once = listOutcomes("table")[0];
    markOutcomeApplied("table", "a", "dmg-0");
    expect(listOutcomes("table")[0]).toBe(once);
    expect(once.applied).toEqual(["dmg-0"]);
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
