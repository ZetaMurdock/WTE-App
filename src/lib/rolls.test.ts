import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  execute: vi.fn(),
  select: vi.fn(),
}));

vi.mock("./db", () => ({
  sqlAvailable: () => true,
  getDb: async () => db,
}));

import { canonicalRollExpr, logRoll, recentRolls, validateCompletedRoll } from "./rolls";

describe("durable rolls", () => {
  beforeEach(() => {
    db.execute.mockReset();
    db.select.mockReset();
  });

  it("canonicalizes base expressions for request correlation", () => {
    expect(canonicalRollExpr(" d20 + 03 ")).toBe("1d20+3");
    expect(canonicalRollExpr("2D8 - 1")).toBe("2d8-1");
    expect(canonicalRollExpr("not dice")).toBeNull();
  });

  it("accepts a self-consistent completed roll and canonicalizes its display", () => {
    expect(validateCompletedRoll({
      id: "roll-1",
      label: "Adaptation save",
      formula: "peer supplied display is ignored",
      baseExpr: "1d40-3",
      result: 22,
      mode: "adv",
      detail: {
        die: 40,
        roll: 25,
        modifier: -3,
        label: "Adaptation save",
        mode: "adv",
        rolls: [11, 25],
      },
    })).toMatchObject({
      id: "roll-1",
      baseExpr: "1d40-3",
      formula: "1d40-3 · Advantage (11/25)",
      result: 22,
    });
  });

  it("rejects forged or internally inconsistent completed rolls", () => {
    const valid = {
      id: "roll-1",
      label: "Control",
      formula: "1d40+2",
      baseExpr: "1d40+2",
      result: 20,
      mode: "normal",
      detail: { die: 40, roll: 18, modifier: 2, label: "Control", mode: "normal", rolls: [18] },
    };
    expect(validateCompletedRoll(valid)).not.toBeNull();
    expect(validateCompletedRoll({ ...valid, result: 99 })).toBeNull();
    expect(validateCompletedRoll({ ...valid, baseExpr: "d40+2" })).toBeNull();
    expect(validateCompletedRoll({ ...valid, detail: { ...valid.detail, rolls: [18, 40] } })).toBeNull();
    expect(validateCompletedRoll({ ...valid, detail: { ...valid.detail, die: 100 } })).toBeNull();
  });

  it("reuses one stable id and stores additive actor/request metadata", async () => {
    await logRoll(
      "campaign-1",
      "character-1",
      {
        formula: "1d20+4",
        result: 17,
        detail: { die: 20, roll: 13, modifier: 4, label: "Endurance save", mode: "normal", rolls: [13] },
      },
      {
        id: "roll-stable",
        at: 1234,
        baseExpr: "1d20+4",
        actorName: "Ari",
        tokenId: "token-1",
        requestId: "request-1",
      }
    );

    expect(db.execute).toHaveBeenCalledOnce();
    const [sql, values] = db.execute.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("INSERT OR IGNORE");
    expect(values.slice(0, 5)).toEqual(["roll-stable", "campaign-1", "character-1", "1d20+4", 17]);
    expect(values[6]).toBe(1234);
    expect(JSON.parse(String(values[5]))).toMatchObject({
      label: "Endurance save",
      _wte: {
        version: 1,
        baseExpr: "1d20+4",
        actorName: "Ari",
        tokenId: "token-1",
        requestId: "request-1",
        mode: "normal",
      },
    });
  });

  it("reads both enriched and legacy history without losing the roll detail", async () => {
    db.select.mockResolvedValue([
      {
        id: "new",
        campaign_id: "campaign-1",
        character_id: "character-1",
        formula: "1d20+4",
        result: 17,
        detail: JSON.stringify({
          label: "Endurance save",
          roll: 13,
          _wte: { version: 1, baseExpr: "1d20+4", actorName: "Ari", requestId: "request-1", mode: "normal" },
        }),
        at: 20,
      },
      {
        id: "legacy",
        campaign_id: "campaign-1",
        character_id: null,
        formula: "1d6",
        result: 4,
        detail: JSON.stringify({ label: "Damage", roll: 4 }),
        at: 10,
      },
    ]);

    const rows = await recentRolls("campaign-1", 30);
    expect(rows[0]).toMatchObject({
      id: "new",
      characterId: "character-1",
      label: "Endurance save",
      baseExpr: "1d20+4",
      actorName: "Ari",
      requestId: "request-1",
      mode: "normal",
    });
    expect(rows[0].detail).toMatchObject({ roll: 13 });
    expect(rows[1]).toMatchObject({ id: "legacy", label: "Damage" });
  });
});
