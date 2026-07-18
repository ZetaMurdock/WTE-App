// Which environmental FX preset drives the local screen right now, and how hard.
// Two sources compete: a whole-map field (constant) and every FX-carrying
// emitter (intensity = the LOCAL listener's proximity, so walking closer ramps
// it up). The strongest wins. Pure — the engine feeds it the listener each tick.
import type { VttEmitter } from "../../types/scene";

export interface EnvFxField {
  preset: string;
  intensity: number;
}
export interface EnvFxPick {
  preset: string;
  intensity: number;
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

export function pickEnvFx(
  emitters: VttEmitter[],
  listener: { x: number; y: number } | null,
  cellPx: number,
  field?: EnvFxField | null
): EnvFxPick | null {
  let best: EnvFxPick | null = null;
  const consider = (preset: string | undefined, intensity: number) => {
    if (!preset || intensity <= 0.002) return;
    if (!best || intensity > best.intensity) best = { preset, intensity: clamp01(intensity) };
  };
  if (field) consider(field.preset, clamp01(field.intensity));
  if (listener) {
    for (const e of emitters) {
      if (!e.fx) continue;
      const r = Math.max(0.5, e.radius);
      const d = Math.hypot(e.x - listener.x, e.y - listener.y) / Math.max(1, cellPx);
      if (d >= r) continue;
      // curved so the FX only really bites up close — same spirit as the audio falloff
      const prox = Math.pow(1 - d / r, 1.5) * (e.fxMax ?? 0.85);
      consider(e.fx, prox);
    }
  }
  return best;
}
