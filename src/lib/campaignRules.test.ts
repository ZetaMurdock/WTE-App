import { beforeEach, describe, expect, it } from "vitest";
import {
  ATTR_BUDGET_DEFAULT,
  ATTR_BUDGET_MAX,
  ATTR_BUDGET_MIN,
  attrBudgetState,
  loadRules,
  parseRules,
  saveRules,
} from "./campaignRules";

// The suite runs in node; these are storage-backed, so stub the one API they use.
const store = new Map<string, string>();
(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
};

describe("campaign rules", () => {
  beforeEach(() => store.clear());

  it("is off by default — the app never imposes a budget on its own", () => {
    expect(loadRules("c1").attrBudget).toBe(false);
    expect(loadRules("c1").attrBudgetPoints).toBe(ATTR_BUDGET_DEFAULT);
  });

  it("round-trips per campaign without leaking between tables", () => {
    saveRules("c1", { attrBudget: true, attrBudgetPoints: 65 });
    expect(loadRules("c1")).toEqual({ attrBudget: true, attrBudgetPoints: 65 });
    expect(loadRules("c2").attrBudget).toBe(false);
  });

  it("clamps a hand-edited or out-of-range budget instead of breaking", () => {
    expect(parseRules({ attrBudget: true, attrBudgetPoints: 9999 }).attrBudgetPoints).toBe(ATTR_BUDGET_MAX);
    expect(parseRules({ attrBudget: true, attrBudgetPoints: -4 }).attrBudgetPoints).toBe(ATTR_BUDGET_MIN);
    expect(parseRules({ attrBudgetPoints: "nonsense" }).attrBudgetPoints).toBe(ATTR_BUDGET_DEFAULT);
    expect(parseRules(null).attrBudget).toBe(false);
  });

  it("survives a corrupt blob", () => {
    localStorage.setItem("wte-campaign-rules:c1", "{not json");
    expect(loadRules("c1").attrBudget).toBe(false);
  });

  it("reports the budget state the creator shows", () => {
    const on = { attrBudget: true, attrBudgetPoints: 70 };
    expect(attrBudgetState(64, on)).toMatchObject({ enforced: true, remaining: 6, over: false });
    expect(attrBudgetState(71, on)).toMatchObject({ remaining: -1, over: true });
    // 140 attribute points is only "over" when the Curator turned the rule on.
    expect(attrBudgetState(140, { attrBudget: false, attrBudgetPoints: 70 }).over).toBe(false);
  });
});
