// @vitest-environment happy-dom
//
// The sheet is where a Curator finds out whether their `## Actions` block did
// anything. Two failures would both look fine in a unit test and wrong at the
// table: the block's damage arriving BESIDE the prose's damage (one effect, two
// buttons), and a declared cost or condition never being drawn at all, so a
// fully declared ability reads as doing less than the prose it replaced.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NetProvider } from "../../net/NetContext";
import type { UsableAbility } from "../../game/wte";
import { ActionsTable } from "./ActionsTable";

const EFFECT =
  "The Inquisitor freezes the air solid. The target makes a Physical Save — Recovery (DV 15) " +
  "or takes 2d8 Cold damage.";

const BLOCK = [
  "- Cost: 6 SS",
  "- Save (target): Physical Save — Recovery, DV 18",
  "- Fail: Damage: 3d10 Cold, half on success",
  "- Fail: Condition: Slowed, 2 rounds",
  "- Ruling: brittle objects shatter — Curator adjudicates",
].join("\n");

const ability = (actions?: string): UsableAbility => ({
  source: "genus",
  id: "wte.genus.cryo-lock",
  name: "Cryo Lock",
  ss: 6,
  effect: EFFECT,
  actions,
});

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  document.body.innerHTML = "";
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

/** Render one genus ability and open its row — everything the understanding
 *  layer draws lives behind the expander. */
async function openRow(a: UsableAbility) {
  await act(async () =>
    root.render(
      // RollButton reads the table session to know whether advantage dice are
      // approved, so the row cannot render outside a provider.
      <NetProvider>
        <ActionsTable
          weapons={[]}
          genus={[a]}
          ciphers={[]}
          atk={0}
          phyMod={0}
          dexMod={0}
          onRoll={vi.fn()}
          onSpend={vi.fn()}
          onManage={vi.fn()}
        />
      </NetProvider>
    )
  );
  const row = host.querySelector<HTMLButtonElement>("button.act-row");
  if (!row) throw new Error("The Actions table never rendered the ability row.");
  await act(async () => row.click());
}

const texts = (selector: string) =>
  [...host.querySelectorAll(selector)].map((el) => el.textContent?.trim() ?? "");

describe("an ability whose page declares nothing", () => {
  it("still shows the buttons its prose calls for", async () => {
    await openRow(ability());
    expect(texts(".roll-btn.dmg")).toEqual(["2d8 Cold"]);
    expect(texts(".act-save-chip")).toEqual(["vs Physical Save — Recovery · DV 15"]);
    expect(host.querySelector(".act-steps")).toBeNull();
  });
});

describe("an ability whose page declares its steps", () => {
  it("rolls the declared damage instead of the prose's, not as well as it", async () => {
    await openRow(ability(BLOCK));
    expect(texts(".roll-btn.dmg")).toEqual(["On fail · 3d10 Cold"]);
  });

  it("keys the save chip off the declared DV", async () => {
    await openRow(ability(BLOCK));
    expect(texts(".act-save-chip")).toEqual(["vs Physical Save — Recovery · DV 18"]);
  });

  it("draws the cost, the condition and the ruling it declared", async () => {
    await openRow(ability(BLOCK));
    expect(texts(".act-step-chip")).toEqual(["6 SS", "On fail · Slowed · 2 rounds", "Curator rules"]);
  });

  it("leaves the authored prose on the page for a human to read", async () => {
    // Declaring steps replaces how the ability is ROLLED, never what it says.
    await openRow(ability(BLOCK));
    expect(host.querySelector(".act-effect")?.textContent).toBe(EFFECT);
  });

  it("says so when a line cannot be read rather than doing less in silence", async () => {
    await openRow(ability("- Cost: 6 SS\n- Save: Physical Save — Power"));
    expect(texts(".act-step-chip.bad")).toEqual(["Unreadable step"]);
  });
});
