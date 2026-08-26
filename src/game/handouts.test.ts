import { describe, expect, it } from "vitest";
import { MAX_HANDOUTS, MAX_HANDOUT_TEXT, giveHandout, removeHandout, validHandout } from "./handouts";

describe("handouts", () => {
  it("records who handed it over and when", () => {
    const next = giveHandout(undefined, { title: "Torn ledger page", text: "…paid in Scrap.", by: "The Curator", now: 1700 });
    expect(next).toHaveLength(1);
    expect(next![0]).toMatchObject({ title: "Torn ledger page", text: "…paid in Scrap.", by: "The Curator", at: 1700 });
    expect(next![0].id).toBeTruthy();
  });

  it("appends rather than replacing, so an earlier handout survives a later one", () => {
    const first = giveHandout(undefined, { title: "A", text: "a", by: "The Curator", now: 1 })!;
    const second = giveHandout(first, { title: "B", text: "b", by: "The Curator", now: 2 })!;
    expect(second.map((h) => h.title)).toEqual(["A", "B"]);
  });

  it("gives every entry its own identity, so two identical notes are two notes", () => {
    const first = giveHandout(undefined, { title: "Rumour", text: "same", by: "The Curator", now: 1 })!;
    const second = giveHandout(first, { title: "Rumour", text: "same", by: "The Curator", now: 2 })!;
    expect(second[0].id).not.toBe(second[1].id);
  });

  it("refuses an empty gift", () => {
    expect(giveHandout(undefined, { title: "  ", text: "\n", by: "The Curator" })).toBeNull();
  });

  it("keeps a title-only handout — a name can be the whole message", () => {
    expect(giveHandout(undefined, { title: "The password is 'ash'", text: "", by: "The Curator" })).toHaveLength(1);
  });

  it("drops the OLDEST when full, never the one just given", () => {
    let list = Array.from({ length: MAX_HANDOUTS }, (_, i) => ({
      id: `h${i}`,
      title: `t${i}`,
      text: "",
      by: "The Curator",
      at: i,
    }));
    const next = giveHandout(list, { title: "newest", text: "", by: "The Curator", now: 999 })!;
    expect(next).toHaveLength(MAX_HANDOUTS);
    expect(next[next.length - 1].title).toBe("newest");
    expect(next.find((h) => h.id === "h0")).toBeUndefined();
    list = next;
    expect(list[0].id).toBe("h1");
  });

  it("bounds the body so one gift cannot make a sheet too large to broadcast", () => {
    const next = giveHandout(undefined, { title: "Long", text: "x".repeat(MAX_HANDOUT_TEXT + 500), by: "The Curator" })!;
    expect(next[0].text).toHaveLength(MAX_HANDOUT_TEXT);
  });

  it("rejects entries a damaged record could carry", () => {
    expect(validHandout({ id: "a", title: "t", text: "", by: "The Curator", at: 1 })).toBe(true);
    expect(validHandout({ id: "", title: "t", text: "", by: "The Curator", at: 1 })).toBe(false);
    expect(validHandout({ id: "a", title: "t", text: "", by: "The Curator" })).toBe(false);
    expect(validHandout("note")).toBe(false);
  });

  it("takes one back by identity, and reports nothing when there was none", () => {
    const list = giveHandout(undefined, { title: "A", text: "", by: "The Curator", now: 1 })!;
    expect(removeHandout(list, list[0].id)).toEqual([]);
    expect(removeHandout(list, "nope")).toBeNull();
  });
});
