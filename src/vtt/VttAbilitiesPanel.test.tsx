// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CharacterRecord } from "../lib/characters";
import { VttAbilitiesPanel } from "./VttAbilitiesPanel";
import { parseRollFormulaPage, setCodexRollFormulas } from "../game/rollFormula";
import { __resetUsageLedger, listUses, type UsageWindow } from "./data/usageLedger";

vi.mock("../game/useCodex", () => ({ useCodex: () => ({ tick: 0 }) }));
vi.mock("./data/characterAbilities", () => ({
  characterActionSet: () => ({
    actions: [],
    genus: [
      {
        id: "ability-1",
        name: "Gravitic Snare",
        source: "genus",
        effect: "Living creatures make Endurance Saves (DC 18).",
        limit: "Twice per encounter",
        ss: 1,
        meta: { targets: 1, range: null, area: null, pattern: null, duration: null, attach: "target", values: [] },
      },
      {
        id: "ability-axis",
        name: "Phase Trap",
        source: "genus",
        effect: "The target makes a Physical Save — Evasion.",
        limit: "Once per short rest",
        ss: 2,
        meta: { targets: 1, range: null, area: null, pattern: null, duration: null, attach: "target", values: [] },
      },
      {
        // Internal Break's real shape: a check the user makes AND damage it
        // deals, so the row renders two firing controls for ONE use. The
        // effect text is the shipped one, because the count this row shows has
        // to be right for the abilities the corpus actually contains.
        id: "ability-two-step",
        name: "Internal Break",
        source: "genus",
        effect:
          "Focuses Neutral energy inward into a target to cause internal structural failure without visible external damage. On creatures: deals 2d6 damage ignoring DHP entirely (internal disruption). Requires either physical contact or a Mental Check — Capacity (DV 13) if used at range.",
        limit: "Once per encounter",
        ss: 3,
        meta: { targets: 1, range: null, area: null, pattern: null, duration: null, attach: "target", values: [] },
      },
      {
        // Spontaneous Combustion's shipped prose, verbatim, because it arms TWO
        // DAMAGE controls (2d6 now, 1d6 a turn thereafter) and no check at all.
        // Six of the nine multi-control genus abilities are shaped like this,
        // and a dedup keyed on "damage" rather than on WHICH damage would count
        // the pair as two uses of a once-per-turn ability.
        id: "ability-two-damage",
        name: "Spontaneous Combustion",
        source: "genus",
        effect:
          "Triggers immediate spontaneous ignition in a target by rapidly exciting its molecules at the atomic level. Target takes 2d6 fire damage immediately, then 1d6 at the start of each of their turns until they spend an Action to extinguish.",
        limit: "Once per turn",
        ss: 7,
        meta: { targets: 1, range: null, area: null, pattern: null, duration: null, attach: "target", values: [] },
      },
      {
        // Photonic Swing's authored limit, verbatim: a page that says the use
        // count is unlimited and then names a rate the app cannot see the edge
        // of.
        id: "ability-unlimited",
        name: "Photonic Swing",
        source: "genus",
        effect: "Swings on a beam of light.",
        limit: "Unlimited; once per action",
        ss: 1,
        meta: { targets: 1, range: null, area: null, pattern: null, duration: null, attach: "self", values: [] },
      },
    ],
    cipher: [
      {
        // The declared half of the panel: this page says what it does in an
        // `## Actions` block, and its prose says something different on purpose
        // so a renderer that read both would be caught red-handed.
        id: "cipher-1",
        name: "Cryo Lock",
        source: "cipher",
        effect: "The target makes a Physical Save — Recovery (DV 15) or takes 2d8 Cold damage.",
        actions: [
          "- Cost: 6 SS",
          "- Save: Physical Save — Recovery, DV 18",
          "- Fail: Damage: 3d10 Cold, half on success",
          "- Fail: Condition: Slowed, 2 rounds",
          "- Ruling: brittle objects shatter — Curator adjudicates",
        ].join("\n"),
        ss: 6,
        meta: { targets: 1, range: null, area: null, pattern: null, duration: null, attach: "target", values: [] },
      },
    ],
    racial: [
      {
        id: "racial-1",
        name: "En-cTusion",
        source: "racial",
        effect: "Roll Adaption; the target rolls Control at double Disadvantage.",
        ss: 0,
        meta: { targets: 1, range: null, area: null, pattern: null, duration: null, attach: "target", values: [] },
      },
    ],
  }),
  characterRollAxisStats: () => ({
    attr: { phy: 2, ap: 1, dex: 2, end: 0, wis: 1, int: 3, cha: -1 },
    spec: { wm: 4, pre: 3, bal: -2, adp: 1, mf: 0, per: 5, cun: -3 },
    derived: { atk: 3, ad: 2, ev: -3, rr: -1, nc: 4, pr: 1, inf: -2 },
  }),
  characterEffectiveRollScores: () => ({
    attr: { phy: 0, dex: 0, end: 0, ap: 0, wis: 0, cha: 0, int: 0 },
    spec: { ins: 0, bal: 0, wt: 0, pre: 0, ctrl: 0, wm: 0, mf: 0, per: 0, adp: 0, cun: 0 },
  }),
}));

