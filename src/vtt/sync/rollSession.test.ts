import { beforeEach, describe, it, expect } from "vitest";
import {
  addSessionRoll,
  clearSessionRolls,
  getSessionRolls,
  hydrateSessionRolls,
  rollSessionScope,
  subscribeSessionRolls,
  type SessionRoll,
} from "./rollSession";

const R = (id: string, who: string, result: number, at = Date.now()): SessionRoll => ({
  id,
  who,
  label: "d20",
  formula: "1d20",
  result,
  at,
});

describe("rollSession store", () => {
  beforeEach(() => clearSessionRolls());

  it("prepends live rolls newest-first", () => {
    addSessionRoll("c1", R("a", "You", 5, 10));
    addSessionRoll("c1", R("b", "Kai", 12, 20));
    expect(getSessionRolls("c1").map((r) => r.id)).toEqual(["b", "a"]);
  });

  it("dedupes by id, keeps first-seen dice, and fills legacy metadata", () => {
    addSessionRoll("c1", R("a", "You", 5));
    addSessionRoll("c1", { ...R("a", "Kai", 99), baseExpr: "1d20", characterId: "char-1" });
    expect(getSessionRolls("c1")).toHaveLength(1);
    expect(getSessionRolls("c1")[0]).toMatchObject({ result: 5, who: "You", baseExpr: "1d20", characterId: "char-1" });
  });

  it("merges repeated DB reloads without clobbering live rolls", () => {
    addSessionRoll("c1", R("live", "You", 17, 40));
    hydrateSessionRolls("c1", [R("live", "History", 99, 40), R("hist1", "History", 9, 20)]);
    hydrateSessionRolls("c1", [R("hist1", "History", 9, 20), R("hist2", "History", 3, 10)]);
    expect(getSessionRolls("c1").map((r) => r.id)).toEqual(["live", "hist1", "hist2"]);
    expect(getSessionRolls("c1")[0].result).toBe(17);
  });

  it("returns a stable empty reference for unknown campaigns", () => {
    expect(getSessionRolls("none")).toBe(getSessionRolls("none"));
    expect(getSessionRolls("none")).toHaveLength(0);
  });

  it("notifies subscribers on mutation and stops after unsubscribe", () => {
    let n = 0;
    const off = subscribeSessionRolls(() => n++);
    addSessionRoll("c1", R("c", "You", 20));
    expect(n).toBe(1);
    off();
    addSessionRoll("c1", R("d", "You", 1));
    expect(n).toBe(1);
  });

  it("qualifies connected table scopes while preserving offline keys", () => {
    expect(rollSessionScope("campaign", null)).toBe("campaign");
    expect(rollSessionScope("campaign", "room 7")).toBe("campaign::table:room%207");
    expect(rollSessionScope("campaign", "room 7")).not.toBe(rollSessionScope("campaign", "room 8"));
  });

  it("caps the log at 100 entries", () => {
    for (let i = 0; i < 130; i++) addSessionRoll("cap", R("r" + i, "You", i));
    expect(getSessionRolls("cap")).toHaveLength(100);
    expect(getSessionRolls("cap")[0].id).toBe("r129"); // newest kept
  });
});
