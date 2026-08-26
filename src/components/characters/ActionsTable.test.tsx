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
 *  layer draws lives behind the expander. `ssLeft` defaults high enough that a
 *  test which is not about affordability never trips the refusal. */
async function openRow(a: UsableAbility, over: { ssLeft?: number; onSpend?: (cost: number) => void } = {}) {
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
          onSpend={over.onSpend ?? vi.fn()}
          ssLeft={over.ssLeft ?? 99}
          onManage={vi.fn()}
        />
      </NetProvider>
    )
  );
  const row = host.querySelector<HTMLButtonElement>("button.act-row");
  if (!row) throw new Error("The Actions table never rendered the ability row.");
  await act(async () => row.click());
}

/** The Use button, by the text it prints rather than by position — the row's
 *  other ghost buttons (Contest…) sit in the same strip. */
function useButton(): HTMLButtonElement | undefined {
  return [...host.querySelectorAll<HTMLButtonElement>(".act-actions button.ghost-btn")].find((b) =>
    /^Use −/.test(b.textContent ?? "")
  );
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

describe("spending what an ability costs", () => {
  it("takes nothing from the pool merely for opening the row", async () => {
    // A cost that deducted on render — or on a click that only means "let me
    // read this" — would charge a player for looking at their own sheet.
    const onSpend = vi.fn();
    await openRow(ability(BLOCK), { onSpend });
    expect(onSpend).not.toHaveBeenCalled();
  });

  it("spends the declared price, not the header field beside it", async () => {
    const onSpend = vi.fn();
    // The page says 6 SS in its header and 9 SS in its block. Before the plan
    // existed the button deducted the header and the block was decoration.
    await openRow({ ...ability(BLOCK.replace("- Cost: 6 SS", "- Cost: 9 SS")) }, { onSpend });
    expect(useButton()?.textContent).toBe("Use −9 SS");
    await act(async () => useButton()!.click());
    expect(onSpend).toHaveBeenCalledWith(9);
  });

  it("still spends the header field when a partial block names no price", async () => {
    // A partial block declares what it declares and deletes nothing else.
    const onSpend = vi.fn();
    await openRow(ability("- Fail: Damage: 3d10 Cold"), { onSpend });
    expect(useButton()?.textContent).toBe("Use −6 SS");
    await act(async () => useButton()!.click());
    expect(onSpend).toHaveBeenCalledWith(6);
  });

  it("spends the header field for an ability with no block at all", async () => {
    const onSpend = vi.fn();
    await openRow(ability(), { onSpend });
    expect(useButton()?.textContent).toBe("Use −6 SS");
    await act(async () => useButton()!.click());
    expect(onSpend).toHaveBeenCalledWith(6);
  });

  it("warns about a price bigger than the pool without taking the click away", async () => {
    // The engine proposes; the character decides. Overspending paints the
    // reservoir red — `.ss-fill.neg` exists for exactly this — and no page in
    // the corpus writes a rule against reaching past it, so a disabled button
    // would be this build ruling on a table it does not sit at.
    const onSpend = vi.fn();
    await openRow(ability(BLOCK), { onSpend, ssLeft: 5 });
    expect(useButton()?.disabled).toBe(false);
    expect(texts(".act-step-chip.bad")).toEqual(["Overspends — needs 6, 5 left"]);
    await act(async () => useButton()!.click());
    expect(onSpend).toHaveBeenCalledWith(6);
  });

  it("says nothing extra for an undeclared ability the pool covers", async () => {
    // The governing invariant, at the surface a player looks at: an ability with
    // no block draws the same one button and no chip beside it.
    await openRow(ability(), { ssLeft: 99 });
    expect(useButton()?.textContent).toBe("Use −6 SS");
    expect(useButton()?.disabled).toBe(false);
    expect(texts(".act-step-chip.bad")).toEqual([]);
  });

  it("spends a price the pool exactly covers", async () => {
    const onSpend = vi.fn();
    await openRow(ability(BLOCK), { onSpend, ssLeft: 6 });
    expect(useButton()?.disabled).toBe(false);
    await act(async () => useButton()!.click());
    expect(onSpend).toHaveBeenCalledWith(6);
  });

  it("marks a cost in another pool unspent rather than taking it out of SS", async () => {
    const onSpend = vi.fn();
    await openRow(ability("- Cost: 4 health"), { onSpend });
    expect(useButton()).toBeUndefined();
    expect(texts(".act-step-chip.bad")).toEqual(["4 HEALTH · not spent"]);
  });
});
