import { describe, expect, it } from "vitest";
import { toShrives } from "./money";
import {
  INV_NAME_MAX,
  addItem,
  inventoryValue,
  itemCount,
  moveItem,
  parseInventory,
  patchItem,
  removeItem,
  setQty,
  stepQty,
  summarizeInventory,
  type InvItem,
} from "./tableInventory";

describe("adding", () => {
  it("stacks by name instead of making duplicate rows", () => {
    let l = addItem([], "Ration pack", 2);
    l = addItem(l, "ration PACK", 3);
    expect(l).toHaveLength(1);
    expect(l[0].qty).toBe(5);
  });

  it("keeps distinct items apart", () => {
    let l = addItem([], "Ration pack");
    l = addItem(l, "Access key");
    expect(l.map((x) => x.name)).toEqual(["Ration pack", "Access key"]);
  });

  it("refuses a blank name and trims a long one", () => {
    expect(addItem([], "   ")).toEqual([]);
    expect(addItem([], "x".repeat(200))[0].name).toHaveLength(INV_NAME_MAX);
  });

  it("defaults to one and never adds zero or negative", () => {
    expect(addItem([], "Thing")[0].qty).toBe(1);
    expect(addItem([], "Thing", 0)[0].qty).toBe(1);
    expect(addItem([], "Thing", -5)[0].qty).toBe(1);
  });

  it("carries a note and a value", () => {
    const l = addItem([], "Ingot", 2, { note: "stamped", value: toShrives({ credits: 3 }) });
    expect(l[0]).toMatchObject({ note: "stamped", value: 30_000 });
  });
});

describe("quantities", () => {
  it("removes the row at zero rather than leaving clutter", () => {
    const l = addItem([], "Ration pack", 2);
    expect(setQty(l, l[0].id, 0)).toEqual([]);
    expect(stepQty(l, l[0].id, -2)).toEqual([]);
  });

  it("steps up and down", () => {
    const l = addItem([], "Bolt", 5);
    expect(stepQty(l, l[0].id, 3)[0].qty).toBe(8);
    expect(stepQty(l, l[0].id, -4)[0].qty).toBe(1);
  });

  it("never goes negative", () => {
    const l = addItem([], "Bolt", 1);
    expect(stepQty(l, l[0].id, -99)).toEqual([]);
  });

  it("ignores an unknown id", () => {
    const l = addItem([], "Bolt");
    expect(stepQty(l, "nope", 1)).toEqual(l);
    expect(removeItem(l, "nope")).toEqual(l);
  });
});

describe("editing", () => {
  it("renames, notes and values — and clears a note or value when emptied", () => {
    let l = addItem([], "Thing", 1, { note: "old", value: 500 });
    const id = l[0].id;
    l = patchItem(l, id, { name: "Better thing", note: "", value: 0 });
    expect(l[0].name).toBe("Better thing");
    expect(l[0].note).toBeUndefined();
    expect(l[0].value).toBeUndefined();
  });

  it("refuses to blank a name", () => {
    const l = addItem([], "Thing");
    expect(patchItem(l, l[0].id, { name: "  " })[0].name).toBe("Thing");
  });
});

describe("moving between personal and Unit", () => {
  it("hands an item across, stacking on arrival", () => {
    const mine = addItem([], "Ration pack", 5);
    const unit = addItem([], "Ration pack", 1);
    const moved = moveItem(mine, unit, mine[0].id, 2)!;
    expect(moved.from[0].qty).toBe(3);
    expect(moved.to).toHaveLength(1);
    expect(moved.to[0].qty).toBe(3);
  });

  it("conserves the total across both lists — nothing is duplicated", () => {
    const mine = addItem([], "Bolt", 4);
    const unit: InvItem[] = [];
    const before = itemCount(mine) + itemCount(unit);
    const moved = moveItem(mine, unit, mine[0].id, 3)!;
    expect(itemCount(moved.from) + itemCount(moved.to)).toBe(before);
  });

  it("empties the source row when the last one leaves", () => {
    const mine = addItem([], "Key", 1);
    const moved = moveItem(mine, [], mine[0].id, 1)!;
    expect(moved.from).toEqual([]);
    expect(moved.to[0].qty).toBe(1);
  });

  it("refuses rather than moving less than asked", () => {
    const mine = addItem([], "Bolt", 2);
    expect(moveItem(mine, [], mine[0].id, 5)).toBeNull();
    expect(moveItem(mine, [], "nope", 1)).toBeNull();
  });

  it("carries the note and value with the item", () => {
    const mine = addItem([], "Ingot", 2, { note: "stamped", value: 500 });
    const moved = moveItem(mine, [], mine[0].id, 1)!;
    expect(moved.to[0]).toMatchObject({ note: "stamped", value: 500 });
  });
});

describe("totals", () => {
  it("values a list by quantity", () => {
    let l = addItem([], "Ingot", 3, { value: toShrives({ credits: 1 }) });
    l = addItem(l, "Rag", 10); // worthless
    expect(inventoryValue(l)).toBe(30_000);
    expect(itemCount(l)).toBe(13);
  });

  it("summarises, mentioning worth only when there is some", () => {
    expect(summarizeInventory([])).toBe("0 items");
    expect(summarizeInventory(addItem([], "Key"))).toBe("1 item");
    expect(summarizeInventory(addItem([], "Ingot", 2, { value: 10_000 }))).toBe("2 items · 2 Cr");
  });
});

describe("parsing a stored or wire blob", () => {
  it("drops junk and coerces the rest", () => {
    const l = parseInventory([
      { name: "Good", qty: "3" },
      { name: "", qty: 1 },
      { qty: 5 },
      "nope",
      null,
      { name: "Neg", qty: -4 },
    ]);
    expect(l.map((x) => x.name)).toEqual(["Good", "Neg"]);
    expect(l[0].qty).toBe(3);
    expect(l[1].qty).toBe(0);
    expect(l[0].id).toBeTruthy();
  });

  it("survives a non-array", () => {
    expect(parseInventory(null)).toEqual([]);
    expect(parseInventory("nope")).toEqual([]);
  });
});
