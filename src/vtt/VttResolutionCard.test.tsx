// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import cipherData from "../game/data/ciphers.json";
import genusData from "../game/data/genus.json";
import { VttResolutionCard, type VttResolutionCardProps } from "./VttResolutionCard";
import { parseAbilityEffects, type EffectStep } from "../game/abilityEffects";
import {
  batchPlan,
  lapsePendingTargets,
  markTargetApplied,
  markTargetRemoved,
  openOutcome,
  settleTarget,
  type OutcomeConsequence,
  type PendingOutcome,
} from "./data/outcomeLedger";

interface CorpusAbility {
  name: string;
  effect?: string | null;
  /** The `## Actions` block, for the pages that declare one. */
  actions?: string | null;
}

// Prose comes out of the shipped corpus, never out of this file. The card's
// whole claim is that it offers what the pages the app already carries say a
// miss costs; a card proven against invented sentences proves only that the
// invented sentences parse. A missing ability throws by name, so a domain
// rework that rewrites one of these fails here instead of quietly leaving the
// card tested against prose nobody plays with.
function genusAbility(domain: string, name: string): CorpusAbility {
  const domains = genusData as unknown as Record<string, { abilities: CorpusAbility[] } | undefined>;
  const hit = domains[domain]?.abilities.find((ability) => ability.name === name);
  if (!hit?.effect) throw new Error(`genus.json no longer ships ${domain} / ${name}`);
  return hit;
}

function cipherAbility(paradigm: string, name: string): CorpusAbility {
  const paradigms = cipherData as unknown as Record<string, CorpusAbility[] | undefined>;
  const hit = paradigms[paradigm]?.find((ability) => ability.name === name);
  if (!hit?.effect) throw new Error(`ciphers.json no longer ships ${paradigm} / ${name}`);
  return hit;
}

// "...2d8 psychic damage and are Stunned for 1 round. On success: half damage,
// not Stunned." — damage, a condition and the half rider on one card.
const PSYCHIC_SCREAM = cipherAbility("cognition", "PSYCHIC SCREAM");
// "...or takes 2d6 cold damage and is Slowed ... for 1 round." — no half rider.
const HAIL_RAIN = genusAbility("Elemental", "Hail Rain");
// "...or takes 1d6 Eldritch damage." — damage with nothing else attached.
const PASSIVE_DEATH = genusAbility("Eldritch", "Passive Death");
// "Target is Restrained" — a condition the prose never puts a clock on.
const LOCK_MOVE = genusAbility("Photonic", "Lock Move");
const ECHO_CHAIN = cipherAbility("remnant", "ECHO CHAIN");
// A DV-gated Check whose payload is a transformation no parser can type, so the
// prose deriver honestly proposes nothing at all.
const INVERSE_REVERSE = genusAbility("Eldritch", "Inverse Reverse");

/** The same corpus read through its DECLARED block instead of its prose. The
 *  block has to come off the shipped page too: a card proven against a block
 *  written in this file would prove the parser and nothing about the pages. */
function declaredOutcome(ability: CorpusAbility, overrides: Partial<PendingOutcome> = {}): PendingOutcome {
  return outcome(ability, overrides, declaredSteps(ability));
}

/** The shipped page's own `## Actions` block. Auto-apply only ever commits what
 *  a page declared, so a batch proving anything about it has to be built from
 *  one of these rather than from prose. */
function declaredSteps(ability: CorpusAbility): readonly EffectStep[] {
  if (!ability.actions) throw new Error(`${ability.name} no longer declares an ## Actions block`);
  const read = parseAbilityEffects(ability.actions);
  expect(read.errors).toEqual([]);
  return read.steps;
}

// Steps go in through `openOutcome` rather than being pasted over its answer:
// which source wins, and what the card is then told it was reading, is the
// ledger's decision, and a test that overwrote `consequences` by hand would
// prove the card against a card the app can never open.
function outcome(
  ability: CorpusAbility,
  overrides: Partial<PendingOutcome> = {},
  steps?: readonly EffectStep[]
): PendingOutcome {
  return {
    ...openOutcome({
      id: "out-1",
      sourceAbilityId: `ability-${ability.name}`,
      sourceAbilityName: ability.name,
      targets: [{ tokenId: "token-kira", name: "Kira" }],
      dc: 18,
      rollLabel: "Mental Save — Influence",
      effect: ability.effect,
      steps,
      now: 1_000,
    }),
    ...overrides,
  };
}

