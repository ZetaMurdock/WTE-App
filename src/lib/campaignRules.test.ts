import { beforeEach, describe, expect, it } from "vitest";
import {
  ATTR_KEYS,
  SPEC_KEYS,
  SPEC_TOTAL,
  specialtyRemaining,
  validateSheet,
  type Attributes,
  type Specialties,
} from "../game/wte";
import {
  ATTR_BUDGET_DEFAULT,
  ATTR_BUDGET_MAX,
  ATTR_BUDGET_MIN,
  SPEC_TOTAL_MAX,
  SPEC_TOTAL_MIN,
  attrBudgetState,
  loadRules,
  parseRules,
  saveRules,
  sheetCaps,
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
    saveRules("c1", { attrBudget: true, attrBudgetPoints: 65, specTotal: 160 });
    expect(loadRules("c1")).toEqual({ attrBudget: true, attrBudgetPoints: 65, specTotal: 160 });
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

  it("defaults the specialty cap to the published rules and clamps silly values", () => {
    expect(loadRules("c1").specTotal).toBe(SPEC_TOTAL);
    expect(parseRules({ specTotal: 99999 }).specTotal).toBe(SPEC_TOTAL_MAX);
    expect(parseRules({ specTotal: 0 }).specTotal).toBe(SPEC_TOTAL_MIN);
    expect(parseRules({ specTotal: "lots" } as never).specTotal).toBe(SPEC_TOTAL);
  });

  it("hands validateSheet the live caps, so a lowered cap flags existing sheets", () => {
    const attrs = Object.fromEntries(ATTR_KEYS.map((k) => [k, 10])) as Attributes;
    const specs = { ...(Object.fromEntries(SPEC_KEYS.map((k) => [k, 0])) as Specialties), wt: 75, bal: 75, cun: 40 }; // 190
    expect(validateSheet(attrs, specs, sheetCaps(loadRules("c1"))).ok).toBe(true);
    saveRules("c1", { ...loadRules("c1"), specTotal: 150 });
    const v = validateSheet(attrs, specs, sheetCaps(loadRules("c1")));
    expect(v.ok).toBe(false);
    expect(v.errors.join(" ")).toContain("190/150");
    expect(specialtyRemaining(specs, loadRules("c1").specTotal)).toBe(-40);
  });

  it("only passes an attribute cap through when the Curator switched it on", () => {
    expect(sheetCaps(loadRules("c1")).attrTotal).toBeUndefined();
    saveRules("c1", { ...loadRules("c1"), attrBudget: true, attrBudgetPoints: 70 });
    expect(sheetCaps(loadRules("c1")).attrTotal).toBe(70);
    const walls = Object.fromEntries(ATTR_KEYS.map((k) => [k, 20])) as Attributes;
    const zeroS = Object.fromEntries(SPEC_KEYS.map((k) => [k, 0])) as Specialties;
    expect(validateSheet(walls, zeroS, sheetCaps(loadRules("c1"))).errors.join(" ")).toContain("140/70");
  });

  it("reports the budget state the creator shows", () => {
    const on = { attrBudget: true, attrBudgetPoints: 70, specTotal: SPEC_TOTAL };
    expect(attrBudgetState(64, on)).toMatchObject({ enforced: true, remaining: 6, over: false });
    expect(attrBudgetState(71, on)).toMatchObject({ remaining: -1, over: true });
    // 140 attribute points is only "over" when the Curator turned the rule on.
    expect(attrBudgetState(140, { attrBudget: false, attrBudgetPoints: 70, specTotal: SPEC_TOTAL }).over).toBe(false);
  });
});
