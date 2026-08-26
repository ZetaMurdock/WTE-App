// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CharacterRecord } from "./characters";
import type { CharacterSheet } from "../models/character";
import { emptySheet } from "./sheetCodec";
import {
  MAX_CHANGES_PER_NOTICE,
  MAX_NOTICES,
  clearSheetNotices,
  dismissSheetNotice,
  noticeWhen,
  pendingSheetNotices,
  recordRemoteSheetEdit,
  subscribeSheetNotices,
} from "./sheetNotices";

const CURATOR = { id: "host-1", name: "Rell" };
const PLAYER_SELF = "player-1";

function rec(sheet: Partial<CharacterSheet>, id = "ch-1"): CharacterRecord {
  return {
    id,
    campaignId: "camp-1",
    name: "Kade",
    createdAt: 1,
    updatedAt: 2,
    sheet: { ...emptySheet(), derivedOverrides: { hpMax: 40 }, ...sheet },
  };
}

beforeEach(() => {
  localStorage.clear();
});

describe("recordRemoteSheetEdit", () => {
  it("queues an attributed, timestamped notice for a Curator edit", () => {
    const n = recordRemoteSheetEdit({
      before: rec({ rank: 3 }),
      after: rec({ rank: 4 }),
      by: CURATOR,
      selfId: PLAYER_SELF,
      now: 1_700_000_000_000,
    });
    expect(n).not.toBeNull();
    expect(n!.by).toBe("Rell");
    expect(n!.at).toBe(1_700_000_000_000);
    expect(n!.changes).toEqual(["Rank 3 → 4"]);
    expect(pendingSheetNotices("ch-1")).toEqual([n]);
  });

  it("says nothing about the reader's OWN edit", () => {
    // The echo of our own broadcast comes back with our own peer id. Without this
    // the player is notified about every keystroke they just made.
    const n = recordRemoteSheetEdit({
      before: rec({ rank: 3 }),
      after: rec({ rank: 4 }),
      by: { id: PLAYER_SELF, name: "Kade's player" },
      selfId: PLAYER_SELF,
    });
    expect(n).toBeNull();
    expect(pendingSheetNotices("ch-1")).toEqual([]);
  });

  it("says nothing when the arriving record carries no real change", () => {
    const n = recordRemoteSheetEdit({
      before: rec({ rank: 3, notes: "hunted" }),
      after: rec({ rank: 3, notes: "hunted" }),
      by: CURATOR,
      selfId: PLAYER_SELF,
    });
    expect(n).toBeNull();
    expect(pendingSheetNotices("ch-1")).toEqual([]);
  });

  it("keeps a week of separate edits rather than collapsing them", () => {
    const monday = rec({ rank: 3 });
    const wednesday = rec({ rank: 4 });
    const friday = rec({ rank: 4, hpDamage: 16 });
    recordRemoteSheetEdit({ before: monday, after: wednesday, by: CURATOR, selfId: PLAYER_SELF, now: 100 });
    recordRemoteSheetEdit({ before: wednesday, after: friday, by: CURATOR, selfId: PLAYER_SELF, now: 200 });

    const queue = pendingSheetNotices("ch-1");
    expect(queue.map((n) => n.at)).toEqual([100, 200]); // oldest first
    expect(queue.map((n) => n.changes)).toEqual([["Rank 3 → 4"], ["HP 40 → 24"]]);
  });

  it("survives the app closing — the queue is read back from storage, not memory", () => {
    recordRemoteSheetEdit({ before: rec({ rank: 3 }), after: rec({ rank: 4 }), by: CURATOR, selfId: PLAYER_SELF });
    const raw = localStorage.getItem("wte-sheet-notices:ch-1");
    expect(raw).toBeTruthy();
    // A fresh read with nothing cached is exactly what the next launch does.
    expect(pendingSheetNotices("ch-1")[0].changes).toEqual(["Rank 3 → 4"]);
  });

  it("keeps each character's queue in its own key", () => {
    recordRemoteSheetEdit({ before: rec({ rank: 1 }), after: rec({ rank: 2 }), by: CURATOR, selfId: PLAYER_SELF });
    recordRemoteSheetEdit({
      before: rec({ rank: 5 }, "ch-2"),
      after: rec({ rank: 6 }, "ch-2"),
      by: CURATOR,
      selfId: PLAYER_SELF,
    });
    expect(pendingSheetNotices("ch-1")[0].changes).toEqual(["Rank 1 → 2"]);
    expect(pendingSheetNotices("ch-2")[0].changes).toEqual(["Rank 5 → 6"]);
  });

  it("drops the OLDEST when the queue is full, never the newest", () => {
    for (let i = 0; i < MAX_NOTICES + 5; i++) {
      recordRemoteSheetEdit({ before: rec({ rank: i }), after: rec({ rank: i + 1 }), by: CURATOR, selfId: PLAYER_SELF });
    }
    const queue = pendingSheetNotices("ch-1");
    expect(queue).toHaveLength(MAX_NOTICES);
    expect(queue[queue.length - 1].changes).toEqual([`Rank ${MAX_NOTICES + 4} → ${MAX_NOTICES + 5}`]);
  });

  it("truncates one enormous edit rather than storing all of it", () => {
    const attrs = { ...emptySheet().attributes };
    const before = rec({ attributes: attrs, specialties: { ...emptySheet().specialties } });
    const bumped = Object.fromEntries(Object.keys(attrs).map((k) => [k, 5]));
    const bumpedSpec = Object.fromEntries(Object.keys(emptySheet().specialties).map((k) => [k, 5]));
    const after = rec({
      attributes: bumped as CharacterSheet["attributes"],
      specialties: bumpedSpec as CharacterSheet["specialties"],
      rank: 4,
      pressure: 90,
      eminence: 6,
      morality: 88,
      hpDamage: 8,
      tags: ["Ally", "Wanted"],
    });
    const n = recordRemoteSheetEdit({ before, after, by: CURATOR, selfId: PLAYER_SELF })!;
    expect(n.changes).toHaveLength(MAX_CHANGES_PER_NOTICE + 1);
    expect(n.changes[n.changes.length - 1]).toMatch(/^…and \d+ more changes$/);
  });

  it("discards a hand-mangled entry instead of handing it to the sheet", () => {
    localStorage.setItem("wte-sheet-notices:ch-1", JSON.stringify([{ id: "x" }, { nope: true }]));
    expect(pendingSheetNotices("ch-1")).toEqual([]);
  });
});