/** The same card resolving against many bodies. Names, not tokens, because what
 *  the batch chrome has to get right is the counting and the ordering — whose
 *  token id is whose is `VttScreen`'s problem and is tested there. */
function batch(
  ability: CorpusAbility,
  names: readonly string[],
  overrides: Partial<PendingOutcome> = {},
  steps?: readonly EffectStep[]
): PendingOutcome {
  return {
    ...openOutcome({
      id: "out-1",
      sourceAbilityId: `ability-${ability.name}`,
      sourceAbilityName: ability.name,
      targets: names.map((name) => ({ tokenId: `token-${name}`, name, requestId: `req-${name}` })),
      dc: 18,
      rollLabel: "Physical Save — Recovery",
      effect: ability.effect,
      steps,
      now: 1_000,
    }),
    ...overrides,
  };
}

/** Settle the sole target of a degenerate card — a batch of one. */
function settleOne(outcome: PendingOutcome, total: number): PendingOutcome {
  return settleTarget(outcome, outcome.targets[0].id, total);
}

/** Settle a named target of a batch, which is how every wire result arrives. */
function settleNamed(outcome: PendingOutcome, name: string, total: number): PendingOutcome {
  return settleTarget(outcome, `token-${name}`, total);
}

function markOne(outcome: PendingOutcome, consequenceId: string): PendingOutcome {
  return markTargetApplied(outcome, outcome.targets[0].id, consequenceId);
}

let host: HTMLDivElement;
let root: Root;

async function mount(outcomes: PendingOutcome[], overrides: Partial<VttResolutionCardProps> = {}) {
  const props: VttResolutionCardProps = {
    outcomes,
    onRoll: vi.fn(() => 27),
    onApplyDamage: vi.fn(),
    onApplyCondition: vi.fn(),
    onDeclare: vi.fn(),
    onSetDamageRoll: vi.fn(),
    onDismiss: vi.fn(),
    ...overrides,
  };
  await act(async () => {
    root.render(<VttResolutionCard {...props} />);
  });
  return props;
}

/** Buttons are matched on their visible text: the contract this card owes the
 *  table is that a button says exactly what pressing it will do. */
function button(text: string): HTMLButtonElement | undefined {
  return [...host.querySelectorAll<HTMLButtonElement>("button")].find((item) => item.textContent?.trim() === text);
}

