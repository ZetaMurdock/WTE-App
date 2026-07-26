import { describe, expect, it } from "vitest";
import { toShrives } from "../game/money";
import { mergeLink, parseLink, type TableLink } from "./activeTable";

const base = (over: Partial<TableLink> = {}): TableLink => ({
  room: "VAULT7",
  campaignId: "c1",
  campaignName: "The Sunken Vault",
  purse: 0,
  inventory: [],
  joinedAt: 1000,
  lastSeen: 1000,
  ...over,
});

describe("table links", () => {
  it("upserts by room, newest first", () => {
    let l = mergeLink([], { room: "AAA", campaignId: "c1", campaignName: "One" }, 10);
    l = mergeLink(l, { room: "BBB", campaignId: "c2", campaignName: "Two" }, 20);
    expect(l.map((t) => t.room)).toEqual(["BBB", "AAA"]);
    l = mergeLink(l, { room: "AAA" }, 30);
    expect(l.map((t) => t.room)).toEqual(["AAA", "BBB"]);
    expect(l).toHaveLength(2);
  });

  it("a room-info carrying only the campaign never wipes my chosen character", () => {
    // The bug this guards: the host re-announces the campaign on every join, and
    // that must not clear which character each player has in use.
    let l = mergeLink([], { room: "VAULT7", inUseCharacterId: "char-9" });
    l = mergeLink(l, { room: "VAULT7", campaignId: "c1", campaignName: "The Sunken Vault" });
    expect(l[0].inUseCharacterId).toBe("char-9");
    expect(l[0].campaignName).toBe("The Sunken Vault");
  });

  it("keeps the original joinedAt but moves lastSeen", () => {
    let l = mergeLink([], { room: "AAA" }, 100);
    l = mergeLink(l, { room: "AAA" }, 500);
    expect(l[0].joinedAt).toBe(100);
    expect(l[0].lastSeen).toBe(500);
  });

  it("clears the in-use character when explicitly given an empty string", () => {
    let l = mergeLink([], { room: "AAA", inUseCharacterId: "c9" });
    l = mergeLink(l, { room: "AAA", inUseCharacterId: "" });
    expect(l[0].inUseCharacterId).toBeUndefined();
  });

  it("clamps a purse through the money rules", () => {
    const l = mergeLink([], { room: "AAA", purse: -500 });
    expect(l[0].purse).toBe(0);
    const l2 = mergeLink([], { room: "AAA", purse: toShrives({ credits: 3 }) });
    expect(l2[0].purse).toBe(30_000);
  });

  it("refuses a blank room", () => {
    expect(mergeLink([], { room: "   " })).toEqual([]);
  });

  it("parses a hand-edited blob and rejects one with no room", () => {
    expect(parseLink({ room: "AAA", purse: "nonsense" })?.purse).toBe(0);
    expect(parseLink({ campaignId: "c1" })).toBeNull();
    expect(parseLink(null)).toBeNull();
    const p = parseLink(base({ inUseCharacterId: "" }));
    expect(p?.inUseCharacterId).toBeUndefined();
  });
});
