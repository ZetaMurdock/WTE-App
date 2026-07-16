// Reusable zone-brush effect bodies (localStorage, global across scenes).
// Contract (see ZoneLayer.buildZoneFragment): set `col` (vec3) and `alpha`
// (float) from `mask` (feathered 0..1), `pc` (world cell coords), `uTime` (s).
import { ZONE_DEFAULT_BODIES } from "../vtt/engine/layers/ZoneLayer";

export interface ZonePreset {
  name: string;
  body: string;
}

const KEY = "wte-zone-presets";

// Built-in starters, always offered alongside the user's saved presets.
const BUILTINS: ZonePreset[] = [
  { name: "Water (built-in)", body: ZONE_DEFAULT_BODIES.water },
  { name: "Smoke (built-in)", body: ZONE_DEFAULT_BODIES.smoke },
  { name: "Embers (built-in)", body: ZONE_DEFAULT_BODIES.ember },
  { name: "Blood mire", body: [
      "float churn = sin(pc.x * 2.1 + uTime * 0.5) * sin(pc.y * 1.8 - uTime * 0.4);",
      "float clot = pow(0.5 + 0.5 * sin(pc.x * 5.0 + churn * 2.0), 3.0);",
      "col = vec3(0.30, 0.02, 0.03) + vec3(0.25, 0.02, 0.02) * clot;",
      "alpha = mask * (0.55 + 0.08 * churn);",
    ].join("\n") },
  { name: "Void static", body: [
      "float n = fract(sin(dot(floor(pc * 6.0) + floor(uTime * 8.0), vec2(12.9898, 78.233))) * 43758.5453);",
      "col = vec3(0.05, 0.02, 0.10) + vec3(0.20) * step(0.92, n);",
      "alpha = mask * (0.6 + 0.15 * step(0.92, n));",
    ].join("\n") },
  { name: "Arcane pulse", body: [
      "float ringDist = fract(length(fract(pc / 6.0) - 0.5) * 3.0 - uTime * 0.4);",
      "float glow = pow(1.0 - abs(ringDist - 0.5) * 2.0, 4.0);",
      "col = vec3(0.20, 0.60, 0.85) * (0.3 + 0.7 * glow);",
      "alpha = mask * (0.25 + 0.35 * glow);",
    ].join("\n") },
];

function readUser(): ZonePreset[] {
  try {
    return (JSON.parse(localStorage.getItem(KEY) || "[]") as ZonePreset[]) || [];
  } catch {
    return [];
  }
}
export function listZonePresets(): ZonePreset[] {
  return [...BUILTINS, ...readUser()];
}
export function isBuiltinZonePreset(name: string): boolean {
  return BUILTINS.some((p) => p.name.toLowerCase() === name.toLowerCase());
}
export function saveZonePreset(name: string, body: string): void {
  const user = readUser().filter((p) => p.name.toLowerCase() !== name.toLowerCase());
  user.push({ name, body });
  try {
    localStorage.setItem(KEY, JSON.stringify(user));
  } catch {
    /* storage full — preset stays in-session only */
  }
}
export function deleteZonePreset(name: string): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(readUser().filter((p) => p.name.toLowerCase() !== name.toLowerCase())));
  } catch {
    /* ignore */
  }
}
