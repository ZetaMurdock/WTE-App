import { describe, expect, it } from "vitest";
import { mergeQuick, withoutQuick, type QuickCreature } from "./quickCreatures";

const qc = (id: string, name = "Ghoul", hp = 20): QuickCreature => ({ id, name, hp });

describe("quick creatures (Curator's on-the-spot stat blocks)", () => {
  it("new entries go on top; edits replace in place", () => {
    let list = mergeQuick([], qc("a"));
    list = mergeQuick(list, qc("b", "Wraith", 35));
    expect(list.map((c) => c.id)).toEqual(["b", "a"]);
    list = mergeQuick(list, { ...qc("a", "Ghoul Elder", 40) });
    expect(list.map((c) => c.id)).toEqual(["b", "a"]); // stayed in place
    expect(list[1]).toMatchObject({ name: "Ghoul Elder", hp: 40 });
  });

  it("sanitizes the block: hp floors at 1, size clamps 1-6, blank names are refused", () => {
    const [c] = mergeQuick([], { id: "x", name: "  Slime  ", hp: 0, dr: -3, size: 99 });
    expect(c).toMatchObject({ name: "Slime", hp: 1, dr: undefined, size: 6 });
    expect(mergeQuick([], { id: "y", name: "   ", hp: 5 })).toEqual([]);
  });

  it("removes by id", () => {
    const list = mergeQuick(mergeQuick([], qc("a")), qc("b"));
    expect(withoutQuick(list, "a").map((c) => c.id)).toEqual(["b"]);
  });
});
