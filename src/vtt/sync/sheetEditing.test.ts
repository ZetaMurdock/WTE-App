// @vitest-environment happy-dom
// The question this answers decides whether a remote edit is applied now or held,
// so the cases that matter are the ones where holding would be WRONG (nobody is
// typing, the sheet is just open) and where applying would destroy work.
import { beforeEach, describe, expect, it } from "vitest";
import { isEditingWithin } from "./sheetEditing";

const OVERLAY = ".vtt2-sheet-overlay";

function mount(html: string): void {
  document.body.innerHTML = `<div class="vtt2-sheet-overlay">${html}</div><input id="outside" />`;
}

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("is the reader typing into the sheet", () => {
  it("says yes for a focused text field inside the sheet", () => {
    mount(`<input id="notes" />`);
    const el = document.getElementById("notes") as HTMLInputElement;
    el.focus();
    expect(isEditingWithin(document.activeElement, OVERLAY)).toBe(true);
  });

  it("says yes for a textarea — the long note is the one worth protecting", () => {
    mount(`<textarea id="bio"></textarea>`);
    (document.getElementById("bio") as HTMLTextAreaElement).focus();
    expect(isEditingWithin(document.activeElement, OVERLAY)).toBe(true);
  });

  it("says no for a focused BUTTON: a tab or a roll is not work a refresh destroys", () => {
    mount(`<button id="tab">Stats</button>`);
    (document.getElementById("tab") as HTMLButtonElement).focus();
    expect(isEditingWithin(document.activeElement, OVERLAY)).toBe(false);
  });

  it("says no for a field OUTSIDE the sheet — a chat message must not stall sheet sync", () => {
    mount(`<input id="notes" />`);
    (document.getElementById("outside") as HTMLInputElement).focus();
    expect(isEditingWithin(document.activeElement, OVERLAY)).toBe(false);
  });

  it("says no for a read-only field, which the Curator's locked view is full of", () => {
    mount(`<input id="ro" readonly />`);
    (document.getElementById("ro") as HTMLInputElement).focus();
    expect(isEditingWithin(document.activeElement, OVERLAY)).toBe(false);
  });

  it("says no when nothing is focused at all", () => {
    mount(`<input id="notes" />`);
    expect(isEditingWithin(null, OVERLAY)).toBe(false);
    expect(isEditingWithin(document.body, OVERLAY)).toBe(false);
  });
});
