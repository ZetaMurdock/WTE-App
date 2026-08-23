// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CharacterRecord } from "../lib/characters";
import { VttAbilitiesPanel } from "./VttAbilitiesPanel";

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
    ],
    cipher: [],
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

    expect(request).toHaveBeenCalledWith({
      abilityId: "ability-1",
      abilityName: "Gravitic Snare",
      sourceCharacterId: "caster-1",
      label: "Endurance save · DC 18",
      stat: "Endurance",
      dc: 18,
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
});
