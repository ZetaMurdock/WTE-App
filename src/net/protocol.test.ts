import { describe, expect, it } from "vitest";
import { asRollResultMessage, RELAYED, type NetMessage, type RollRequestMessage, type RollResultMessage } from "./protocol";

describe("roll protocol", () => {
  it("keeps targeted requests/results out of room rebroadcasts", () => {
    expect(RELAYED.has("roll-request")).toBe(false);
    expect(RELAYED.has("roll-result")).toBe(false);
    expect(RELAYED.has("roll")).toBe(false);
  });

  it("carries target identity on requests and stable correlation on results", () => {
    const request: RollRequestMessage = {
      t: "roll-request",
      requestId: "request-1",
      label: "Endurance save · DC 18",
      rollAxis: { path: "evasion", direction: "save" },
      dc: 18,
      targetPeerId: "peer-1",
      targetCharacterId: "character-1",
      targetTokenId: "token-1",
      sourceAbilityId: "ability-1",
      sourceAbilityName: "Light Eater",
      createdAt: 100,
    };
    const result: RollResultMessage = {
      t: "roll-result",
      id: "roll-1",
      requestId: request.requestId,
      label: request.label,
      formula: "1d20+3",
      baseExpr: "1d20+3",
      result: 14,
      mode: "normal",
      actor: { peerId: request.targetPeerId, characterId: request.targetCharacterId, tokenId: request.targetTokenId },
    };

    expect(result.requestId).toBe(request.requestId);
    expect(request.rollAxis).toEqual({ path: "evasion", direction: "save" });
    expect(result.actor).toMatchObject({ characterId: "character-1", tokenId: "token-1" });
    expect(
      asRollResultMessage({
        ...result,
        t: "roll",
      })
    ).toEqual(result);
  });

  it("will not construct a requested result without a bound character", () => {
    expect(
      asRollResultMessage({
        t: "roll",
        id: "roll-1",
        requestId: "request-1",
        label: "Save",
        formula: "1d20",
        baseExpr: "1d20",
        result: 12,
        actor: { peerId: "peer-1" },
      })
    ).toBeNull();
  });

  it("preserves the legacy completed-roll shape", () => {
    const legacy = { t: "roll", label: "Damage", formula: "2d6", result: 7 } satisfies NetMessage;
    expect(legacy).toEqual({ t: "roll", label: "Damage", formula: "2d6", result: 7 });
  });
});
