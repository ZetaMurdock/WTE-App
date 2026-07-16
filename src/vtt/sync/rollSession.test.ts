// The store is a module-level singleton, so these cases run as one ordered
// sequence against a shared instance (mirrors app runtime).
import { describe, it, expect } from "vitest";
import { addSessionRoll, getSessionRolls, hydrateSessionRolls, subscribeSessionRolls, type SessionRoll } from "./rollSession";

const R = (id: string, who: string, result: number): SessionRoll => ({ id, who, label: "d20", formula: "1d20", result, at: Date.now() });

describe("rollSession store", () => {
  it("prepends live rolls newest-first", () => {
    addSessionRoll("c1", R("a", "You", 5));
    addSessionRoll("c1", R("b", "Kai", 12));
    expect(getSessionRolls("c1").map((r) => r.id)).toEqual(["b", "a"]);
  });

  it("dedupes by id (self-echo cannot double-count)", () => {
    addSessionRoll("c1", R("a", "You", 5));
    expect(getSessionRolls("c1")).toHaveLength(2);
  });

  it("hydrates DB history UNDER live rolls, de-duped, only once", () => {
    hydrateSessionRolls("c1", [R("a", "", 5), R("hist1", "", 9), R("hist2", "", 3)]);
    expect(getSessionRolls("c1").map((r) => r.id)).toEqual(["b", "a", "hist1", "hist2"]);
    hydrateSessionRolls("c1", [R("hist3", "", 1)]); // second hydrate is a no-op
    expect(getSessionRolls("c1").some((r) => r.id === "hist3")).toBe(false);
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

  it("caps the log at 100 entries", () => {
    for (let i = 0; i < 130; i++) addSessionRoll("cap", R("r" + i, "You", i));
    expect(getSessionRolls("cap")).toHaveLength(100);
    expect(getSessionRolls("cap")[0].id).toBe("r129"); // newest kept
  });
});
