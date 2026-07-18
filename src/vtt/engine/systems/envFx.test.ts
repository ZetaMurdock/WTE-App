import { describe, expect, it } from "vitest";
import { pickEnvFx } from "./envFx";
import type { VttEmitter } from "../../types/scene";

const CELL = 70;
function emitter(over: Partial<VttEmitter> = {}): VttEmitter {
  return { id: "em", x: 0, y: 0, radius: 10, name: "n", src: "data:x", volume: 1, loop: true, ...over };
}

describe("pickEnvFx", () => {
  it("no field and no fx-emitters → nothing", () => {
    expect(pickEnvFx([emitter()], { x: 0, y: 0 }, CELL, null)).toBeNull();
  });

  it("a whole-map field applies at its intensity regardless of listener", () => {
    expect(pickEnvFx([], null, CELL, { preset: "bleed", intensity: 0.5 })).toEqual({ preset: "bleed", intensity: 0.5 });
  });

  it("emitter FX ramps up as the listener nears it", () => {
    const e = emitter({ fx: "frost", fxMax: 1 });
    const near = pickEnvFx([e], { x: 1 * CELL, y: 0 }, CELL, null)!;
    const far = pickEnvFx([e], { x: 8 * CELL, y: 0 }, CELL, null)!;
    expect(near.preset).toBe("frost");
    expect(near.intensity).toBeGreaterThan(far.intensity);
    expect(far.intensity).toBeGreaterThan(0);
  });

  it("silent beyond the emitter radius", () => {
    const e = emitter({ fx: "frost", radius: 5 });
    expect(pickEnvFx([e], { x: 6 * CELL, y: 0 }, CELL, null)).toBeNull();
  });

  it("the strongest source wins — close emitter beats a weak map field", () => {
    const e = emitter({ fx: "bleed", fxMax: 1 });
    const pick = pickEnvFx([e], { x: 0.5 * CELL, y: 0 }, CELL, { preset: "frost", intensity: 0.2 })!;
    expect(pick.preset).toBe("bleed");
  });

  it("a strong map field beats a distant emitter", () => {
    const e = emitter({ fx: "bleed", fxMax: 0.9 });
    const pick = pickEnvFx([e], { x: 9 * CELL, y: 0 }, CELL, { preset: "frost", intensity: 0.8 })!;
    expect(pick.preset).toBe("frost");
  });

  it("emitters without an fx are ignored", () => {
    expect(pickEnvFx([emitter()], { x: 0, y: 0 }, CELL, null)).toBeNull();
  });
});