describe("dismissal", () => {
  function seedTwo() {
    recordRemoteSheetEdit({ before: rec({ rank: 3 }), after: rec({ rank: 4 }), by: CURATOR, selfId: PLAYER_SELF, now: 1 });
    recordRemoteSheetEdit({ before: rec({ rank: 4 }), after: rec({ rank: 5 }), by: CURATOR, selfId: PLAYER_SELF, now: 2 });
  }

  it("clears everything pending when the player acknowledges", () => {
    seedTwo();
    expect(pendingSheetNotices("ch-1")).toHaveLength(2);
    clearSheetNotices("ch-1");
    expect(pendingSheetNotices("ch-1")).toEqual([]);
    expect(localStorage.getItem("wte-sheet-notices:ch-1")).toBeNull();
  });

  it("drops one notice and leaves the rest", () => {
    seedTwo();
    const [first, second] = pendingSheetNotices("ch-1");
    dismissSheetNotice("ch-1", first.id);
    expect(pendingSheetNotices("ch-1")).toEqual([second]);
  });

  it("removes the key entirely once the last notice goes", () => {
    seedTwo();
    for (const n of pendingSheetNotices("ch-1")) dismissSheetNotice("ch-1", n.id);
    expect(localStorage.getItem("wte-sheet-notices:ch-1")).toBeNull();
  });
});

describe("subscribeSheetNotices", () => {
  it("wakes an open sheet the moment an edit lands, and again when it is cleared", () => {
    const seen: string[] = [];
    const stop = subscribeSheetNotices((id) => seen.push(id));
    recordRemoteSheetEdit({ before: rec({ rank: 3 }), after: rec({ rank: 4 }), by: CURATOR, selfId: PLAYER_SELF });
    clearSheetNotices("ch-1");
    stop();
    recordRemoteSheetEdit({ before: rec({ rank: 4 }), after: rec({ rank: 5 }), by: CURATOR, selfId: PLAYER_SELF });
    expect(seen).toEqual(["ch-1", "ch-1"]);
  });
});

describe("noticeWhen", () => {
  it("stays coarse, and becomes a date once 'ago' stops meaning anything", () => {
    const now = 1_700_000_000_000;
    expect(noticeWhen(now - 5_000, now)).toBe("just now");
    expect(noticeWhen(now - 60_000, now)).toBe("1 minute ago");
    expect(noticeWhen(now - 20 * 60_000, now)).toBe("20 minutes ago");
    expect(noticeWhen(now - 3 * 3_600_000, now)).toBe("3 hours ago");
    const old = now - 9 * 86_400_000;
    expect(noticeWhen(old, now)).toBe(new Date(old).toLocaleDateString());
  });
});

describe("storage failure", () => {
  it("does not throw at the sheet when the device refuses the write", () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    expect(() =>
      recordRemoteSheetEdit({ before: rec({ rank: 3 }), after: rec({ rank: 4 }), by: CURATOR, selfId: PLAYER_SELF })
    ).not.toThrow();
    setItem.mockRestore();
  });
});
