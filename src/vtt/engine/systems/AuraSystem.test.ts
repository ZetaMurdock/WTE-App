import { describe, expect, it } from "vitest";
import { bindAura, dropOrphanAuras, reanchorAuras, unbindAura } from "./AuraSystem";
import { applyOp } from "../../sync/patches";
import { defaultSceneData, type VttSceneData } from "../../types/scene";

function scene(): VttSceneData {
  const data = defaultSceneData();
  data.tokens = [
    { id: "caster", name: "Vaun", x: 100, y: 100, size: 1, color: "#fff", visible: true },
    { id: "other", name: "Kira", x: 300, y: 300, size: 1, color: "#fff", visible: true },
  ];
  data.effects = [{ id: "aura", kind: "circle", x: 100, y: 100, data: { radius: 3 } }];
  return data;
}

describe("bindAura", () => {
  it("captures the offset between a template's anchor and its owner", () => {
    const data = scene();
    // A rect zone anchors top-LEFT, so it does not sit on its owner's centre.
    data.effects = [{ id: "zone", kind: "zone", x: 30, y: 65, data: { w: 4, h: 4 } }];
    expect(bindAura(data, "zone", "caster")).toBe(true);
    expect(data.effects[0].data.auraDx).toBe(-70);
    expect(data.effects[0].data.auraDy).toBe(-35);

    data.tokens[0].x = 500;
    data.tokens[0].y = 500;
    reanchorAuras(data);
    // The corner keeps its distance rather than snapping onto the token.
    expect(data.effects[0].x).toBe(430);
    expect(data.effects[0].y).toBe(465);
  });

  it("refuses a binding either half of which is missing", () => {
    const data = scene();
    expect(bindAura(data, "aura", "ghost")).toBe(false);
    expect(bindAura(data, "ghost", "caster")).toBe(false);
    expect(data.effects[0].data.auraTokenId).toBeUndefined();
  });
});

describe("reanchorAuras", () => {
  it("carries a bound aura with its owner and leaves everything else alone", () => {
    const data = scene();
    data.effects.push({ id: "placed", kind: "circle", x: 700, y: 700, data: { radius: 2 } });
    bindAura(data, "aura", "caster");

    data.tokens[0].x = 240;
    data.tokens[0].y = 380;
    expect(reanchorAuras(data)).toEqual(["aura"]);
    expect(data.effects[0]).toMatchObject({ x: 240, y: 380 });
    // A template the Curator placed by hand has no owner and never moves.
    expect(data.effects[1]).toMatchObject({ x: 700, y: 700 });
  });

  it("is idempotent — a second pass with nobody moving reports no change", () => {
    const data = scene();
    bindAura(data, "aura", "caster");
    data.tokens[0].x = 240;
    expect(reanchorAuras(data)).toEqual(["aura"]);
    expect(reanchorAuras(data)).toEqual([]);
  });

  it("keeps riding an owner the Curator has hidden", () => {
    const data = scene();
    bindAura(data, "aura", "caster");
    // Hiding conceals an actor from the players' view. It does not take the
    // caster off the map, so an aura that switched off would make concealment a
    // defence the setting never granted.
    data.tokens[0].visible = false;
    data.tokens[0].x = 555;
    expect(reanchorAuras(data)).toEqual(["aura"]);
    expect(data.effects[0].x).toBe(555);
  });

  it("leaves an orphaned aura where it stands rather than dragging it to the origin", () => {
    const data = scene();
    bindAura(data, "aura", "caster");
    data.tokens = data.tokens.filter((t) => t.id !== "caster");
    expect(reanchorAuras(data)).toEqual([]);
    expect(data.effects[0]).toMatchObject({ x: 100, y: 100 });
  });
});

describe("dropOrphanAuras", () => {
  it("removes an aura whose owner left the scene, and only that", () => {
    const data = scene();
    data.effects.push({ id: "placed", kind: "circle", x: 700, y: 700, data: { radius: 2 } });
    bindAura(data, "aura", "caster");
    data.tokens = data.tokens.filter((t) => t.id !== "caster");

    expect(dropOrphanAuras(data)).toEqual(["aura"]);
    expect(data.effects.map((e) => e.id)).toEqual(["placed"]);
    // Idempotent: a second pass has nothing left to orphan.
    expect(dropOrphanAuras(data)).toEqual([]);
  });

  it("never touches a template nobody bound", () => {
    const data = scene();
    data.tokens = [];
    expect(dropOrphanAuras(data)).toEqual([]);
    expect(data.effects).toHaveLength(1);
  });
});

describe("unbindAura", () => {
  it("cuts the tie and leaves the template exactly where it stands", () => {
    const data = scene();
    bindAura(data, "aura", "caster");
    data.tokens[0].x = 400;
    reanchorAuras(data);

    expect(unbindAura(data, "aura")).toBe(true);
    expect(data.effects[0].data.auraTokenId).toBeUndefined();
    data.tokens[0].x = 900;
    expect(reanchorAuras(data)).toEqual([]);
    expect(data.effects[0].x).toBe(400);
    // A second unbind is not a change to report.
    expect(unbindAura(data, "aura")).toBe(false);
  });
});

// The reason AuraSystem exists is that a token's position changes in more than
// one place. `applyOp` is the funnel for every move that did not start at this
// renderer — a peer's drop, the host's arbitration, and a move applied to a
// PINNED scene with no renderer involved at all.
describe("the op path", () => {
  it("carries an aura when a peer's move arrives", () => {
    const data = scene();
    bindAura(data, "aura", "caster");
    expect(applyOp(data, { op: "token.move", id: "caster", x: 420, y: 480 })).toBe(true);
    expect(data.effects[0]).toMatchObject({ x: 420, y: 480 });
  });

  it("does not drag an aura when a DIFFERENT token moves", () => {
    const data = scene();
    bindAura(data, "aura", "caster");
    applyOp(data, { op: "token.move", id: "other", x: 900, y: 900 });
    expect(data.effects[0]).toMatchObject({ x: 100, y: 100 });
  });

  it("takes the aura with its owner when the token is removed", () => {
    const data = scene();
    bindAura(data, "aura", "caster");
    expect(applyOp(data, { op: "token.remove", id: "caster" })).toBe(true);
    expect(data.effects).toEqual([]);
  });

  it("leaves auras alone when a token.remove matched nothing", () => {
    const data = scene();
    bindAura(data, "aura", "caster");
    expect(applyOp(data, { op: "token.remove", id: "ghost" })).toBe(false);
    expect(data.effects).toHaveLength(1);
  });
});
