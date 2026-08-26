import { describe, expect, it } from "vitest";
import { newScene } from "../types/scene";
import { MAX_CONDITION_CLOCKS } from "../engine/systems/ConditionClockSystem";
import { MAX_VTT_SNAPSHOT_CHARS, vttSnapshotChars, vttSnapshotFits } from "./wireBudget";

describe("VTT snapshot wire budget", () => {
  it("accepts ordinary scenes and rejects media beyond the transport ceiling", () => {
    const scene = newScene("campaign-1", "Map");
    expect(vttSnapshotFits(scene)).toBe(true);
    scene.data.background.src = "data:image/png;base64," + "A".repeat(MAX_VTT_SNAPSHOT_CHARS);
    expect(vttSnapshotChars(scene)).toBeGreaterThan(MAX_VTT_SNAPSHOT_CHARS);
    expect(vttSnapshotFits(scene)).toBe(false);
  });

  it("still fits with the condition-clock field at its ceiling", () => {
    // The clocks ride the snapshot, so their cap is only safe if a scene carrying
    // the maximum of them is still transportable at all.
    const scene = newScene("campaign-1", "Map");
    scene.data.conditionClocks = Array.from({ length: MAX_CONDITION_CLOCKS }, (_, i) => ({
      tokenId: `token-${i}`,
      status: "x".repeat(80),
      bornRound: 999,
      rounds: 9_999,
      potency: 999,
    }));
    expect(vttSnapshotFits(scene)).toBe(true);
  });
});
