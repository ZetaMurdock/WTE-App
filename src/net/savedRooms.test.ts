import { describe, expect, it } from "vitest";
import { mergeRoom, withoutRoom, type SavedRoom, newRoomCode } from "./savedRooms";

const room = (code: string, over: Partial<SavedRoom> = {}): SavedRoom => ({ code, role: "player", lastUsed: 1, ...over });

describe("mergeRoom", () => {
  it("adds a new room at the front", () => {
    const out = mergeRoom([room("old")], { code: "fresh", role: "host" }, 99);
    expect(out.map((r) => r.code)).toEqual(["fresh", "old"]);
    expect(out[0]).toMatchObject({ role: "host", lastUsed: 99 });
  });
  it("re-using a room bumps it to the front and keeps its info", () => {
    const list = [room("a"), room("b", { nextSession: "Sat 8pm", role: "host" })];
    const out = mergeRoom(list, { code: "b" }, 99);
    expect(out.map((r) => r.code)).toEqual(["b", "a"]);
    expect(out[0]).toMatchObject({ role: "host", nextSession: "Sat 8pm", lastUsed: 99 });
  });
  it("patches only the fields given", () => {
    const out = mergeRoom([room("a", { role: "host", nextSession: "x" })], { code: "a", nextSession: "Sun noon" });
    expect(out[0]).toMatchObject({ role: "host", nextSession: "Sun noon" });
  });
  it("an empty nextSession clears it", () => {
    const out = mergeRoom([room("a", { nextSession: "x" })], { code: "a", nextSession: "" });
    expect(out[0].nextSession).toBeUndefined();
  });
  it("ignores blank codes", () => {
    expect(mergeRoom([room("a")], { code: "  " })).toHaveLength(1);
  });
});

describe("withoutRoom", () => {
  it("removes by code", () => {
    expect(withoutRoom([room("a"), room("b")], "a").map((r) => r.code)).toEqual(["b"]);
  });
});

describe("room codes", () => {
  it("are six readable characters by default", () => {
    const c = newRoomCode();
    expect(c).toHaveLength(6);
    expect(c).toMatch(/^[A-Z2-9]+$/);
  });

  it("never use glyphs that get misread aloud — O/0, I/1, L", () => {
    for (let i = 0; i < 400; i++) expect(newRoomCode(12)).not.toMatch(/[O0I1L]/);
  });

  it("honour a requested length", () => {
    expect(newRoomCode(4)).toHaveLength(4);
    expect(newRoomCode(10)).toHaveLength(10);
  });

  it("are not all identical — there is real entropy", () => {
    const seen = new Set(Array.from({ length: 60 }, () => newRoomCode()));
    expect(seen.size).toBeGreaterThan(50);
  });
});
