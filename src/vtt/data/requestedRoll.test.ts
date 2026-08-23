import { afterEach, describe, expect, it } from "vitest";
import { parseRollFormulaPage, setCodexRollFormulas } from "../../game/rollFormula";
import { zeroAttributes, zeroSpecialties } from "../../game/wte";
import type { CharacterRecord } from "../../lib/characters";
import { requestedRollOptions } from "./requestedRoll";

function character(): CharacterRecord {
  const attributes = zeroAttributes();
  attributes.dex = 10;
  const specialties = zeroSpecialties();
  specialties.bal = 70;
  return {
    id: "target",
    campaignId: "table",
    name: "Target",
    createdAt: 0,
    updatedAt: 0,
    sheet: {
      attributes,
      specialties,
      background: { mode: "standard", assign: [], attrBonus: { dex: 2 }, specBonus: { bal: 3 } },
      equipment: [{ id: "suit", name: "Evasion Suit", weight: "light", equipped: true, mods: "DEX +2, Balance +4" }],
      derivedOverrides: { ev: -3 },
    },
  } as CharacterRecord;
}

afterEach(() => setCodexRollFormulas([]));

describe("targeted roll resolution", () => {
  it("offers both Roll Axis sources with effective scores and the signed derived modifier", () => {
    expect(requestedRollOptions(character(), { rollAxis: { path: "evasion", direction: "save" } })).toEqual([
      { label: "Dexterity", expr: "1d20-1", detail: "DEX +2 + EV -3 = -1" },
      { label: "Balance", expr: "1d40+29", detail: "Balance +32 + EV -3 = +29" },
    ]);
  });

  it("uses the active Codex path+direction formula for a requested source", () => {
    const parsed = parseRollFormulaPage(`# Requested Evasion Formula

| Field | Value |
|---|---|
| Type | Roll Formula |
| Target | Roll Axis Attribute |
| Path | Evasion |
| Direction | Save |
| Die | 12 |
| Modifier | source * 2 + derived |`, "requested-evasion");
    if (!parsed?.ok) throw new Error("test formula did not parse");
    setCodexRollFormulas([parsed.formula]);

    expect(requestedRollOptions(character(), { rollAxis: { path: "evasion", direction: "save" } })[0]).toEqual({
      label: "Dexterity",
      expr: "1d12+1",
      detail: "DEX +2 + EV -3 = +1",
    });
  });

  it("keeps legacy stat-only requests working", () => {
    expect(requestedRollOptions(character(), { stat: "Dexterity" })).toEqual([
      { label: "Dexterity", expr: "1d20+2" },
    ]);
    expect(requestedRollOptions(character(), { stat: "Evasion" })).toEqual([
      { label: "Evasion", expr: "1d20" },
    ]);
  });

  it("rejects unreachable path/direction pairs", () => {
    expect(requestedRollOptions(character(), { rollAxis: { path: "power", direction: "save" } })).toEqual([]);
  });
});
