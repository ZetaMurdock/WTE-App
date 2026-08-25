import { afterEach, describe, expect, it, vi } from "vitest";
import {
  parseRollFormulaPage,
  resolveCodexRollFormula,
  setCodexRollFormulas,
  PATH_DIRECTIONS,
  ROLL_FORMULA_PATHS,
} from "./rollFormula";
import { rollSpecialty } from "./wte";
import { ROLL_AXIS_PATHS, rollAxisChoices, rollAxisPaths, rollAxisRoll, type RollAxisStats } from "./rollAxis";
import { AXIS_PATH_RULES } from "./abilityActions";

function page(rows: string[], title = "House Formula"): string {
  return [`# ${title}`, "", "| Field | Value |", "|---|---|", "| Type | Roll Formula |", ...rows].join("\n");
}

function valid(md: string) {
  const parsed = parseRollFormulaPage(md, "house-formula");
  expect(parsed).toMatchObject({ ok: true });
  if (!parsed?.ok) throw new Error("test formula did not parse");
  return parsed.formula;
}

afterEach(() => {
  setCodexRollFormulas([]);
  vi.restoreAllMocks();
});

describe("safe Codex Roll Formula parsing", () => {
  it("accepts bounded arithmetic over the target's allowlisted variables", () => {
    const formula = valid(page([
      "| Target | Attribute |",
      "| Die | 20 |",
      "| Modifier | floor((score - 10) / 2) |",
    ]));
    setCodexRollFormulas([formula]);

    expect(resolveCodexRollFormula("attribute", { score: 5 })).toMatchObject({ die: 20, modifier: -3 });
  });

  it("rejects unknown variables and JavaScript-shaped code rather than evaluating it", () => {
    const unknown = parseRollFormulaPage(page([
      "| Target | Attribute |",
      "| Die | 20 |",
      "| Modifier | score + dexterity |",
    ]), "unknown");
    expect(unknown).toMatchObject({ ok: false });
    expect(unknown && !unknown.ok ? unknown.errors.join(" ") : "").toMatch(/Unknown variable "dexterity"/);

    const code = parseRollFormulaPage(page([
      "| Target | Attribute |",
      "| Die | 20 |",
      "| Modifier | globalThis.alert(score) |",
    ]), "code");
    expect(code).toMatchObject({ ok: false });
    expect(code && !code.ok ? code.errors.join(" ") : "").toMatch(/Unknown function|Unsupported token/);

    const prototypeName = parseRollFormulaPage(page([
      "| Target | Attribute |",
      "| Die | 20 |",
      "| Modifier | constructor(score) |",
    ]), "prototype-name");
    expect(prototypeName).toMatchObject({ ok: false });
    expect(prototypeName && !prototypeName.ok ? prototypeName.errors.join(" ") : "").toMatch(/Unknown function "constructor"/);
  });

  it("does not activate formula examples hidden in comments or fenced code", () => {
    const example = [
      "# Formula Documentation",
      "",
      "```md",
      "| Type | Roll Formula |",
      "| Target | Attribute |",
      "| Die | 20 |",
      "| Modifier | score |",
      "```",
      "",
      "<!--",
      "| Type | Roll Formula |",
      "| Target | Attribute |",
      "| Die | 20 |",
      "| Modifier | score |",
      "-->",
    ].join("\n");
    expect(parseRollFormulaPage(example, "documentation")).toBeNull();
  });

  it("rejects any division denominator that can be zero in the supported domain", () => {
    const constantZero = parseRollFormulaPage(page([
      "| Target | Attribute |",
      "| Die | 20 |",
      "| Modifier | score / 0 |",
    ]), "constant-zero");
    expect(constantZero).toMatchObject({ ok: false });
    expect(constantZero && !constantZero.ok ? constantZero.errors.join(" ") : "").toMatch(/denominator can be zero/i);

    const variableZero = parseRollFormulaPage(page([
      "| Target | Attribute |",
      "| Die | 20 |",
      "| Modifier | floor(score / score) |",
    ]), "variable-zero");
    expect(variableZero).toMatchObject({ ok: false });
    expect(variableZero && !variableZero.ok ? variableZero.errors.join(" ") : "").toMatch(/denominator can be zero/i);
  });

  it("rejects potentially fractional results and accepts explicit integer rounding", () => {
    const fractional = parseRollFormulaPage(page([
      "| Target | Attribute |",
      "| Die | 20 |",
      "| Modifier | score / 4 |",
    ]), "fractional");
    expect(fractional).toMatchObject({ ok: false });
    expect(fractional && !fractional.ok ? fractional.errors.join(" ") : "").toMatch(/whole number/i);

    const rounded = valid(page([
      "| Target | Attribute |",
      "| Die | 20 |",
      "| Modifier | floor(score / 4) |",
    ]));
    setCodexRollFormulas([rounded]);
    expect(resolveCodexRollFormula("attribute", { score: 5 })).toMatchObject({ modifier: 1 });

    const fractionalThreshold = parseRollFormulaPage(page([
      "| Target | Specialty |",
      "| Die | 40 |",
      "| Modifier | score |",
      "| Below | 24.5 |",
      "| Penalty | 2.5 |",
    ]), "fractional-threshold");
    expect(fractionalThreshold).toMatchObject({ ok: false });
  });

  it("rejects formulas whose proven output can exceed the bounded result domain", () => {
    const unbounded = parseRollFormulaPage(page([
      "| Target | Attribute |",
      "| Die | 20 |",
      "| Modifier | score * score |",
    ]), "unbounded");
    expect(unbounded).toMatchObject({ ok: false });
    expect(unbounded && !unbounded.ok ? unbounded.errors.join(" ") : "").toMatch(/supported result range/i);
  });

  it("throws an explicit formula error when runtime inputs leave the proven domain", () => {
    const formula = valid(page([
      "| Target | Attribute |",
      "| Die | 20 |",
      "| Modifier | score |",
    ]));
    setCodexRollFormulas([formula]);
    expect(() => resolveCodexRollFormula("attribute", { score: 1.5 })).toThrow(/Codex Roll Formula.+whole number/i);
    expect(() => resolveCodexRollFormula("attribute", { score: 1_000_001 })).toThrow(/Codex Roll Formula.+1000000/i);
  });

  it("lets stronger campaign scope beat official path specificity, then exact path win within that scope", () => {
    const officialExact = valid(page([
      "| ID | wte.formula.official-evasion |",
      "| Target | Roll Axis Attribute |",
      "| Path | Evasion |",
      "| Direction | Save |",
      "| Die | 20 |",
      "| Modifier | 1 |",
    ]));
    const campaignGeneral = valid(page([
      "| ID | campaign.table.formula.campaign-general |",
      "| Target | Roll Axis Attribute |",
      "| Die | 20 |",
      "| Modifier | 9 |",
    ]));
    const campaignExact = valid(page([
      "| ID | campaign.table.formula.campaign-evasion |",
      "| Target | Roll Axis Attribute |",
      "| Path | Evasion |",
      "| Direction | Save |",
      "| Die | 20 |",
      "| Modifier | 7 |",
    ]));

    setCodexRollFormulas([campaignGeneral, officialExact]);
    expect(resolveCodexRollFormula("roll-axis-attribute", { source: 0, derived: 0 }, "evasion", "save")?.modifier).toBe(9);
    setCodexRollFormulas([campaignGeneral, officialExact, campaignExact]);
    expect(resolveCodexRollFormula("roll-axis-attribute", { source: 0, derived: 0 }, "evasion", "save")?.modifier).toBe(7);
    expect(resolveCodexRollFormula("roll-axis-attribute", { source: 0, derived: 0 }, "evasion", "check")?.modifier).toBe(9);
  });

  it("rejects Roll Axis path and direction combinations that no roll can reach", () => {
    const powerSave = parseRollFormulaPage(page([
      "| Target | Roll Axis Attribute |",
      "| Path | Power |",
      "| Direction | Save |",
      "| Die | 20 |",
      "| Modifier | source + derived |",
    ]), "power-save");
    expect(powerSave).toMatchObject({ ok: false });
    expect(powerSave && !powerSave.ok ? powerSave.errors.join(" ") : "").toMatch(/power does not support save/i);

    const evasionCheck = parseRollFormulaPage(page([
      "| Target | Roll Axis Attribute |",
      "| Path | Evasion |",
      "| Direction | Check |",
      "| Die | 20 |",
      "| Modifier | source + derived |",
    ]), "evasion-check");
    expect(evasionCheck).toMatchObject({ ok: false });
    expect(evasionCheck && !evasionCheck.ok ? evasionCheck.errors.join(" ") : "").toMatch(/evasion does not support check/i);

    const densitySave = parseRollFormulaPage(page([
      "| Target | Roll Axis Attribute |",
      "| Path | Density |",
      "| Direction | Save |",
      "| Die | 20 |",
      "| Modifier | source + derived |",
    ]), "density-save");
    expect(densitySave).toMatchObject({ ok: false });
    expect(densitySave && !densitySave.ok ? densitySave.errors.join(" ") : "").toMatch(/density does not support save/i);
  });
});