const character = {
  id: "caster-1",
  name: "Caster",
  sheet: { attributes: {}, specialties: {} },
} as CharacterRecord;

let host: HTMLDivElement;
let root: Root;

async function mount(
  onRequestTargetRoll?: Parameters<typeof VttAbilitiesPanel>[0]["onRequestTargetRoll"],
  onArmRoll: Parameters<typeof VttAbilitiesPanel>[0]["onArmRoll"] = () => {},
  usage?: { scope: string; window: UsageWindow }
) {
  await act(async () => {
    root.render(
      <VttAbilitiesPanel
        character={character}
        characters={[{ id: character.id, name: character.name }]}
        onPickCharacter={() => {}}
        onArmRoll={onArmRoll}
        onUseAbility={() => {}}
        onRequestTargetRoll={onRequestTargetRoll}
        usage={usage}
        onClose={() => {}}
      />
    );
  });
}

beforeEach(() => {
  __resetUsageLedger();
  setCodexRollFormulas([]);
  document.body.innerHTML = "";
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

describe("target roll chips", () => {
  it("turns a parsed save into a callback the VTT can target", async () => {
    const request = vi.fn();
    await mount(request);
    const chip = host.querySelector<HTMLButtonElement>(".vtt2-abil-savechip");
    expect(chip).not.toBeNull();
    expect(chip!.disabled).toBe(false);

    await act(async () => chip!.click());

    // The printed DC 18 is replaced by the attacker-keyed DV: 21 + the caster's
    // best Capacity check route (WIS +1 + NC +4 = +5) → 26.
    expect(request).toHaveBeenCalledWith({
      abilityId: "ability-1",
      abilityName: "Gravitic Snare",
      sourceCharacterId: "caster-1",
      // The prose rides along so the shell can read what failing this save
      // costs without resolving the ability a second time.
      effect: "Living creatures make Endurance Saves (DC 18).",
      label: "Endurance save · DV 26",
      stat: "Endurance",
      // "Endurance Saves" is the pre-Roll-Axis dialect for a Physical Save —
      // Recovery, so the route travels with the request and the target answers
      // on a real path instead of a bare d20.
      rollAxis: { path: "recovery", direction: "save" },
      dc: 26,
    });
  });

  it("leaves the chip visibly unavailable until target wiring is supplied", async () => {
    await mount();
    expect(host.querySelector<HTMLButtonElement>(".vtt2-abil-savechip")?.disabled).toBe(true);
  });

  it("renders parsed self and target rolls for the selected racial ability", async () => {
    const request = vi.fn();
    await mount(request);
    const buttons = [...host.querySelectorAll<HTMLButtonElement>("button")];
    const self = buttons.find((button) => button.textContent?.trim() === "Adaption check");
    const target = buttons.find((button) => button.textContent?.includes("Control save"));
    expect(self).toBeDefined();
    expect(target).toBeDefined();

    await act(async () => target!.click());
    expect(request).toHaveBeenCalledWith(expect.objectContaining({ abilityId: "racial-1", stat: "Control" }));
  });

  it("passes a parsed Roll Axis route to the targeted request", async () => {
    const request = vi.fn();
    await mount(request);
    const chip = [...host.querySelectorAll<HTMLButtonElement>(".vtt2-abil-savechip")]
      .find((button) => button.textContent?.includes("Physical Save — Evasion"));
    expect(chip).toBeDefined();

    await act(async () => chip!.click());
    // No printed DV in the prose — the attacker-keyed DV still applies, so the
    // target's prompt carries a number instead of a shrug.
    expect(request).toHaveBeenCalledWith({
      abilityId: "ability-axis",
      abilityName: "Phase Trap",
      sourceCharacterId: "caster-1",
      effect: "The target makes a Physical Save — Evasion.",
      label: "Physical Save — Evasion · DV 26",
      stat: undefined,
      rollAxis: { path: "evasion", direction: "save" },
      dc: 26,
    });
  });

  it("arms a Physical Evasion Save with its negative derived modifier", async () => {
    const arm = vi.fn();
    await mount(undefined, arm);
    const button = (text: string) => [...host.querySelectorAll<HTMLButtonElement>("button")].find((item) => item.textContent?.trim() === text);
    await act(async () => button("Physical")!.click());
    await act(async () => button("Saves")!.click());
    await act(async () => button("Evasion Save")!.click());
    const dexterity = [...host.querySelectorAll<HTMLButtonElement>("button")].find((item) => item.textContent?.includes("Dexterity"));
    expect(dexterity?.textContent).toContain("EV -3");
    await act(async () => dexterity!.click());
    expect(arm).toHaveBeenCalledWith("Evasion Save · Dexterity · DEX +2 · EV -3", "1d20-1");
  });

  it("arms VTT base rolls with the same Codex formula profile as the sheet", async () => {
    const parsed = parseRollFormulaPage(`# Attribute Formula

| Type | Roll Formula |
| Target | Attribute |
| Die | 10 |
| Modifier | score - 12 |`, "attribute-formula");
    if (!parsed?.ok) throw new Error("test formula did not parse");
    setCodexRollFormulas([parsed.formula]);
    const arm = vi.fn();
    await mount(undefined, arm);

    const strength = [...host.querySelectorAll<HTMLButtonElement>("button")].find((item) => item.textContent?.trim() === "STR");
    expect(strength?.title).toContain("1d10-12");
    await act(async () => strength!.click());
    expect(arm).toHaveBeenCalledWith("STR check", "1d10-12");
  });
});

describe("an ability that declares its steps", () => {
  const row = () =>
    [...host.querySelectorAll<HTMLLIElement>("li.vtt2-abil-row")].find((li) =>
      li.querySelector(".vtt2-abil-name")?.textContent?.includes("Cryo Lock")
    )!;

  it("arms the declared damage instead of the damage its prose names", async () => {
    // 3d10 Cold is declared; 2d8 Cold is what the prose says. Arming both would
    // hand the table one effect as two buttons.
    const arm = vi.fn();
    await mount(undefined, arm);
    const chips = [...row().querySelectorAll<HTMLButtonElement>(".vtt2-abil-btns .chip")];
    expect(chips.map((c) => c.textContent)).toEqual(["On fail · 3d10 Cold"]);

    await act(async () => chips[0].click());
    expect(arm).toHaveBeenCalledWith("Cryo Lock — On fail · 3d10 Cold", "3d10");
  });

  it("sends the DV the page declared, not the one keyed to the caster", async () => {
    const request = vi.fn();
    await mount(request);
    const chip = row().querySelector<HTMLButtonElement>(".vtt2-abil-savechip")!;
    expect(chip.textContent).toBe("vs Physical Save — Recovery · DV 18");
    await act(async () => chip.click());
    // 18 is declared; 15 is what the prose printed; 26 is what the keyed formula
    // would compute for this caster. An author who wrote a number in the block
    // chose it, and the engine does not overrule an author — the grammar has
    // `DV keyed` for pages that would rather be keyed, and the whole undeclared
    // corpus still is.
    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({ abilityId: "cipher-1", rollAxis: { path: "recovery", direction: "save" }, dc: 18 })
    );
  });

  it("carries the declared steps so the resolution card reads the page, not the prose", async () => {
    const request = vi.fn();
    await mount(request);
    await act(async () => row().querySelector<HTMLButtonElement>(".vtt2-abil-savechip")!.click());
    const intent = request.mock.calls[0][0];
    // The block's own consequences, in the order it wrote them. The prose beside
    // them says 2d8 and no condition at all.
    expect(intent.steps?.filter((step: { verb: string }) => step.verb !== "cost").map((step: { verb: string }) => step.verb))
      .toEqual(["save", "damage", "condition", "ruling"]);
    expect(intent.effect).toContain("2d8 Cold");
  });

  it("shows the cost, the condition and the ruling it declared", async () => {
    await mount();
    const steps = [...row().querySelectorAll(".vtt2-abil-stepchip")].map((el) => el.textContent);
    expect(steps).toEqual(["6 SS", "On fail · Slowed · 2 rounds", "Curator rules"]);
  });
});

describe("usage limits", () => {
  const IN_FIGHT = { scope: "camp-1", window: { sceneId: "sc1", encounterId: "en1", round: 2, turnId: "1" } };

  /** The chip on one row, by ability name — rows carry no test ids. */
  const rowChip = (name: string) => {
    const row = [...host.querySelectorAll<HTMLLIElement>(".vtt2-abil-row")].find((li) =>
      li.querySelector(".vtt2-abil-name")?.textContent?.includes(name)
    );
    return row?.querySelector(".vtt2-abil-limit");
  };

  const useRow = async (name: string) => {
    const row = [...host.querySelectorAll<HTMLLIElement>(".vtt2-abil-row")].find((li) =>
      li.querySelector(".vtt2-abil-name")?.textContent?.includes(name)
    )!;
    const button = [...row.querySelectorAll<HTMLButtonElement>(".vtt2-abil-btns button")][0];
    await act(async () => button.click());
  };

  it("counts a use against the printed allowance", async () => {
    await mount(undefined, () => {}, IN_FIGHT);
    expect(rowChip("Gravitic Snare")?.textContent).toContain("0 of 2 used");
    await useRow("Gravitic Snare");
    expect(rowChip("Gravitic Snare")?.textContent).toContain("1 of 2 used");
  });

  it("keeps the buttons live once the limit is spent", async () => {
    // The whole enforcement policy in one assertion: exhaustion is a thing the
    // row SAYS. A Curator overrules a printed limit as a matter of course, and
    // a disabled button would put this app in front of that call.
    await mount(undefined, () => {}, IN_FIGHT);
    await useRow("Gravitic Snare");
    await useRow("Gravitic Snare");
    await useRow("Gravitic Snare");
    const chip = rowChip("Gravitic Snare")!;
    expect(chip.textContent).toContain("3 of 2 used");
    expect(chip.querySelector(".vtt2-abil-limitchip")?.className).toContain("spent");
    const buttons = [...host.querySelectorAll<HTMLButtonElement>(".vtt2-abil-btns button")];
    expect(buttons.some((button) => button.disabled)).toBe(false);
  });

  it("says whose call the window is when the app cannot see its edge", async () => {
    // "Once per short rest" — the app runs no rests. It counts, and it says the
    // reset is the table's, rather than implying it knows when one ended.
    await mount(undefined, () => {}, IN_FIGHT);
    await useRow("Phase Trap");
    const chip = rowChip("Phase Trap")!;
    expect(chip.textContent).toContain("1 of 1 used");
    expect(chip.textContent).toContain("since reset");
    expect(chip.getAttribute("title")).toContain("the table's call");
  });

  it("clears one ability's tally on the Curator's word, and leaves the rest alone", async () => {
    await mount(undefined, () => {}, IN_FIGHT);
    await useRow("Gravitic Snare");
    await useRow("Phase Trap");
    const reset = rowChip("Phase Trap")!.querySelector<HTMLButtonElement>(".vtt2-abil-limitreset")!;
    await act(async () => reset.click());
    expect(rowChip("Phase Trap")?.textContent).toContain("0 of 1 used");
    expect(rowChip("Gravitic Snare")?.textContent).toContain("1 of 2 used");
  });

  it("shows the limit as authored when no window is open to count it against", async () => {
    // Out of combat there is no encounter, so "Twice per encounter" has nothing
    // to count against. It still has to be READABLE — a limit the table cannot
    // see is a limit the table forgets.
    await mount(undefined, () => {}, { scope: "camp-1", window: { sceneId: "sc1" } });
    const chip = rowChip("Gravitic Snare")!;
    expect(chip.textContent).toContain("Twice per encounter");
    expect(chip.textContent).not.toContain("used");
    expect(chip.getAttribute("title")).toContain("No encounter is running");
  });

  it("counts nothing for a caller that supplies no scope", async () => {
    await mount();
    expect(rowChip("Gravitic Snare")).toBeFalsy();
  });

  it("leaves an ability with no authored limit exactly as it was", async () => {
    // Ciphers, innates and variants carry no `| Limit |` at all — their limits
    // live in effect prose. A tracked panel must add nothing to those rows and
    // record nothing when they fire, which is the whole shipped behaviour of
    // every catalog but Genus.
    const used: string[] = [];
    await mount(undefined, () => {}, IN_FIGHT);
    expect(rowChip("Cryo Lock")).toBeFalsy();
    expect(rowChip("En-cTusion")).toBeFalsy();
    await useRow("Cryo Lock");
    expect(listUses("camp-1")).toHaveLength(0);
    expect(used).toEqual([]);
  });

  it("spends one use for one activation, however many controls the row renders", async () => {
    // Internal Break is `Once per encounter` and renders TWO firing controls —
    // the Mental Check its prose asks for, and the 2d6 it deals. Arming both is
    // ONE correct use. Counting each button press showed "2 of 1 used" and an
    // amber row on the first, entirely legal use of the ability. Nine of the 98
    // shipped genus abilities render more than one such control.
    await mount(undefined, () => {}, IN_FIGHT);
    // Re-read the row before EVERY press. `Row` is declared inside the panel,
    // so React remounts the whole list on each render and the nodes captured
    // before the first click are detached — clicking those was a no-op, and
    // this test once passed for two presses it never actually delivered.
    const controls = () =>
      [...host.querySelectorAll<HTMLLIElement>(".vtt2-abil-row")]
        .find((li) => li.querySelector(".vtt2-abil-name")?.textContent?.includes("Internal Break"))!
        .querySelectorAll<HTMLButtonElement>(".vtt2-abil-btns button");
    const count = controls().length;
    expect(count).toBeGreaterThan(1);
    for (let i = 0; i < count; i++) await act(async () => controls()[i].click());
    expect(rowChip("Internal Break")?.textContent).toContain("1 of 1 used");
  });

  it("spends one use for a row whose controls are all damage", async () => {
    // Spontaneous Combustion arms 2d6 and the 1d6 that follows it — two damage
    // buttons and no check. Telling them apart is what keeps a once-per-turn
    // ability from reading "2 of 1 used" the first time it is thrown.
    await mount(undefined, () => {}, IN_FIGHT);
    const controls = () =>
      [...host.querySelectorAll<HTMLLIElement>(".vtt2-abil-row")]
        .find((li) => li.querySelector(".vtt2-abil-name")?.textContent?.includes("Spontaneous Combustion"))!
        .querySelectorAll<HTMLButtonElement>(".vtt2-abil-btns button");
    const count = controls().length;
    expect(count).toBeGreaterThan(1);
    for (let i = 0; i < count; i++) await act(async () => controls()[i].click());
    expect(rowChip("Spontaneous Combustion")?.textContent).toContain("1 of 1 used");
  });

  it("does not fold two controls armed in different windows into one use", async () => {
    // The activation only collapses controls that landed in the SAME tally. A
    // check armed in one fight and damage armed in the next are two uses, and
    // an activation that outlived its window would have counted the second as
    // nothing at all.
    const controls = () =>
      [...host.querySelectorAll<HTMLLIElement>(".vtt2-abil-row")]
        .find((li) => li.querySelector(".vtt2-abil-name")?.textContent?.includes("Internal Break"))!
        .querySelectorAll<HTMLButtonElement>(".vtt2-abil-btns button");
    await mount(undefined, () => {}, IN_FIGHT);
    await act(async () => controls()[0].click());
    const next = { scope: "camp-1", window: { ...IN_FIGHT.window, encounterId: "en2" } };
    await mount(undefined, () => {}, next);
    await act(async () => controls()[1].click());
    expect(rowChip("Internal Break")?.textContent).toContain("1 of 1 used");
  });

  it("still spends every activation when the same control is used twice", async () => {
    // The other half of the rule: deduping BY ABILITY would have made a limit
    // uncountable past its first use. It is the row's controls that collapse
    // into one use, not the uses themselves.
    await mount(undefined, () => {}, IN_FIGHT);
    await useRow("Gravitic Snare");
    await useRow("Gravitic Snare");
    expect(rowChip("Gravitic Snare")?.textContent).toContain("2 of 2 used");
  });

  it("reports an authored Unlimited rather than counting the rate beside it", async () => {
    // Photonic Swing is authored "Unlimited; once per action". The app runs no
    // action boundary, so counting the rider bucketed it under a tally only a
    // human clears — an ability the page calls UNLIMITED went amber and read
    // "1 of 1 used" after one press, and stayed there until someone hit reset.
    await mount(undefined, () => {}, IN_FIGHT);
    await useRow("Photonic Swing");
    const chip = rowChip("Photonic Swing")!;
    expect(chip.textContent).toContain("Unlimited; once per action");
    expect(chip.textContent).not.toContain("used");
  });
});
