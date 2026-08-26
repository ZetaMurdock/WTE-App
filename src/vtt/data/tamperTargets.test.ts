import { describe, it, expect } from "vitest";
import { findTamperTarget, listTamperTargets } from "./tamperTargets";
import { defaultSceneData, type VttEffect, type VttSceneData, type VttToken } from "../types/scene";

const tok = (id: string, name: string, statuses?: string[]): VttToken => ({
  id,
  name,
  x: 0,
  y: 0,
  size: 1,
  color: "#fff",
  visible: true,
  ...(statuses ? { statuses } : {}),
});

const field = (id: string, name: string, extra: Partial<VttEffect["data"]> = {}): VttEffect => ({
  id,
  kind: "circle",
  x: 0,
  y: 0,
  data: { radius: 3, sourceAbilityId: `ab-${id}`, sourceAbilityName: name, ...extra },
});

function scene(round = 4): VttSceneData {
  const data = defaultSceneData();
  data.timeline = { round, turn: 0 };
  return data;
}

describe("listTamperTargets", () => {
  it("names an ability's field the way the Curator names it, never by id", () => {
    const data = scene(4);
    data.tokens = [tok("k", "Kira")];
    data.effects = [field("fx1", "Absolute Zero", { rounds: 4, bornRound: 2, auraTokenId: "k", status: "Frozen" })];

    const [target] = listTamperTargets(data);
    expect(target.label).toBe("Absolute Zero — riding Kira, 2 rounds left");
    expect(target.detail).toBe("grants Frozen");
    expect(target.label).not.toContain("fx1");
  });

  it("leaves a hand-drawn template alone — no ability, no identity, nothing to tamper with", () => {
    const data = scene();
    // The Curator's own rectangle. Offering to "negate" it would claim the
    // engine knows something about it that it does not.
    data.effects = [{ id: "fx1", kind: "zone", x: 0, y: 0, data: { w: 3, h: 3 } }];
    expect(listTamperTargets(data)).toEqual([]);
  });

  it("says when a field has no expiry rather than inventing one", () => {
    const data = scene();
    data.effects = [field("fx1", "Null Zone")];
    expect(listTamperTargets(data)[0].label).toBe("Null Zone — on the map, no expiry");
  });

  it("lists one row per live occurrence of a stacking condition", () => {
    const data = scene(4);
    data.tokens = [tok("k", "Kira", ["Blight", "Blight"])];
    data.conditionClocks = [
      { tokenId: "k", status: "Blight", bornRound: 2, rounds: 4 },
      { tokenId: "k", status: "Blight", bornRound: 3, rounds: 4 },
    ];
    const rows = listTamperTargets(data);
    expect(rows).toHaveLength(2);
    expect(rows[0].label).toBe("Blight on Kira — 2 rounds left");
    expect(rows[1].label).toBe("Blight on Kira — 3 rounds left");
    expect(rows[0].id).not.toBe(rows[1].id);
  });

  it("does not offer a countdown whose pip a Curator already cleared", () => {
    // The pip is what a table reads, so clearing it is how a human ends a
    // condition. A row for it would put a thing on the list that is not on the map.
    const data = scene(4);
    data.tokens = [tok("k", "Kira")];
    data.conditionClocks = [{ tokenId: "k", status: "Slowed", bornRound: 2, rounds: 4 }];
    expect(listTamperTargets(data)).toEqual([]);
  });

  it("reads a counter track back as the pip reads it", () => {
    const data = scene();
    data.tokens = [tok("v", "Vex", ["Blight 3/8"])];
    data.counterTracks = [{ tokenId: "v", name: "Blight", value: 3, cap: 8 }];
    expect(listTamperTargets(data)[0].label).toBe("Blight 3/8 on Vex");
  });

  it("records no caster for a clock or a track, because neither has one", () => {
    // This absence is load-bearing: it is exactly why `reflect` refuses against
    // either instead of guessing a victim.
    const data = scene(4);
    data.tokens = [tok("k", "Kira", ["Slowed", "Blight 1"])];
    data.conditionClocks = [{ tokenId: "k", status: "Slowed", bornRound: 2, rounds: 4 }];
    data.counterTracks = [{ tokenId: "k", name: "Blight", value: 1 }];
    for (const row of listTamperTargets(data)) expect(row.casterCharacterId).toBeUndefined();
  });
});

describe("findTamperTarget", () => {
  it("re-reads the live scene, so an expired field is simply not there", () => {
    const data = scene(4);
    data.effects = [field("fx1", "Absolute Zero", { rounds: 4, bornRound: 2 })];
    const id = listTamperTargets(data)[0].id;
    expect(findTamperTarget(data, id)).not.toBeNull();
    data.effects = [];
    expect(findTamperTarget(data, id)).toBeNull();
  });
});
