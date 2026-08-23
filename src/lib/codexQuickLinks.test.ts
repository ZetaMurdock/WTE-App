// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";
import {
  isPinned,
  moveQuickLink,
  readOpenGroups,
  readQuickLinks,
  reconcileQuickLinks,
  setGroupOpen,
  toggleQuickLink,
  type CodexQuickLink,
} from "./codexQuickLinks";

const CAMPAIGN = "ashen-sun";
const OTHER = "iron-wake";
const link = (id: string, title = id): CodexQuickLink => ({ id, stem: `stem-${id}`, title });

beforeEach(() => localStorage.clear());

describe("pinned rules", () => {
  it("starts empty and survives a round trip", () => {
    expect(readQuickLinks(CAMPAIGN)).toEqual([]);
    toggleQuickLink(CAMPAIGN, link("wte.species.oriyu", "Oriyu"));
    expect(readQuickLinks(CAMPAIGN)).toEqual([
      { id: "wte.species.oriyu", stem: "stem-wte.species.oriyu", title: "Oriyu" },
    ]);
  });

  it("toggles off again", () => {
    toggleQuickLink(CAMPAIGN, link("a"));
    expect(isPinned(toggleQuickLink(CAMPAIGN, link("a")), "a")).toBe(false);
    expect(readQuickLinks(CAMPAIGN)).toEqual([]);
  });

  it("keeps one table's working set out of another's", () => {
    toggleQuickLink(CAMPAIGN, link("a"));
    toggleQuickLink(OTHER, link("b"));
    expect(readQuickLinks(CAMPAIGN).map((l) => l.id)).toEqual(["a"]);
    expect(readQuickLinks(OTHER).map((l) => l.id)).toEqual(["b"]);
  });

  it("appends rather than reordering the existing set", () => {
    toggleQuickLink(CAMPAIGN, link("a"));
    toggleQuickLink(CAMPAIGN, link("b"));
    expect(toggleQuickLink(CAMPAIGN, link("c")).map((l) => l.id)).toEqual(["a", "b", "c"]);
  });

  it("reorders on request, and refuses to fall off either end", () => {
    for (const id of ["a", "b", "c"]) toggleQuickLink(CAMPAIGN, link(id));
    expect(moveQuickLink(CAMPAIGN, "c", -1).map((l) => l.id)).toEqual(["a", "c", "b"]);
    expect(moveQuickLink(CAMPAIGN, "a", -1).map((l) => l.id)).toEqual(["a", "c", "b"]);
    expect(moveQuickLink(CAMPAIGN, "b", 1).map((l) => l.id)).toEqual(["a", "c", "b"]);
    expect(readQuickLinks(CAMPAIGN).map((l) => l.id)).toEqual(["a", "c", "b"]);
  });

  it("ignores a move for an id it does not hold", () => {
    toggleQuickLink(CAMPAIGN, link("a"));
    expect(moveQuickLink(CAMPAIGN, "ghost", 1).map((l) => l.id)).toEqual(["a"]);
  });

  it("survives corrupt storage instead of throwing", () => {
    localStorage.setItem(`wte-codex-pins:${CAMPAIGN}`, "{not json");
    expect(readQuickLinks(CAMPAIGN)).toEqual([]);
  });

  it("rejects a stored list whose entries are the wrong shape", () => {
    localStorage.setItem(`wte-codex-pins:${CAMPAIGN}`, JSON.stringify([{ id: 7 }]));
    expect(readQuickLinks(CAMPAIGN)).toEqual([]);
  });

  it("has no pins for a campaign that has not been chosen yet", () => {
    expect(readQuickLinks("")).toEqual([]);
  });
});

describe("reconciling pins against the live Codex", () => {
  it("follows a rename", () => {
    toggleQuickLink(CAMPAIGN, link("wte.species.oriyu", "Oriyu"));
    const next = reconcileQuickLinks(CAMPAIGN, readQuickLinks(CAMPAIGN), [
      { id: "wte.species.oriyu", stem: "species-oriyu", title: "Voidborn" },
    ]);
    expect(next).toEqual([{ id: "wte.species.oriyu", stem: "species-oriyu", title: "Voidborn" }]);
    // Persisted, not just returned — the next mount must not show the old name.
    expect(readQuickLinks(CAMPAIGN)[0].title).toBe("Voidborn");
  });

  it("drops a pin whose page is gone", () => {
    toggleQuickLink(CAMPAIGN, link("a"));
    toggleQuickLink(CAMPAIGN, link("b"));
    const next = reconcileQuickLinks(CAMPAIGN, readQuickLinks(CAMPAIGN), [
      { id: "b", stem: "stem-b", title: "b" },
    ]);
    expect(next.map((l) => l.id)).toEqual(["b"]);
  });

  it("leaves an unchanged set alone", () => {
    toggleQuickLink(CAMPAIGN, link("a"));
    const before = readQuickLinks(CAMPAIGN);
    expect(reconcileQuickLinks(CAMPAIGN, before, [{ id: "a", stem: "stem-a", title: "a" }])).toEqual(before);
  });

  it("does not wipe pins while the manifest is still empty", () => {
    // An in-flight or failed build must not read as "every rule was deleted".
    toggleQuickLink(CAMPAIGN, link("a"));
    expect(reconcileQuickLinks(CAMPAIGN, readQuickLinks(CAMPAIGN), []).map((l) => l.id)).toEqual(["a"]);
    expect(readQuickLinks(CAMPAIGN).map((l) => l.id)).toEqual(["a"]);
  });
});

describe("expanded sections", () => {
  it("remembers which sections were open, per campaign", () => {
    expect(readOpenGroups(CAMPAIGN)).toEqual([]);
    setGroupOpen(CAMPAIGN, "species", true);
    setGroupOpen(CAMPAIGN, "paradigm", true);
    expect(readOpenGroups(CAMPAIGN)).toEqual(["species", "paradigm"]);
    expect(readOpenGroups(OTHER)).toEqual([]);
  });

  it("closes a section again", () => {
    setGroupOpen(CAMPAIGN, "species", true);
    expect(setGroupOpen(CAMPAIGN, "species", false)).toEqual([]);
  });

  it("does not record a section twice", () => {
    setGroupOpen(CAMPAIGN, "species", true);
    expect(setGroupOpen(CAMPAIGN, "species", true)).toEqual(["species"]);
  });
});
