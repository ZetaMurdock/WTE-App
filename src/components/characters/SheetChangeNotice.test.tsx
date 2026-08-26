// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CharacterRecord } from "../../lib/characters";
import type { CharacterSheet } from "../../models/character";
import { emptySheet } from "../../lib/sheetCodec";
import { pendingSheetNotices, recordRemoteSheetEdit } from "../../lib/sheetNotices";
import { SheetChangeNotice } from "./SheetChangeNotice";

const CURATOR = { id: "host-1", name: "Rell" };
const SELF = "player-1";

function rec(sheet: Partial<CharacterSheet>): CharacterRecord {
  return {
    id: "ch-1",
    campaignId: "camp-1",
    name: "Kade",
    createdAt: 1,
    updatedAt: 2,
    sheet: { ...emptySheet(), derivedOverrides: { hpMax: 40 }, ...sheet },
  };
}

function curatorEdit(before: Partial<CharacterSheet>, after: Partial<CharacterSheet>, now?: number) {
  recordRemoteSheetEdit({ before: rec(before), after: rec(after), by: CURATOR, selfId: SELF, now });
}

let host: HTMLDivElement;
let root: Root;

function render() {
  act(() => {
    root.render(<SheetChangeNotice characterId="ch-1" />);
  });
}

function click(text: string) {
  const btn = [...host.querySelectorAll("button")].find((b) => b.textContent === text);
  if (!btn) throw new Error(`no button labelled "${text}" — found: ${[...host.querySelectorAll("button")].map((b) => b.textContent).join(", ")}`);
  act(() => {
    btn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

beforeEach(() => {
  localStorage.clear();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("SheetChangeNotice", () => {
  it("renders nothing at all when no one has touched the sheet", () => {
    render();
    expect(host.innerHTML).toBe("");
  });

  it("names the editor and the change without needing a click", () => {
    curatorEdit({ rank: 3 }, { rank: 4 });
    render();
    expect(host.textContent).toContain("Rell");
    expect(host.textContent).toContain("changed your sheet");
    expect(host.textContent).toContain("Rank 3 → 4");
  });

  it("summarises several queued edits and lists them on demand", () => {
    curatorEdit({ rank: 3 }, { rank: 4 }, 1000);
    curatorEdit({ rank: 4 }, { rank: 4, hpDamage: 16 }, 2000);
    render();
    expect(host.textContent).toContain("2 changes across 2 edits");
    // Collapsed, the individual lines are not on the page yet.
    expect(host.textContent).not.toContain("HP 40 → 24");
    click("What changed?");
    expect(host.textContent).toContain("Rank 3 → 4");
    expect(host.textContent).toContain("HP 40 → 24");
  });

  it("clears everything when the player acknowledges", () => {
    curatorEdit({ rank: 3 }, { rank: 4 });
    curatorEdit({ rank: 4 }, { rank: 5 });
    render();
    click("Got it");
    expect(host.innerHTML).toBe("");
    expect(pendingSheetNotices("ch-1")).toEqual([]);
  });

  it("dismisses one edit and keeps the other", () => {
    curatorEdit({ rank: 3 }, { rank: 4 }, 1000);
    curatorEdit({ rank: 4 }, { rank: 5 }, 2000);
    render();
    click("What changed?");
    click("Dismiss"); // the newest is listed first
    expect(host.textContent).toContain("Rank 3 → 4");
    expect(host.textContent).not.toContain("Rank 4 → 5");
    expect(pendingSheetNotices("ch-1")).toHaveLength(1);
  });

  it("appears live, while the sheet is already open", () => {
    render();
    expect(host.innerHTML).toBe("");
    act(() => curatorEdit({ rank: 3 }, { rank: 4 }));
    expect(host.textContent).toContain("Rank 3 → 4");
  });

  it("stays silent for the player's own edit", () => {
    recordRemoteSheetEdit({ before: rec({ rank: 3 }), after: rec({ rank: 4 }), by: { id: SELF, name: "me" }, selfId: SELF });
    render();
    expect(host.innerHTML).toBe("");
  });

  it("does not steal focus from whatever the player was typing in", () => {
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();
    render();
    act(() => curatorEdit({ rank: 3 }, { rank: 4 }));
    expect(document.activeElement).toBe(input);
    input.remove();
  });
});
