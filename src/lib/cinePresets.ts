// Cinematic screen effects — full-screen GLSL bodies (same contract as the map
// shaders: modify `color` via `uv`, `uTime`, `uResolution`, re-sample
// `uTexture`) applied over the WHOLE stage on every player's screen. Presets
// ship the classics; the Curator can write their own body, exactly like the
// zone brushes. ES 1.00-safe: no array constructors, no bit ops.
import { validateShaderBody } from "../vtt/engine/filters/CustomShaderFilter";

export interface CinePreset {
  id: string;
  name: string;
  note: string;
  body: string;
}

export const CINE_PRESETS: CinePreset[] = [
  {
    id: "redalert",
    name: "Red alert",
    note: "Pulsing emergency lights — red wash breathing at the edges",
    body: `
float pulse = 0.55 + 0.45 * sin(uTime * 3.2);
vec2 c = uv - 0.5;
float d = length(c) * 1.6;
color.rgb = mix(color.rgb, vec3(0.75, 0.04, 0.04), clamp((0.18 + 0.5 * d) * pulse, 0.0, 0.85));
color.rgb *= 1.0 - 0.3 * d * pulse;`,
  },
  {
    id: "focus",
    name: "Dread focus",
    note: "Desaturated, heavy vignette — all eyes on the middle of the frame",
    body: `
vec2 c = uv - 0.5;
float d = length(c) * 1.5;
float grey = dot(color.rgb, vec3(0.299, 0.587, 0.114));
color.rgb = mix(color.rgb, vec3(grey), 0.55);
color.rgb *= 1.0 - smoothstep(0.35, 0.95, d) * 0.85;`,
  },
  {
    id: "static",
    name: "Signal loss",
    note: "Rolling scanlines + static crawl — the feed is breaking up",
    body: `
float n = fract(sin(dot(uv * uResolution.xy + uTime * 60.0, vec2(12.9898, 78.233))) * 43758.5453);
float line = step(0.5, fract(uv.y * uResolution.y * 0.25 + uTime * 8.0)) * 0.06;
float roll = smoothstep(0.0, 0.02, abs(fract(uv.y - uTime * 0.11) - 0.5) ) ;
color.rgb = mix(color.rgb, vec3(n), 0.14);
color.rgb -= line;
color.rgb *= 0.72 + 0.28 * roll;`,
  },
  {
    id: "heartbeat",
    name: "Heartbeat",
    note: "Slow dark throb — the world dims and swells like a pulse",
    body: `
float t = fract(uTime * 0.9);
float beat = smoothstep(0.0, 0.08, t) * (1.0 - smoothstep(0.12, 0.5, t));
float beat2 = smoothstep(0.18, 0.24, t) * (1.0 - smoothstep(0.26, 0.55, t));
float b = clamp(beat + 0.6 * beat2, 0.0, 1.0);
vec2 c = uv - 0.5;
color.rgb *= 0.55 + 0.45 * (1.0 - length(c)) + 0.25 * b;
color.r += 0.10 * b;`,
  },
];

export function cinePresetBody(id: string): string | undefined {
  return CINE_PRESETS.find((p) => p.id === id)?.body;
}

/** Validate a custom cinematic body — same rules as the map shader chunks. */
export function validateCineBody(body: string): string | null {
  return validateShaderBody(body);
}
