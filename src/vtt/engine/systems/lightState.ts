// Pure light math. Two independent ideas live here:
//
//  1. The LANTERN mechanic (realistic fog): lights start UNLIT, a click lights
//     them (litAt), and they dim linearly back to nothing over burnSeconds until
//     relit. It is OPTIONAL — a scene can switch it off (fog.lanterns === false)
//     and individual lights can opt out (alwaysOn); then lights simply burn.
//  2. DIRECTION: a light can be a cone (dir + cone degrees) instead of a bare
//     point, so lanterns, spotlights and window-shafts can point somewhere.
import type { VttFogState, VttLight } from "../../types/scene";

/** Does the lit/relight/burn-down mechanic apply in this scene at all? */
export function burnMechanicOn(fog: Pick<VttFogState, "mode" | "lanterns">): boolean {
  return fog.mode === "realistic" && fog.lanterns !== false;
}

/** 0..1 brightness of a light. 0 = contributes nothing (unlit / burned out). */
export function lightFactor(
  l: Pick<VttLight, "lit" | "litAt" | "burnSeconds" | "alwaysOn">,
  burnMechanic: boolean,
  now = Date.now()
): number {
  if (!burnMechanic || l.alwaysOn) return 1;
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

/** Is a light directional (a cone) rather than an omnidirectional point? */
export function isDirectional(l: Pick<VttLight, "dir" | "cone">): boolean {
  return l.dir != null && l.cone != null && l.cone > 0 && l.cone < 360;
}

/** Does the offset (dx, dy) from the light fall inside its cone? Omni = always. */
export function inLightCone(l: Pick<VttLight, "dir" | "cone">, dx: number, dy: number): boolean {
  if (!isDirectional(l)) return true;
  const half = ((l.cone as number) * Math.PI) / 180 / 2;
  let a = Math.atan2(dy, dx) - (l.dir as number);
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return Math.abs(a) <= half;
}

/** The eight compass headings, for a one-click direction picker. */
export const LIGHT_DIRECTIONS: { label: string; rad: number }[] = [
  { label: "N", rad: -Math.PI / 2 },
  { label: "NE", rad: -Math.PI / 4 },
  { label: "E", rad: 0 },
  { label: "SE", rad: Math.PI / 4 },
  { label: "S", rad: Math.PI / 2 },
  { label: "SW", rad: (3 * Math.PI) / 4 },
  { label: "W", rad: Math.PI },
  { label: "NW", rad: (-3 * Math.PI) / 4 },
];
