// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { VttSummonPrompt, type SummonMode, type SummonRow } from "./VttSummonPrompt";
import { MAX_SUMMON_BATCH, pageSummons } from "./data/summonPlacement";
import { resolveSummon, type CodexSummonEntry } from "./data/summonRoster";

// NOT what ships — see the note in summonPlacement.test.ts. This is what a
// table would write if it forked Minion Conjuration into the declared grammar.
const FORKED_MINION_CONJURATION = `
## Actions
- Summon: 100 Lesser Stygian
`;

const MINION: CodexSummonEntry = { name: "Lesser Stygian", hp: 14, cls: 1, size: 1 };

function rows(block: string, codex: CodexSummonEntry[]): SummonRow[] {
  return pageSummons(block).map((summon) => ({ summon, resolution: resolveSummon(summon.name, { codex }) }));
}

let host: HTMLDivElement;
let root: Root;

async function mount(overrides: Partial<Parameters<typeof VttSummonPrompt>[0]> = {}) {
  const props = {
    abilityName: "Minion Conjuration",
    rows: rows(FORKED_MINION_CONJURATION, [MINION]),
    casterName: "Kira",
    hasCasterToken: true,
    hasSelectedToken: false,
    roomFor: (() => 100) as (row: SummonRow, mode: SummonMode) => number,
    onPlace: vi.fn(),
    onCancel: vi.fn(),
    ...overrides,
  };
  await act(async () => {
    root.render(<VttSummonPrompt {...props} />);
  });
  return props;
}

function button(text: string): HTMLButtonElement | undefined {
  return [...host.querySelectorAll<HTMLButtonElement>("button")].find((item) => item.textContent?.trim() === text);
}

beforeEach(() => {
  document.body.innerHTML = "";
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

describe("VttSummonPrompt", () => {
  it("places nothing until a human presses the button", async () => {
    // The whole reason this component exists. A summon is a proposal like every
    // other consequence in this engine; rendering it must have no effect.
    const props = await mount();
    expect(props.onPlace).not.toHaveBeenCalled();
    await act(async () => button("Place bodies")?.click());
    expect(props.onPlace).toHaveBeenCalledWith("self");
  });

  it("says where the statline came from, so the Curator knows where to edit it", async () => {
    await mount();
    expect(host.textContent).toContain("100 × Lesser Stygian");
    expect(host.textContent).toContain("Codex creature page");
    expect(host.textContent).toContain("14 HP");
  });

  it("says out loud when the bodies will arrive with no profile", async () => {
    // The Kirkndomou case: prose states 75 HP, nothing is named for it, and the
    // Curator must be told BEFORE confirming rather than discovering it on the
    // map. It is still placeable — bodies with no numbers beat no bodies.
    await mount({ rows: rows("## Actions\n- Summon: Kirkndomou", [MINION]) });
    expect(host.textContent).toContain("No creature page or quick creature is named");
    expect(host.textContent).not.toContain("75");
    expect(button("Place bodies")?.disabled).toBe(false);
  });

  it("refuses to arm while the roster is still loading", async () => {
    // Confirming against a half-read roster is how a creature that HAS a page
    // arrives unstatted — the page simply had not come back yet.
    await mount({ loading: true });
    expect(button("Place bodies")?.disabled).toBe(true);
  });

  it("refuses to arm when one name has two statlines", async () => {
    await mount({ rows: rows(FORKED_MINION_CONJURATION, [MINION, { ...MINION, hp: 900 }]) });
    expect(button("Place bodies")?.disabled).toBe(true);
    expect(host.textContent).toContain("rename one");
  });

  it("shows the shortfall while the placement is still cancellable", async () => {
    // 63 of 100 is a fact the Curator can act on before committing; discovering
    // it afterwards, by counting tokens, is not.
    await mount({ roomFor: () => 63 });
    expect(host.textContent).toContain("Room for 63 of 100");
  });

  it("names the cap rather than silently truncating a typo", async () => {
    await mount({ rows: rows(`## Actions\n- Summon: ${MAX_SUMMON_BATCH + 1} Lesser Stygian`, [MINION]) });
    expect(button("Place bodies")?.disabled).toBe(true);
    expect(host.textContent).toContain(String(MAX_SUMMON_BATCH));
  });

  it("offers the caster only when the caster is actually on this map", async () => {
    await mount({ hasCasterToken: false });
    expect(button("Kira")?.disabled).toBe(true);
    // …and falls back to an anchor that always exists rather than arming a
    // placement that has nowhere to start from.
    await act(async () => button("Place bodies")?.click());
    expect(host.textContent).toContain("The view centre");
  });
});