beforeEach(() => {
  document.body.innerHTML = "";
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

describe("VttResolutionCard", () => {
  it("renders nothing when no outcome is open", async () => {
    await mount([]);
    expect(host.innerHTML).toBe("");
  });

  it("names the ability, the target and the resolution", async () => {
    await mount([settleOne(outcome(PSYCHIC_SCREAM), 14)]);
    expect(host.querySelector(".vtt2-res-title")?.textContent).toBe("PSYCHIC SCREAM → Kira");
    expect(host.querySelector(".vtt2-res-line")?.textContent).toBe("Mental Save — Influence · 14 vs DV 18 — failed");
  });

  it("says a pending outcome is waiting, and still offers both declarations", async () => {
    const props = await mount([outcome(PSYCHIC_SCREAM)]);
    expect(host.querySelector(".vtt2-res-line")?.textContent).toBe(
      "Mental Save — Influence · vs DV 18 — waiting on the roll"
    );
    expect(host.textContent).toContain("Waiting on the roll");
    // Nothing is armed until a verdict exists — the card must not offer dice
    // for a branch the roll has not chosen yet.
    expect(button("Roll 2d8 Psychic")).toBeUndefined();

    await act(async () => button("Kira failed")!.click());
    expect(props.onDeclare).toHaveBeenCalledWith(
      expect.objectContaining({ id: "out-1" }),
      expect.objectContaining({ name: "Kira" }),
      "fail"
    );
  });

  it("arms the failed save's damage and applies the rolled total", async () => {
    const props = await mount([settleOne(outcome(PASSIVE_DEATH), 14)]);
    await act(async () => button("Roll 1d6 Eldritch")!.click());
    expect(props.onRoll).toHaveBeenCalledWith(
      expect.objectContaining({ id: "out-1" }),
      expect.objectContaining({ expr: "1d6", damageType: "Eldritch" })
    );

    await act(async () => button("Apply −27 HP")!.click());
    expect(props.onApplyDamage).toHaveBeenCalledWith(
      expect.objectContaining({ id: "out-1" }),
      expect.objectContaining({ name: "Kira" }),
      expect.objectContaining({ id: "dmg-0" }),
      27
    );
  });

  it("halves a passed save's rider, and shows the halving", async () => {
    const props = await mount([settleOne(outcome(PSYCHIC_SCREAM), 20)]);
    await act(async () => button("Roll 2d8 Psychic")!.click());
    expect(host.querySelector(".vtt2-res-rolled")?.textContent).toBe("Rolled 27 · half on a success");

    await act(async () => button("Apply −13 HP")!.click());
    expect(props.onApplyDamage).toHaveBeenCalledWith(
      expect.objectContaining({ id: "out-1" }),
      expect.objectContaining({ name: "Kira" }),
      expect.objectContaining({ id: "dmg-0" }),
      13
    );
  });

  it("says nothing is owed when a passed save has no rider", async () => {
    await mount([settleOne(outcome(HAIL_RAIN), 20)]);
    expect(host.textContent).toContain("Nothing to apply — the save held.");
    expect(button("Roll 2d6 Cold")).toBeUndefined();
  });

  it("applies a parsed condition with its duration", async () => {
    const props = await mount([settleOne(outcome(HAIL_RAIN), 14)]);
    await act(async () => button("Apply Slowed (1)")!.click());
    expect(props.onApplyCondition).toHaveBeenCalledWith(
      expect.objectContaining({ id: "out-1" }),
      expect.objectContaining({ name: "Kira" }),
      expect.objectContaining({ condition: "Slowed", rounds: 1 })
    );
  });

  it("applies a condition the prose gave no duration", async () => {
    const props = await mount([settleOne(outcome(LOCK_MOVE), 14)]);
    await act(async () => button("Apply Restrained")!.click());
    expect(props.onApplyCondition).toHaveBeenCalledWith(
      expect.objectContaining({ id: "out-1" }),
      expect.objectContaining({ name: "Kira" }),
      expect.objectContaining({ condition: "Restrained", rounds: undefined })
    );
  });

  it("will not offer a condition the Curator already committed", async () => {
    const settled = markOne(settleOne(outcome(HAIL_RAIN), 14), "cond-slowed");
    await mount([settled]);
    expect(host.querySelector(".vtt2-res-applied")?.textContent).toBe("Applied Slowed (1)");
    expect(button("Apply Slowed (1)")).toBeUndefined();
  });

  it("will not offer to re-roll damage the Curator already committed", async () => {
    const settled = settleOne(outcome(PASSIVE_DEATH), 14);
    await mount([settled]);
    await act(async () => button("Roll 1d6 Eldritch")!.click());
    await act(async () => button("Apply −27 HP")!.click());

    await mount([markOne(settled, "dmg-0")]);
    expect(host.querySelector(".vtt2-res-applied")?.textContent).toBe("Applied −27 HP");
    expect(button("Roll 1d6 Eldritch")).toBeUndefined();
    expect(button("Apply −27 HP")).toBeUndefined();
  });

  // The rolled total is this component's, so a card that comes back from a
  // panel unmount knows the hit landed but not how big it was. It must still
  // refuse to arm the dice a second time.
  it("keeps refusing the dice when only the ledger remembers the hit", async () => {
    await mount([markOne(settleOne(outcome(PASSIVE_DEATH), 14), "dmg-0")]);
    expect(host.querySelector(".vtt2-res-applied")?.textContent).toBe("Applied");
    expect(button("Roll 1d6 Eldritch")).toBeUndefined();
  });

  it("says so when the dice could not be rolled, and keeps the roll button", async () => {
    await mount([settleOne(outcome(PASSIVE_DEATH), 14)], { onRoll: () => null });
    await act(async () => button("Roll 1d6 Eldritch")!.click());
    expect(host.querySelector(".equip-warn")?.textContent).toBe("Could not roll 1d6.");
    expect(button("Roll 1d6 Eldritch")).toBeDefined();
  });

  // Rows and cards must be module-level component types. Declared inside a
  // render they are a new type every pass, so React tears the DOM down and
  // rebuilds it — the Curator's focus lands somewhere else mid-resolution.
  it("keeps keyboard focus where the Curator put it across a roll", async () => {
    await mount([settleOne(outcome(PSYCHIC_SCREAM), 14)]);
    const declare = button("Kira failed")!;
    const condition = button("Apply Stunned (1)")!;
    const conditionRow = condition.closest("li")!;
    condition.focus();

    await act(async () => button("Roll 2d8 Psychic")!.click());
    expect(document.activeElement).toBe(condition);
    expect(button("Apply Stunned (1)")!.closest("li")).toBe(conditionRow);
    expect(button("Kira failed")).toBe(declare);
  });

  // Which reader answered has to be visible. "2d6 Cold" looks identical whether
  // an author wrote it in a block or the scanner read it out of a sentence, and
  // a Curator deciding whether to trust a row needs to know which.
  it("marks a page-declared row and leaves a prose-derived one unmarked", async () => {
    await mount([settleOne(declaredOutcome(HAIL_RAIN), 14)]);
    const marks = [...host.querySelectorAll(".vtt2-res-src")].map((el) => el.textContent);
    expect(marks).toEqual(["declared", "declared", "declared"]);

    await mount([settleOne(outcome(HAIL_RAIN), 14)]);
    expect(host.querySelector(".vtt2-res-src")).toBeNull();
  });

  it("names the source that came up empty when a failure costs nothing", async () => {
    // Not a shipped page — a table's own fork, which is a first-class thing to
    // be: this one declares what a SUCCESS costs and says nothing about a miss.
    // "This ability's prose names no consequence" would be a lie on a card built
    // from a block, so the sentence names the source a Curator can go and fix.
    const read = parseAbilityEffects(
      ["- Save: Physical Save — Recovery, DV 18", "- Success: Damage: 1d6"].join("\n")
    );
    expect(read.errors).toEqual([]);
    const forked = outcome(ECHO_CHAIN, {}, read.steps);
    await mount([settleOne(forked, 9)]);
    expect(host.textContent).toContain("this ability's page declares nothing for a failure");

    // The prose card keeps its own wording, because its source really is prose.
    await mount([settleOne(outcome(INVERSE_REVERSE), 9)]);
    expect(host.textContent).toContain("this ability's prose names no consequence");

    // The hard case: a block that spends and rolls but never lands anything, so
    // it yields NO consequences at all. There is nothing declared left on the
    // card to recognise it by, and the prose sentence would send a Curator to
    // read a page this block had already superseded.
    const priceOnly = parseAbilityEffects(
      ["- Cost: 2 SS", "- Save: Physical Save — Recovery, DV 18"].join("\n")
    );
    expect(priceOnly.errors).toEqual([]);
    const silent = outcome(ECHO_CHAIN, {}, priceOnly.steps);
    expect(silent.consequences).toEqual([]);
    await mount([settleOne(silent, 9)]);
    expect(host.textContent).toContain("this ability's page declares nothing for a failure");
  });

  it("dismisses by outcome id", async () => {
    const props = await mount([settleOne(outcome(HAIL_RAIN), 14)]);
    await act(async () => host.querySelector<HTMLButtonElement>(".cdx-tab-x")!.click());
    expect(props.onDismiss).toHaveBeenCalledWith("out-1");
  });

  it("stacks the newest outcome first", async () => {
    const older = settleOne(batch(PSYCHIC_SCREAM, ["Voss"], { id: "out-old", createdAt: 1_000 }), 14);
    const newer = settleOne(batch(PSYCHIC_SCREAM, ["Kira"], { id: "out-new", createdAt: 9_000 }), 14);
    await mount([older, newer]);
    const targets = [...host.querySelectorAll(".vtt2-res-title")].map((item) => item.textContent);
    expect(targets).toEqual(["PSYCHIC SCREAM → Kira", "PSYCHIC SCREAM → Voss"]);
  });
});

// The table-rules half of P2. Two clicks per consequence is the published flow
// and stays the default; a table may hand the unambiguous ones to the app, and
// what counts as unambiguous is `autoApplicable`'s answer, not this card's.
describe("VttResolutionCard under a table's auto-apply rule", () => {
  it("still asks for both clicks under the published default", async () => {
    const props = await mount([settleOne(declaredOutcome(HAIL_RAIN), 14)]);
    expect(props.onRoll).not.toHaveBeenCalled();
    expect(props.onApplyDamage).not.toHaveBeenCalled();
    expect(props.onApplyCondition).not.toHaveBeenCalled();
    // The card is fully armed — it is the rule that is off, not the card that
    // is empty.
    expect(button("Roll On fail · 2d6 Cold")).toBeDefined();
  });

  it("rolls and commits a declared hit, and hangs a declared condition", async () => {
    const props = await mount([settleOne(declaredOutcome(HAIL_RAIN), 14)], {
      autoApplyDeclared: true,
    });
    expect(props.onRoll).toHaveBeenCalledWith(
      expect.objectContaining({ id: "out-1" }),
      expect.objectContaining({ expr: "2d6", damageType: "Cold" })
    );
    expect(props.onApplyDamage).toHaveBeenCalledWith(
      expect.objectContaining({ id: "out-1" }),
      expect.objectContaining({ name: "Kira" }),
      expect.objectContaining({ expr: "2d6" }),
      27
    );
    expect(props.onApplyCondition).toHaveBeenCalledWith(
      expect.objectContaining({ id: "out-1" }),
      expect.objectContaining({ name: "Kira" }),
      expect.objectContaining({ condition: "Slowed", rounds: 1 })
    );
  });

  // The whole shipped corpus is prose. Switching the rule on must not reach one
  // card of it: a sentence the scanner read is a reading, and a reading does not
  // get to move a token's HP with nobody watching.
  it("does not touch a prose-derived card, however the table set the rule", async () => {
    const props = await mount([settleOne(outcome(HAIL_RAIN), 14)], { autoApplyDeclared: true });
    expect(props.onRoll).not.toHaveBeenCalled();
    expect(props.onApplyDamage).not.toHaveBeenCalled();
    expect(props.onApplyCondition).not.toHaveBeenCalled();
    expect(button("Roll 2d6 Cold")).toBeDefined();
  });

  it("leaves a declared Ruling for the Curator", async () => {
    const props = await mount([settleOne(declaredOutcome(ECHO_CHAIN), 9)], {
      autoApplyDeclared: true,
    });
    expect(host.textContent).toContain("Curator adjudicates");
    expect(props.onApplyDamage).not.toHaveBeenCalled();
    expect(props.onApplyCondition).not.toHaveBeenCalled();
  });

  it("waits for a verdict rather than pre-committing a pending card", async () => {
    const props = await mount([declaredOutcome(HAIL_RAIN)], { autoApplyDeclared: true });
    expect(props.onRoll).not.toHaveBeenCalled();
    expect(props.onApplyDamage).not.toHaveBeenCalled();
  });

  // The card re-renders on every ledger emit — a toast, a second outcome, the
  // Curator moving the map. A hit that fired once per render would empty a token.
  it("commits a consequence exactly once across re-renders", async () => {
    const settled = settleOne(declaredOutcome(HAIL_RAIN), 14);
    const props = await mount([settled], { autoApplyDeclared: true });
    expect(props.onApplyDamage).toHaveBeenCalledTimes(1);

    // Re-rendered with the ledger's own answer: the row is marked applied now.
    await act(async () => {
      root.render(
        <VttResolutionCard {...props} outcomes={[markOne(settled, "dmg-0")]} autoApplyDeclared />
      );
    });
    expect(props.onApplyDamage).toHaveBeenCalledTimes(1);

    // And re-rendered with the UNCHANGED card, which is what a refused write
    // leaves behind: nothing was marked applied, and it still must not fire again.
    await act(async () => {
      root.render(<VttResolutionCard {...props} outcomes={[settled]} autoApplyDeclared />);
    });
    expect(props.onApplyDamage).toHaveBeenCalledTimes(1);
  });

  // A pass keeps a declared "half on success" rider, and half is what lands.
  it("halves a declared rider on a passed save before committing it", async () => {
    const props = await mount([settleOne(declaredOutcome(PSYCHIC_SCREAM), 20)], {
      autoApplyDeclared: true,
    });
    expect(props.onApplyDamage).toHaveBeenCalledWith(
      expect.objectContaining({ id: "out-1" }),
      expect.objectContaining({ name: "Kira" }),
      expect.objectContaining({ expr: "2d8", half: true }),
      13
    );
  });

  it("leaves the row manual when the dice could not be rolled", async () => {
    const props = await mount([settleOne(declaredOutcome(HAIL_RAIN), 14)], {
      autoApplyDeclared: true,
      onRoll: vi.fn(() => null),
    });
    expect(props.onRoll).toHaveBeenCalled();
    expect(props.onApplyDamage).not.toHaveBeenCalled();
    expect(host.textContent).toContain("Could not roll 2d6");
  });
});

// One card for many targets — the design centrepiece of this phase. An area
// ability that opened 23 cards would ask for 46 clicks, which is the point where
// "the Curator confirms everything" stops being sovereignty and becomes the
// thing a table routes around. So: the counts are the glance, the one act
// commits the whole failing set, and the rows underneath stay reachable for the
// single target a Curator wants to treat differently.
describe("VttResolutionCard with many targets on one card", () => {
  /** Eighteen of twenty-three failed, three held, two never answered — the
   *  partly-resolved shape the header has to be legible in. */
  function corridor(): PendingOutcome {
    const names = Array.from({ length: 23 }, (_, i) => `T${i}`);
    let card = batch(HAIL_RAIN, names);
    for (let i = 0; i < 18; i++) card = settleNamed(card, `T${i}`, 9);
    for (let i = 18; i < 21; i++) card = settleNamed(card, `T${i}`, 20);
    return card;
  }

  it("says the shape of the resolution in one line, and how many are outstanding", async () => {
    await mount([corridor()]);
    expect(host.querySelector(".vtt2-res-title")?.textContent).toBe("Hail Rain → 23 targets");
    expect(host.querySelector(".vtt2-res-tally")?.textContent).toBe("18 of 23 failed · 3 passed · 2 still to roll");
    // Said in words, not left to be inferred from a spinner: a card that is
    // quietly short two answers looks exactly like a card that is finished.
    expect(host.textContent).toContain("2 targets have not rolled yet");
  });

  // 23 rows is not a glance. The rows open on request; the counts and the act
  // never leave.
  it("keeps the rows folded away until the Curator asks for them", async () => {
    await mount([corridor()]);
    expect(host.querySelectorAll(".vtt2-res-target")).toHaveLength(0);
    expect(button("T0 failed")).toBeUndefined();

    await act(async () => button("Show all 23 targets")!.click());
    expect(host.querySelectorAll(".vtt2-res-target")).toHaveLength(23);
    expect(button("T0 failed")).toBeDefined();
  });

  // A single-target card is a batch of one and must look exactly as it always
  // has: no counts, no fold, no name heading above a line that already names the
  // only creature involved.
  it("shows a one-target card the way it has always shown one", async () => {
    await mount([settleOne(outcome(HAIL_RAIN), 14)]);
    expect(host.querySelector(".vtt2-res-tally")).toBeNull();
    expect(host.querySelector(".vtt2-res-tname")).toBeNull();
    expect(host.querySelector(".vtt2-res-title")?.textContent).toBe("Hail Rain → Kira");
    expect(button("Apply Slowed (1)")).toBeDefined();
  });

  it("applies the whole failing set in one act, and nothing outside it", async () => {
    const props = await mount([corridor()]);
    await act(async () => button("Apply to all 18 that failed")!.click());
    // Eighteen damage rolls and eighteen conditions — the two things Hail Rain's
    // prose gives a failure — and not one write against the three that held or
    // the two that never answered.
    expect(props.onApplyDamage).toHaveBeenCalledTimes(18);
    expect(props.onApplyCondition).toHaveBeenCalledTimes(18);
    const hit = (props.onApplyDamage as ReturnType<typeof vi.fn>).mock.calls.map((call) => call[1].name);
    expect(hit).toEqual(Array.from({ length: 18 }, (_, i) => `T${i}`));
  });

  it("still lets the Curator treat one target differently", async () => {
    const props = await mount([corridor()]);
    await act(async () => button("Show all 23 targets")!.click());
    // T18 held its save and Hail Rain's prose gives a pass nothing, so the row
    // says so — and the Curator can still overrule the dice on it.
    await act(async () => button("T18 failed")!.click());
    expect(props.onDeclare).toHaveBeenCalledWith(
      expect.objectContaining({ id: "out-1" }),
      expect.objectContaining({ name: "T18" }),
      "fail"
    );
    expect(props.onApplyDamage).not.toHaveBeenCalled();
  });

  it("says which damage model is in force and lets the table change it", async () => {
    const props = await mount([corridor()]);
    expect(host.querySelector(".vtt2-res-mode")?.textContent).toContain("One damage roll per target");
    expect(host.querySelector(".vtt2-res-mode")?.textContent).toContain("read from the page");
    await act(async () => button("Roll once for all")!.click());
    expect(props.onSetDamageRoll).toHaveBeenCalledWith(expect.objectContaining({ id: "out-1" }), "shared");
  });

  // The corpus writes both models. The Gluttony's MASS DEVOUR deals "3d10 damage
  // each"; RECURRING CHAOS shares "half the damage inflicted" across its radius.
  // Which one is running
  // has to be visible in the number of rolls the card actually makes.
  it("rolls once per target by default, and once for everyone when told to", async () => {
    const perTarget = await mount([corridor()]);
    await act(async () => button("Apply to all 18 that failed")!.click());
    expect(perTarget.onRoll).toHaveBeenCalledTimes(18);

    const shared = await mount([{ ...corridor(), damageRoll: "shared", damageRollByHand: true }]);
    expect(host.querySelector(".vtt2-res-mode")?.textContent).toContain("One shared damage roll for everyone");
    await act(async () => button("Apply to all 18 that failed")!.click());
    expect(shared.onRoll).toHaveBeenCalledTimes(1);
    // One roll, eighteen applications of it — the whole point of the mode.
    expect(shared.onApplyDamage).toHaveBeenCalledTimes(18);
    for (const call of (shared.onApplyDamage as ReturnType<typeof vi.fn>).mock.calls) expect(call[3]).toBe(27);
  });

  // The mode is a claim the card makes in words above the rows — "One shared
  // damage roll for everyone" — and auto-apply used to break it silently. Its
  // pass reaches every target before React has landed a single `setRolled`, so
  // with no memo of its own each body rolled separately and a table that had
  // opted in saw 23 different numbers under a header promising one. Nothing on
  // screen said so; the only evidence was the amounts.
  it("keeps one shared roll shared when the table let the app apply it", async () => {
    let card = batch(HAIL_RAIN, ["Kira", "Vex", "Roan"], {}, declaredSteps(HAIL_RAIN));
    for (const name of ["Kira", "Vex", "Roan"]) card = settleNamed(card, name, 9);
    let n = 0;
    const props = await mount([{ ...card, damageRoll: "shared", damageRollByHand: true }], {
      autoApplyDeclared: true,
      onRoll: vi.fn(() => 10 + ++n),
    });
    expect(props.onRoll).toHaveBeenCalledTimes(1);
    const amounts = (props.onApplyDamage as ReturnType<typeof vi.fn>).mock.calls.map((call) => call[3]);
    expect(amounts).toEqual([11, 11, 11]);
  });

  // Rolling ONE row under a shared model fills the number in for every other
  // row, and each of them says why the same total is on all of them. Without the
  // word, one number repeated down a list is indistinguishable from a card that
  // rolled the same value twice by chance.
  it("fills every row from the first shared roll, and says that is what happened", async () => {
    let card = batch(HAIL_RAIN, ["Kira", "Vex"]);
    card = settleNamed(card, "Kira", 9);
    card = settleNamed(card, "Vex", 9);
    const props = await mount([{ ...card, damageRoll: "shared", damageRollByHand: true }]);
    await act(async () => button("Show all 2 targets")!.click());
    await act(async () => button("Roll 2d6 Cold")!.click());
    expect(props.onRoll).toHaveBeenCalledTimes(1);
    const rolled = [...host.querySelectorAll(".vtt2-res-rolled")].map((node) => node.textContent);
    expect(rolled).toEqual(["Rolled 27 · shared", "Rolled 27 · shared"]);
  });

  it("halves one shared roll for the targets that held, and not for the rest", async () => {
    // PSYCHIC SCREAM's prose is the half-on-success rider, so a pass still costs.
    let card = batch(PSYCHIC_SCREAM, ["Kira", "Vex"]);
    card = settleNamed(card, "Kira", 9);
    card = settleNamed(card, "Vex", 25);
    const props = await mount([{ ...card, damageRoll: "shared" }]);
    await act(async () => button("Apply to all 1 that failed")!.click());
    await act(async () => button("Apply to 1 that passed")!.click());
    const sent = (props.onApplyDamage as ReturnType<typeof vi.fn>).mock.calls.map((call) => [call[1].name, call[3]]);
    expect(sent).toEqual([
      ["Kira", 27],
      ["Vex", 13],
    ]);
    // And one roll behind both numbers, not two.
    expect(props.onRoll).toHaveBeenCalledTimes(1);
  });

  // The notice and the count beside it have to be about the same rows. A body
  // that lapsed and THEN left the scene is out of the lapse count — it is
  // reported as gone, which is the more specific fact — so it has to be out of
  // the date too, or the card announces "0 never rolled — outstanding since
  // round 4" and sends the Curator looking for a row that does not exist.
  it("dates the lapse from the rows it is still counting", async () => {
    let card = batch(HAIL_RAIN, ["Kira", "Vex", "Roan"]);
    card = settleNamed(card, "Kira", 9);
    card = lapsePendingTargets(card, 4); // Vex and Roan are both outstanding…
    card = markTargetRemoved(card, "token-Roan"); // …and then Roan leaves.
    await mount([card]);
    expect(host.querySelector(".vtt2-res-lapsed")?.textContent).toContain(
      "1 never rolled — outstanding since round 4"
    );
    expect(host.querySelector(".vtt2-res-tally")?.textContent).toBe(
      "1 of 2 failed · 1 never rolled · 1 left the scene"
    );

    // And the row says the same thing in its own line, which is the one a
    // Curator reads when they open the list to rule on it by hand. A batch names
    // every row it shows; only the single-target card can leave the name off.
    await act(async () => button("Show all 3 targets")!.click());
    const lines = [...host.querySelectorAll(".vtt2-res-line")].map((node) => node.textContent);
    expect(lines).toContain("Physical Save — Recovery · vs DV 18 — never rolled — outstanding since round 4");
    expect([...host.querySelectorAll(".vtt2-res-tname")].map((node) => node.textContent)).toEqual([
      "Kira",
      "Vex",
      "Roan",
    ]);

    // And when the last outstanding body leaves too, the notice goes with it.
    // A card still announcing "0 never rolled — outstanding since round 4" is
    // asking the Curator to chase a row that no longer needs anything.
    await mount([markTargetRemoved(card, "token-Vex")]);
    expect(host.querySelector(".vtt2-res-lapsed")).toBeNull();
    expect(host.querySelector(".vtt2-res-tally")?.textContent).toBe("1 of 1 failed · 2 left the scene");
  });

  it("never sweeps a target the round left behind into the one act", async () => {
    // Two of the twenty-three never answered, and the round moved on. Nothing is
    // applied to them, the card says so out loud, and the act still commits the
    // eighteen the dice actually decided.
    const props = await mount([lapsePendingTargets(corridor(), 4)]);
    expect(host.querySelector(".vtt2-res-lapsed")?.textContent).toContain(
      "2 never rolled — outstanding since round 4"
    );
    expect(host.textContent).toContain("Nothing was applied");
    await act(async () => button("Apply to all 18 that failed")!.click());
    const hit = (props.onApplyDamage as ReturnType<typeof vi.fn>).mock.calls.map((call) => call[1].name);
    expect(hit).not.toContain("T21");
    expect(hit).not.toContain("T22");
    expect(hit).toHaveLength(18);
  });

  it("says a target whose token left is beyond applying to", async () => {
    const props = await mount([markTargetRemoved(corridor(), "token-T0")]);
    expect(host.querySelector(".vtt2-res-tally")?.textContent).toContain("1 left the scene");
    await act(async () => button("Show all 23 targets")!.click());
    expect(host.textContent).toContain("T0 is no longer on this scene");
    // No verdict buttons on a body that is not there, and the act skips it.
    expect(button("T0 failed")).toBeUndefined();
    await act(async () => button("Apply to all 17 that failed")!.click());
    const hit = (props.onApplyDamage as ReturnType<typeof vi.fn>).mock.calls.map((call) => call[1].name);
    expect(hit).not.toContain("T0");
  });

  it("will not send the same hit twice when the act is pressed twice", async () => {
    // The second press reads the ledger's own answer: every row is marked, so
    // the plan is empty and the button is gone rather than armed with a hit
    // eighteen tokens already took.
    let card = corridor();
    const props = await mount([card]);
    await act(async () => button("Apply to all 18 that failed")!.click());
    for (const step of batchPlan(card, "fail")) {
      for (const consequence of step.consequences) card = markTargetApplied(card, step.target.id, consequence.id);
    }
    await act(async () => {
      root.render(<VttResolutionCard {...props} outcomes={[card]} />);
    });
    expect(button("Apply to all 18 that failed")).toBeUndefined();
    expect(host.textContent).toContain("Nothing is armed to apply yet");
    expect(props.onApplyDamage).toHaveBeenCalledTimes(18);
  });

  it("leaves the rulings out of the act and says how many still need a human", async () => {
    const ruling: OutcomeConsequence = { id: "rule-0", kind: "ruling", label: "brittle objects shatter", on: "fail" };
    let card = batch(HAIL_RAIN, ["Kira", "Vex"]);
    card = { ...card, consequences: [...card.consequences, ruling] };
    card = settleNamed(settleNamed(card, "Kira", 9), "Vex", 9);
    const props = await mount([card]);
    expect(host.textContent).toContain("2 targets need a ruling");
    await act(async () => button("Apply to all 2 that failed")!.click());
    // Damage and the condition landed; the question the page asked did not get
    // answered by a button press.
    expect(props.onApplyDamage).toHaveBeenCalledTimes(2);
    expect(props.onApplyCondition).toHaveBeenCalledTimes(2);
  });
});
