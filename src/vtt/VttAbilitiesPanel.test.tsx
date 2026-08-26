// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CharacterRecord } from "../lib/characters";
import { VttAbilitiesPanel } from "./VttAbilitiesPanel";
import { parseRollFormulaPage, setCodexRollFormulas } from "../game/rollFormula";

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
        ss: 1,
        meta: { targets: 1, range: null, area: null, pattern: null, duration: null, attach: "target", values: [] },
      },
      {
        id: "ability-axis",
        name: "Phase Trap",
        source: "genus",
        effect: "The target makes a Physical Save — Evasion.",
        ss: 2,
        meta: { targets: 1, range: null, area: null, pattern: null, duration: null, attach: "target", values: [] },
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
  onArmRoll: Parameters<typeof VttAbilitiesPanel>[0]["onArmRoll"] = () => {}
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
        onClose={() => {}}
      />
    );
  });
}

beforeEach(() => {
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
