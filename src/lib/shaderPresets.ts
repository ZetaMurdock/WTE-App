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
  { name: "Ember glow (custom)", shader: {
      heightFog: true, density: 0.8, falloff: 0.014, color: "#3a1206", offset: 0,
      glsl: [
        "float _hf = uFogDensity * exp(-(vWorldPos.y - uFogOffset) * uFogHeightFalloff);",
        "float _ff = clamp(1.0 - exp(-length(vWorldPos - cameraPosition) * _hf), 0.0, 1.0);",
        "vec3 _ember = uFogColor + vec3(0.35, 0.12, 0.0) * (0.5 + 0.5 * sin(vWorldPos.x * 0.02));",
        "gl_FragColor.rgb = mix(gl_FragColor.rgb, _ember, _ff);",
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
