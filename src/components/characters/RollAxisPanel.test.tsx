// @vitest-environment happy-dom
import { act } from "react";
import type { ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RollMode } from "../../game/wte";
import type { RollAxisStats } from "../../game/rollAxis";
import { RollAxisPanel } from "./RollAxisPanel";

vi.mock("./RollButton", () => ({
  RollButton: ({ make, onLocal, children, className }: { make: (mode: RollMode) => unknown; onLocal: (roll: unknown) => void; children: ReactNode; className?: string }) => (
    <button className={className} onClick={() => onLocal(make("normal"))}>{children}</button>
  ),
}));

const stats: RollAxisStats = {
  attr: { phy: 2, ap: 1, dex: 2, end: 0, wis: 1, int: 3, cha: -1 },
  spec: { wm: 4, pre: 3, bal: -2, adp: 1, mf: 0, per: 5, cun: -3 },
  derived: { atk: 3, ad: 2, ev: -3, rr: -1, nc: 4, pr: 1, inf: -2 },
};

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  document.body.innerHTML = "";
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

describe("character-sheet Roll Axis panel", () => {
  it("walks Physical → Saves → Evasion and rolls the full visible pipeline", async () => {
    const onRoll = vi.fn();
    await act(async () => root.render(<RollAxisPanel stats={stats} onRoll={onRoll} />));
    // Path cards carry a source summary under the name, so match by prefix.
    const find = (name: string) => [...host.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.trim().startsWith(name));
    await act(async () => find("Physical")!.click());
    await act(async () => find("Save — you resist")!.click());
    await act(async () => find("Evasion Save")!.click());

    const dexterity = [...host.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.includes("Dexterity"));
    expect(dexterity?.textContent).toContain("+2 DEX");
    expect(dexterity?.textContent).toContain("-3 EV");
    await act(async () => dexterity!.click());
    expect(onRoll).toHaveBeenCalledWith(expect.objectContaining({
      formula: expect.stringMatching(/^1d20 \+ 2 DEX - 3 EV/),
      detail: expect.objectContaining({ modifier: -1, label: "Evasion Save · Dexterity" }),
    }));
  });
});
