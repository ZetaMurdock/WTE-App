import { describe, expect, it } from "vitest";
import { lightPerception, AMBIENT_OFF_CONE } from "./VisionSystem";
import { defaultSceneData, type VttLight, type VttSceneData, type VttToken } from "../../types/scene";

const CELL = 70;
function scene(over: Partial<VttSceneData> = {}): VttSceneData {
  const d = defaultSceneData();
  d.fog.enabled = true;
  return { ...d, ...over };
}
function token(over: Partial<VttToken> = {}): VttToken {
  return { id: "t1", name: "P", x: 0, y: 0, size: 1, color: "#fff", visible: true, owner: "p1", ...over };
}
function light(over: Partial<VttLight> = {}): VttLight {
  return { id: "l1", x: 3 * CELL, y: 0, radius: 6, color: "#fff", intensity: 0.6, ...over };
}

describe("lightPerception", () => {
  it("the GM always perceives every light fully", () => {
    const d = scene({ tokens: [], lights: [light()] });
    expect(lightPerception(d, light(), undefined)).toBe(1);
  });

  it("a light dead ahead reads strongly, and full when you stand on it", () => {
    // facing +x with the light at +x — in-cone, but distance still dims it
    const near = scene({ tokens: [token({ facing: 0 })], lights: [light()] });
    expect(lightPerception(near, light(), "p1")).toBeGreaterThan(0.7);
    // standing in it = full
    const onIt = scene({ tokens: [token({ facing: 0, x: 3 * CELL })], lights: [light()] });
    expect(lightPerception(onIt, light(), "p1")).toBeCloseTo(1, 1);
  });

  it("turning away DIMS a light instead of killing it", () => {
    const ahead = scene({ tokens: [token({ facing: 0 })], lights: [light()] });
    const away = scene({ tokens: [token({ facing: Math.PI })], lights: [light()] }); // faced 180° off
    const seenAhead = lightPerception(ahead, light(), "p1");
    const seenAway = lightPerception(away, light(), "p1");
    expect(seenAway).toBeGreaterThan(0); // still perceived — this is the whole point
    expect(seenAway).toBeLessThan(seenAhead);
    expect(seenAway / seenAhead).toBeCloseTo(AMBIENT_OFF_CONE, 1);
  });

  it("ambiance fades with distance", () => {
    const near = scene({ tokens: [token({ facing: 0 })], lights: [light({ x: 2 * CELL })] });
    const far = scene({ tokens: [token({ facing: 0 })], lights: [light({ x: 11 * CELL })] });
    expect(lightPerception(near, light({ x: 2 * CELL }), "p1")).toBeGreaterThan(
      lightPerception(far, light({ x: 11 * CELL }), "p1")
    );
  });

  it("a wall between you and the light IS a hard cut", () => {
    const d = scene({
      tokens: [token({ facing: 0 })],
      lights: [light()],
      walls: [{ id: "w", x1: 1.5 * CELL, y1: -5 * CELL, x2: 1.5 * CELL, y2: 5 * CELL, blocksLight: true }],
    });
    expect(lightPerception(d, light(), "p1")).toBe(0);
  });

  it("someone else's token grants you nothing", () => {
    const d = scene({ tokens: [token({ owner: "other" })], lights: [light()] });
    expect(lightPerception(d, light(), "p1")).toBe(0);
  });
});
