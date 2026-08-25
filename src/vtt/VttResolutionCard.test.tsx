// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import cipherData from "../game/data/ciphers.json";
import genusData from "../game/data/genus.json";
import { VttResolutionCard, type VttResolutionCardProps } from "./VttResolutionCard";
import { markApplied, openOutcome, settleOutcome, type PendingOutcome } from "./data/outcomeLedger";

interface CorpusAbility {
  name: string;
  effect?: string | null;
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

function outcome(ability: CorpusAbility, overrides: Partial<PendingOutcome> = {}): PendingOutcome {
  return {
    ...openOutcome({
      id: "out-1",
      sourceAbilityId: `ability-${ability.name}`,
      sourceAbilityName: ability.name,
      targetTokenId: "token-kira",
      targetName: "Kira",
      dc: 18,
      rollLabel: "Mental Save — Influence",
      effect: ability.effect,
      now: 1_000,
    }),
    ...overrides,
  };
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
    await mount([settleOutcome(outcome(PSYCHIC_SCREAM), 14)]);
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
    expect(props.onDeclare).toHaveBeenCalledWith(expect.objectContaining({ id: "out-1" }), "fail");
  });

  it("arms the failed save's damage and applies the rolled total", async () => {
    const props = await mount([settleOutcome(outcome(PASSIVE_DEATH), 14)]);
    await act(async () => button("Roll 1d6 Eldritch")!.click());
    expect(props.onRoll).toHaveBeenCalledWith(
      expect.objectContaining({ id: "out-1" }),
      expect.objectContaining({ expr: "1d6", damageType: "Eldritch" })
    );

    await act(async () => button("Apply −27 HP")!.click());
    expect(props.onApplyDamage).toHaveBeenCalledWith(
      expect.objectContaining({ id: "out-1" }),
      expect.objectContaining({ id: "dmg-0" }),
      27
    );
  });

  it("halves a passed save's rider, and shows the halving", async () => {
    const props = await mount([settleOutcome(outcome(PSYCHIC_SCREAM), 20)]);
    await act(async () => button("Roll 2d8 Psychic")!.click());
    expect(host.querySelector(".vtt2-res-rolled")?.textContent).toBe("Rolled 27 · half on a success");

    await act(async () => button("Apply −13 HP")!.click());
    expect(props.onApplyDamage).toHaveBeenCalledWith(
      expect.objectContaining({ id: "out-1" }),
      expect.objectContaining({ id: "dmg-0" }),
      13
    );
  });

  it("says nothing is owed when a passed save has no rider", async () => {
    await mount([settleOutcome(outcome(HAIL_RAIN), 20)]);
    expect(host.textContent).toContain("Nothing to apply — the save held.");
    expect(button("Roll 2d6 Cold")).toBeUndefined();
  });

  it("applies a parsed condition with its duration", async () => {
    const props = await mount([settleOutcome(outcome(HAIL_RAIN), 14)]);
    await act(async () => button("Apply Slowed (1)")!.click());
    expect(props.onApplyCondition).toHaveBeenCalledWith(
      expect.objectContaining({ id: "out-1" }),
      expect.objectContaining({ condition: "Slowed", rounds: 1 })
    );
  });

  it("applies a condition the prose gave no duration", async () => {
    const props = await mount([settleOutcome(outcome(LOCK_MOVE), 14)]);
    await act(async () => button("Apply Restrained")!.click());
    expect(props.onApplyCondition).toHaveBeenCalledWith(
      expect.objectContaining({ id: "out-1" }),
      expect.objectContaining({ condition: "Restrained", rounds: undefined })
    );
  });

  it("will not offer a condition the Curator already committed", async () => {
    const settled = markApplied(settleOutcome(outcome(HAIL_RAIN), 14), "cond-slowed");
    await mount([settled]);
    expect(host.querySelector(".vtt2-res-applied")?.textContent).toBe("Applied Slowed (1)");
    expect(button("Apply Slowed (1)")).toBeUndefined();
  });

  it("will not offer to re-roll damage the Curator already committed", async () => {
    const settled = settleOutcome(outcome(PASSIVE_DEATH), 14);
    await mount([settled]);
    await act(async () => button("Roll 1d6 Eldritch")!.click());
    await act(async () => button("Apply −27 HP")!.click());

    await mount([markApplied(settled, "dmg-0")]);
    expect(host.querySelector(".vtt2-res-applied")?.textContent).toBe("Applied −27 HP");
    expect(button("Roll 1d6 Eldritch")).toBeUndefined();
    expect(button("Apply −27 HP")).toBeUndefined();
  });

  // The rolled total is this component's, so a card that comes back from a
  // panel unmount knows the hit landed but not how big it was. It must still
  // refuse to arm the dice a second time.
  it("keeps refusing the dice when only the ledger remembers the hit", async () => {
    await mount([markApplied(settleOutcome(outcome(PASSIVE_DEATH), 14), "dmg-0")]);
    expect(host.querySelector(".vtt2-res-applied")?.textContent).toBe("Applied");
    expect(button("Roll 1d6 Eldritch")).toBeUndefined();
  });

  it("says so when the dice could not be rolled, and keeps the roll button", async () => {
    await mount([settleOutcome(outcome(PASSIVE_DEATH), 14)], { onRoll: () => null });
    await act(async () => button("Roll 1d6 Eldritch")!.click());
    expect(host.querySelector(".equip-warn")?.textContent).toBe("Could not roll 1d6.");
    expect(button("Roll 1d6 Eldritch")).toBeDefined();
  });

  // Rows and cards must be module-level component types. Declared inside a
  // render they are a new type every pass, so React tears the DOM down and
  // rebuilds it — the Curator's focus lands somewhere else mid-resolution.
  it("keeps keyboard focus where the Curator put it across a roll", async () => {
    await mount([settleOutcome(outcome(PSYCHIC_SCREAM), 14)]);
    const declare = button("Kira failed")!;
    const condition = button("Apply Stunned (1)")!;
    const conditionRow = condition.closest("li")!;
    condition.focus();

    await act(async () => button("Roll 2d8 Psychic")!.click());
    expect(document.activeElement).toBe(condition);
    expect(button("Apply Stunned (1)")!.closest("li")).toBe(conditionRow);
    expect(button("Kira failed")).toBe(declare);
  });

  it("dismisses by outcome id", async () => {
    const props = await mount([settleOutcome(outcome(HAIL_RAIN), 14)]);
    await act(async () => host.querySelector<HTMLButtonElement>(".cdx-tab-x")!.click());
    expect(props.onDismiss).toHaveBeenCalledWith("out-1");
  });

  it("stacks the newest outcome first", async () => {
    const older = settleOutcome(outcome(PSYCHIC_SCREAM, { id: "out-old", targetName: "Voss", createdAt: 1_000 }), 14);
    const newer = settleOutcome(outcome(PSYCHIC_SCREAM, { id: "out-new", targetName: "Kira", createdAt: 9_000 }), 14);
    await mount([older, newer]);
    const targets = [...host.querySelectorAll(".vtt2-res-title")].map((item) => item.textContent);
    expect(targets).toEqual(["PSYCHIC SCREAM → Kira", "PSYCHIC SCREAM → Voss"]);
  });
});
