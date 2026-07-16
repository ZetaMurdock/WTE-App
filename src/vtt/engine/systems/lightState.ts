// Pure light-burn math for realistic fog: lights start UNLIT, a click lights
// them (litAt), and they dim linearly back to nothing over the Curator-set
// burnSeconds until relit. Outside realistic fog, lights simply burn (classic).
import type { VttLight } from "../../types/scene";

/** 0..1 brightness of a light. 0 = contributes nothing (unlit / burned out). */
export function lightFactor(l: Pick<VttLight, "lit" | "litAt" | "burnSeconds">, realistic: boolean, now = Date.now()): number {
  if (!realistic) return 1;
  if (!l.lit) return 0;
  if (!l.burnSeconds || l.burnSeconds <= 0 || l.litAt == null) return 1; // eternal flame
  const f = 1 - (now - l.litAt) / 1000 / l.burnSeconds;
  return Math.max(0, Math.min(1, f));
}

/** Effective vision/glow radius multiplier as a light burns down — it never
 *  snaps off, it shrinks and dies. */
export function lightRadiusScale(factor: number): number {
  return factor <= 0 ? 0 : 0.35 + 0.65 * factor;
}
