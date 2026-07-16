import { describe, it, expect } from "vitest";
import { applyOp } from "./patches";
import { defaultSceneData, type VttSceneData, type VttToken } from "../types/scene";

const tok = (id: string, x = 0, y = 0): VttToken => ({ id, name: id, x, y, size: 1, color: "#fff", hp: 10, visible: true });

function fresh(): VttSceneData {
  return defaultSceneData();
}

describe("applyOp", () => {
  it("adds a token once (duplicate add is a no-op)", () => {
    const d = fresh();
    expect(applyOp(d, { op: "token.add", token: tok("t1") })).toBe(true);
    expect(applyOp(d, { op: "token.add", token: tok("t1") })).toBe(false);
    expect(d.tokens).toHaveLength(1);
  });

  it("moves / updates / removes tokens, reporting change truthfully", () => {
    const d = fresh();
    applyOp(d, { op: "token.add", token: tok("t1") });
    expect(applyOp(d, { op: "token.move", id: "t1", x: 140, y: 70 })).toBe(true);
    expect(d.tokens[0]).toMatchObject({ x: 140, y: 70 });
    expect(applyOp(d, { op: "token.update", id: "t1", patch: { hp: 3 } })).toBe(true);
    expect(d.tokens[0].hp).toBe(3);
    expect(applyOp(d, { op: "token.move", id: "ghost", x: 0, y: 0 })).toBe(false);
    expect(applyOp(d, { op: "token.remove", id: "t1" })).toBe(true);
    expect(applyOp(d, { op: "token.remove", id: "t1" })).toBe(false);
  });

  it("handles fog enable + reveal accumulation without duplicates", () => {
    const d = fresh();
    expect(applyOp(d, { op: "fog.set", enabled: true })).toBe(true);
    expect(applyOp(d, { op: "fog.set", enabled: true })).toBe(false);
    expect(applyOp(d, { op: "fog.reveal", cells: ["1,1", "2,2"] })).toBe(true);
    expect(applyOp(d, { op: "fog.reveal", cells: ["2,2"] })).toBe(false); // already revealed
    expect(d.fog.revealed.sort()).toEqual(["1,1", "2,2"]);
    expect(applyOp(d, { op: "fog.reset" })).toBe(true); // wipe exploration
    expect(d.fog.revealed).toEqual([]);
    expect(applyOp(d, { op: "fog.reset" })).toBe(false); // already clear
  });

  it("applies fog level config and clears decay memory on reset", () => {
    const d = fresh();
    expect(applyOp(d, { op: "fog.config", patch: { mode: "realistic", decaySeconds: 45 } })).toBe(true);
    expect(d.fog).toMatchObject({ mode: "realistic", decaySeconds: 45 });
    d.fog.seen = { "1,1": 123 };
    d.fog.revealed = ["1,1"];
    applyOp(d, { op: "fog.reset" });
    expect(d.fog.seen).toBeUndefined();
    expect(d.fog.revealed).toEqual([]);
  });

  it("sets background via patch and legacy src-only forms", () => {
    const d = fresh();
    applyOp(d, { op: "bg.set", patch: { src: "img.png", scale: 2 } });
    expect(d.background).toMatchObject({ src: "img.png", scale: 2 });
    applyOp(d, { op: "bg.set", src: null });
    expect(d.background.src).toBeUndefined();
  });

  it("adds / updates / removes effects (update patches the data bag)", () => {
    const d = fresh();
    applyOp(d, { op: "effect.add", effect: { id: "fx1", kind: "circle", x: 0, y: 0, data: { radius: 3 } } });
    expect(applyOp(d, { op: "effect.update", id: "fx1", patch: { radius: 6, rounds: 2 } })).toBe(true);
    expect(d.effects[0].data).toMatchObject({ radius: 6, rounds: 2 });
    expect(applyOp(d, { op: "effect.remove", id: "fx1" })).toBe(true);
    expect(d.effects).toHaveLength(0);
  });

  it("paints and erases effect zones with truthful change reporting", () => {
    const d = fresh();
    expect(applyOp(d, { op: "zone.paint", kind: "water", cells: ["2,3", "2,4"] })).toBe(true);
    expect(d.zones?.water?.sort()).toEqual(["2,3", "2,4"]);
    expect(applyOp(d, { op: "zone.paint", kind: "water", cells: ["2,3"] })).toBe(false); // already painted
    expect(applyOp(d, { op: "zone.paint", kind: "smoke", cells: ["9,9"] })).toBe(true); // kinds are independent
    expect(applyOp(d, { op: "zone.paint", kind: "water", cells: ["2,3"], erase: true })).toBe(true);
    expect(d.zones?.water).toEqual(["2,4"]);
    expect(applyOp(d, { op: "zone.paint", kind: "water", cells: ["8,8"], erase: true })).toBe(false); // nothing to erase
    expect(d.zones?.smoke).toEqual(["9,9"]);
  });

  it("treats scene.switch as a no-op at this layer", () => {
    const d = fresh();
    expect(applyOp(d, { op: "scene.switch", sceneId: "s2" })).toBe(false);
  });
});
