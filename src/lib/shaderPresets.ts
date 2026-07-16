// Reusable height-fog / custom-shader presets (localStorage, global across scenes).
import type { VttShader } from "../vtt/types/scene";

export interface ShaderPreset {
  name: string;
  shader: VttShader;
}

const KEY = "wte-shader-presets";

// Built-in starters, always offered alongside the user's saved presets.
const BUILTINS: ShaderPreset[] = [
  { name: "Swamp haze", shader: { heightFog: true, density: 1.1, falloff: 0.02, color: "#1b2a1c", offset: 0, glsl: "" } },
  { name: "Dungeon depths", shader: { heightFog: true, density: 0.9, falloff: 0.01, color: "#0a0c14", offset: 0, glsl: "" } },
  { name: "Toxic valley", shader: { heightFog: true, density: 1.3, falloff: 0.03, color: "#12300f", offset: 0, glsl: "" } },
  // Custom 2D GLSL chunks — contract: modify `color` (vec4) using `uv` (vec2),
  // `uTime` (seconds), `uResolution`, and re-sample `uTexture` for distortion.
  { name: "Water shimmer (custom)", shader: {
      heightFog: false, density: 0.6, falloff: 0.012, color: "#0c1220", offset: 0,
      glsl: [
        "vec2 w = uv;",
        "w.x += sin(uv.y * 90.0 + uTime * 1.6) * 0.0018;",
        "w.y += cos(uv.x * 80.0 + uTime * 1.3) * 0.0015;",
        "color = texture(uTexture, w);",
        "color.rgb += vec3(0.0, 0.015, 0.03) * (0.5 + 0.5 * sin(uTime * 0.9));",
      ].join("\n"),
    } },
  { name: "Heat haze (custom)", shader: {
      heightFog: false, density: 0.6, falloff: 0.012, color: "#0c1220", offset: 0,
      glsl: [
        "vec2 w = uv;",
        "w.x += sin(uv.y * 24.0 + uTime * 3.2) * 0.0011;",
        "color = texture(uTexture, w);",
        "color.rgb *= 1.0 + 0.03 * sin(uTime * 5.0 + uv.y * 40.0);",
      ].join("\n"),
    } },
  { name: "Grain & vignette (custom)", shader: {
      heightFog: false, density: 0.6, falloff: 0.012, color: "#0c1220", offset: 0,
      glsl: [
        "float g = fract(sin(dot(uv * (uTime + 1.0), vec2(12.9898, 78.233))) * 43758.5453) - 0.5;",
        "color.rgb += g * 0.05;",
        "float d = distance(uv, vec2(0.5));",
        "color.rgb *= smoothstep(0.95, 0.35, d);",
      ].join("\n"),
    } },
  { name: "Abyssal pulse (custom)", shader: {
      heightFog: false, density: 0.6, falloff: 0.012, color: "#0c1220", offset: 0,
      glsl: [
        "float breathe = 0.85 + 0.15 * sin(uTime * 0.8);",
        "color.rgb *= breathe;",
        "color.b *= 1.06;",
        "float d = distance(uv, vec2(0.5));",
        "color.rgb *= smoothstep(1.05, 0.3 + 0.06 * sin(uTime * 0.5), d);",
      ].join("\n"),
    } },
];

function readUser(): ShaderPreset[] {
  try {
    return (JSON.parse(localStorage.getItem(KEY) || "[]") as ShaderPreset[]) || [];
  } catch {
    return [];
  }
}
export function listShaderPresets(): ShaderPreset[] {
  return [...BUILTINS, ...readUser()];
}
export function saveShaderPreset(name: string, shader: VttShader): void {
  const user = readUser().filter((p) => p.name.toLowerCase() !== name.toLowerCase());
  user.push({ name, shader });
  try {
    localStorage.setItem(KEY, JSON.stringify(user));
  } catch {
    /* ignore */
  }
}
export function deleteShaderPreset(name: string): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(readUser().filter((p) => p.name !== name)));
  } catch {
    /* ignore */
  }
}
export function isBuiltinPreset(name: string): boolean {
  return BUILTINS.some((p) => p.name === name);
}
