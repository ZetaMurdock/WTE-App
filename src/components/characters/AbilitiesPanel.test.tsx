// @vitest-environment happy-dom
//
// The Ciphers picker WRITES the loadout that usableCiphers reads back. Once
// resolution learned to answer to a permanent id and to a former name, a picker
// still comparing the literal string was a second opinion about what a character
// has taken — and the two only disagree in the direction that costs the player a
// slot, because an unticked row invites a second entry for the same cipher.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { bakedCiphers } from "../../game/wte";
import { AbilitiesBody } from "./AbilitiesPanel";

const CIPHER = bakedCiphers()["science"][0];

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  document.body.innerHTML = "";
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

function rowFor(name: string): HTMLButtonElement {
  const row = [...host.querySelectorAll<HTMLButtonElement>("button.ability-row")].find((button) =>
    button.querySelector(".ability-name")?.textContent === name
  );
  if (!row) throw new Error(`The Ciphers picker never rendered a row for ${name}.`);
  return row;
}

async function render(loadout: string[], onCiphers: (names: string[]) => void) {
  await act(async () =>
    root.render(
      <AbilitiesBody
        paradigmId="science"
        rank={3}
        spend={{ genus: {}, incepts: [] }}
        cipherLoadout={loadout}
        onSpend={() => {}}
        onCiphers={onCiphers}
      />
    )
  );
}

describe("the Ciphers picker agrees with cipher resolution", () => {
  it("ticks the row a loadout stored under the permanent id", async () => {
    await render([CIPHER.id!], () => {});
    expect(rowFor(CIPHER.name).className).toContain("selected");
  });

  it("unticking removes the entry actually held, rather than adding a second", async () => {
    const onCiphers = vi.fn();
    await render([CIPHER.id!], onCiphers);
    await act(async () => rowFor(CIPHER.name).click());
    expect(onCiphers).toHaveBeenCalledWith([]);
  });

  it("still stores the display name when the row is picked fresh", async () => {
    const onCiphers = vi.fn();
    await render([], onCiphers);
    await act(async () => rowFor(CIPHER.name).click());
    expect(onCiphers).toHaveBeenCalledWith([CIPHER.name]);
  });
});