describe("path/direction tables agree across modules", () => {
  it("keeps PATH_DIRECTIONS and AXIS_PATH_RULES mirroring ROLL_AXIS_PATHS for every path", () => {
    expect([...ROLL_FORMULA_PATHS].sort()).toEqual(ROLL_AXIS_PATHS.map((path) => path.id).sort());
    for (const path of ROLL_AXIS_PATHS) {
      expect(PATH_DIRECTIONS[path.id], `rollFormula directions for ${path.id}`).toEqual(path.directions);
      expect(AXIS_PATH_RULES[path.id], `abilityActions rules for ${path.id}`).toEqual({ axis: path.axis, directions: path.directions });
    }
  });
});

describe("Codex formula roll integration", () => {
  it("applies threshold penalties and preserves a negative specialty modifier deterministically", () => {
    const formula = valid(page([
      "| Target | Specialty |",
      "| Die | 40 |",
      "| Modifier | floor((score - 10) / 2) |",
      "| Below | 25 |",
      "| Penalty | 25 |",
    ], "Specialty Formula"));
    setCodexRollFormulas([formula]);
    vi.spyOn(Math, "random").mockReturnValue(0); // d40 = 1

    const roll = rollSpecialty("Balance", 0);
    expect(roll.detail).toMatchObject({ die: 40, roll: 1, modifier: -30 });
    expect(roll.result).toBe(-29);
    expect(roll.formula).toBe("1d40 - 30");
  });

  it("can override one Roll Axis path without hiding its negative derived value", () => {
    const formula = valid(page([
      "| Target | Roll Axis Attribute |",
      "| Path | Evasion |",
      "| Die | 12 |",
      "| Modifier | source + derived - 2 |",
    ], "Evasion Formula"));
    setCodexRollFormulas([formula]);

    const stats: RollAxisStats = {
      attr: { phy: 2, ap: 1, dex: 2, end: 0, wis: 1, int: 3, cha: -1 },
      spec: { wm: 4, pre: 3, bal: -2, adp: 1, mf: 0, per: 5, cun: -3 },
      derived: { atk: 3, ad: 2, ev: -3, rr: -1, nc: 4, pr: 1, inf: -2 },
    };
    const path = rollAxisPaths("physical", "save")[0];
    const choice = rollAxisChoices(path, "save", stats)[0];
    expect(choice).toMatchObject({ die: 12, sourceMod: 2, derivedMod: -3, totalMod: -3, expr: "1d12-3" });

    vi.spyOn(Math, "random").mockReturnValue(0.5); // d12 = 7
    const roll = rollAxisRoll(choice);
    expect(roll.result).toBe(4);
    expect(roll.formula).toContain("+ 2 DEX - 3 EV");
    expect(roll.formula).toContain("Codex Evasion Formula = - 3");
  });

  it("can give a dual-direction path different Check and Save formulas", () => {
    const check = valid(page([
      "| ID | campaign.table.formula.perception-check |",
      "| Target | Roll Axis Attribute |",
      "| Path | Perception |",
      "| Direction | Check |",
      "| Die | 20 |",
      "| Modifier | source + derived + 2 |",
    ], "Perception Check"));
    const save = valid(page([
      "| ID | campaign.table.formula.perception-save |",
      "| Target | Roll Axis Attribute |",
      "| Path | Perception |",
      "| Direction | Save |",
      "| Die | 20 |",
      "| Modifier | source + derived - 4 |",
    ], "Perception Save"));
    setCodexRollFormulas([check, save]);
    const stats: RollAxisStats = {
      attr: { phy: 0, ap: 0, dex: 0, end: 0, wis: 0, int: 3, cha: 0 },
      spec: { wm: 0, pre: 0, bal: 0, adp: 0, mf: 0, per: 0, cun: 0 },
      derived: { atk: 0, ad: 0, ev: 0, rr: 0, nc: 0, pr: 1, inf: 0 },
    };
    const checkPath = rollAxisPaths("mental", "check").find((path) => path.id === "perception")!;
    const savePath = rollAxisPaths("mental", "save").find((path) => path.id === "perception")!;
    expect(rollAxisChoices(checkPath, "check", stats)[0].totalMod).toBe(6);
    expect(rollAxisChoices(savePath, "save", stats)[0].totalMod).toBe(0);
  });

  it("accepts a Density check formula and fires it on the sheet's Density Physical Check", () => {
    const formula = valid(page([
      "| Target | Roll Axis Attribute |",
      "| Path | Density |",
      "| Direction | Check |",
      "| Die | 20 |",
      "| Modifier | source + derived + 1 |",
    ], "Density Formula"));
    setCodexRollFormulas([formula]);
    const stats: RollAxisStats = {
      attr: { phy: 2, ap: 1, dex: 2, end: 0, wis: 1, int: 3, cha: -1 },
      spec: { wm: 4, pre: 3, bal: -2, adp: 1, mf: 0, per: 5, cun: -3 },
      derived: { atk: 3, ad: 2, ev: -3, rr: -1, nc: 4, pr: 1, inf: -2 },
    };
    const path = rollAxisPaths("physical", "check").find((p) => p.id === "density")!;
    expect(rollAxisChoices(path, "check", stats)[0]).toMatchObject({
      totalMod: 4, // AP 1 + AD 2 + 1
      codexFormula: { name: "Density Formula" },
    });
  });

  it("keeps the published Roll Axis audit formula inside the network wire bound", () => {
    const expression = `source + derived${" + 0".repeat(25)}`;
    const formula = valid(page([
      "| Target | Roll Axis Attribute |",
      "| Path | Evasion |",
      "| Direction | Save |",
      "| Die | 1000 |",
      `| Modifier | ${expression} |`,
    ], "A".repeat(300)));
    setCodexRollFormulas([formula]);
    const stats: RollAxisStats = {
      attr: { phy: 0, ap: 0, dex: -1000, end: 0, wis: 0, int: 0, cha: 0 },
      spec: { wm: 0, pre: 0, bal: 0, adp: 0, mf: 0, per: 0, cun: 0 },
      derived: { atk: 0, ad: 0, ev: -1000, rr: 0, nc: 0, pr: 0, inf: 0 },
    };
    const path = rollAxisPaths("physical", "save")[0];
    vi.spyOn(Math, "random").mockReturnValue(0.999);
    const roll = rollAxisRoll(rollAxisChoices(path, "save", stats)[0], "double-dis");
    expect(roll.formula.length).toBeLessThanOrEqual(240);
    expect(roll.formula).not.toContain(expression);
  });
});
