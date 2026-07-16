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
  { name: "Eldritch Rift (custom)", shader: {
      heightFog: false, density: 0.6, falloff: 0.012, color: "#0c1220", offset: 0,
      glsl: [
        "// ── ELDRITCH RIFT ── a tear in reality wanders the map",
        "vec2 rift = vec2(0.5 + 0.28 * sin(uTime * 0.11) + 0.09 * sin(uTime * 0.37),",
        "                 0.5 + 0.24 * cos(uTime * 0.13) + 0.07 * cos(uTime * 0.29));",
        "vec2 d = uv - rift;",
        "float dist = length(d);",
        "// space CURLS around the rift — the closer, the harder it twists",
        "float curl = 0.55 * exp(-dist * 6.5) * sin(uTime * 0.8);",
        "float cca = cos(curl), csa = sin(curl);",
        "vec2 warped = rift + mat2(cca, -csa, csa, cca) * d;",
        "// breathing pinch: the rift slowly inhales the world around it",
        "warped = mix(warped, rift, 0.22 * exp(-dist * 5.0) * (0.5 + 0.5 * sin(uTime * 1.7)));",
        "// reality TICKS: rare horizontal slices of the map shear sideways",
        "float band = floor(uv.y * 28.0);",
        "float tick = floor(uTime * 2.5);",
        "float bh = fract(sin(band * 12.9898 + tick * 78.233) * 43758.5453);",
        "float gAmt = step(0.93, bh) * (bh - 0.93) * 14.0;",
        "warped.x += gAmt * 0.05 * sin(uTime * 40.0 + band);",
        "// chromatic tearing: colour planes separate radially near the rift",
        "vec2 dir = dist > 0.0001 ? d / dist : vec2(0.0);",
        "float split = 0.006 * exp(-dist * 4.0) + gAmt * 0.004;",
        "float rC = texture(uTexture, warped + dir * split).r;",
        "float gC = texture(uTexture, warped).g;",
        "float bC = texture(uTexture, warped - dir * split).b;",
        "color = vec4(rC, gC, bC, color.a);",
        "// the rift's heart: a dark iris ringed by unlight",
        "float iris = smoothstep(0.06, 0.015, dist);",
        "float ring = smoothstep(0.10, 0.06, dist) - smoothstep(0.06, 0.03, dist);",
        "color.rgb = mix(color.rgb, vec3(0.02, 0.0, 0.05), iris * 0.9);",
        "color.rgb += vec3(0.28, 0.05, 0.45) * ring * (0.6 + 0.4 * sin(uTime * 3.0));",
        "// once in a while reality BLINKS — the world near the rift negates",
        "float blink = step(0.985, fract(sin(tick * 91.17) * 4375.5453));",
        "color.rgb = mix(color.rgb, (1.0 - color.rgb) * vec3(0.7, 0.4, 0.9), blink * exp(-dist * 2.5) * 0.8);",
        "// everything far from the rift breathes darker — the world is being drained",
        "color.rgb *= 0.82 + 0.18 * exp(-dist * 1.4) + 0.06 * sin(uTime * 0.9);",
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
