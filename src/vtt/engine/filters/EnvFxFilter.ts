// Environmental FX: full-screen atmosphere presets that scale with a `uIntensity`
// uniform (0 = invisible, 1 = full). The engine drives that intensity from a
// player's PROXIMITY to an FX-carrying emitter (walk closer → stronger) or a
// whole-map field. Curated built-in bodies only (no user GLSL) so they're
// robust; all ES 1.00-safe and GPU-verified. Same per-pixel contract as the map
// shaders + uIntensity.
import { Filter, GlProgram, UniformGroup, defaultFilterVert } from "pixi.js";
import { validateFragmentSource } from "./CustomShaderFilter";

export interface EnvFxPreset {
  id: string;
  name: string;
  note: string;
}

export const ENV_FX_PRESETS: EnvFxPreset[] = [
  { id: "bleed", name: "Bleed", note: "Blood weeps in from the edges and runs down — stronger the closer you get" },
  { id: "frost", name: "Frost", note: "Cold crystalline rime creeps across the frame; colour drains to blue" },
  { id: "whispers", name: "Whispers", note: "Reality wavers and desaturates — a maddening blur that breathes" },
  { id: "heat", name: "Swelter", note: "Rising heat-shimmer and an amber flush" },
  { id: "void", name: "Void", note: "Creeping dark with eldritch inversion flickers" },
];

const BODIES: Record<string, string> = {
  bleed: `
float k = uIntensity;
float c = uv.x * 30.0; float band = fract(c);
float jit = fract(sin(floor(c) * 91.7) * 43758.5453);
float riv = smoothstep(0.30, 0.5, band) * (1.0 - smoothstep(0.5, 0.70, band));
float drip = fract(uv.y * 1.2 - uTime * (0.15 + 0.2 * jit) + jit);
float run = smoothstep(0.75, 1.0, drip) * riv;
vec2 pc = (uv - 0.5) * vec2(uResolution.x / uResolution.y, 1.0);
float edge = smoothstep(0.2, 0.95, length(pc));
float blood = clamp(edge * 0.7 + run * 0.9, 0.0, 1.0) * k;
color.rgb = mix(color.rgb, vec3(0.5, 0.02, 0.03), blood * 0.85);
color.rgb *= 1.0 - blood * 0.3;`,
  frost: `
float k = uIntensity;
vec2 pc = (uv - 0.5) * vec2(uResolution.x / uResolution.y, 1.0);
float edge = smoothstep(0.15, 0.95, length(pc));
float cr = fract(sin(dot(floor(uv * 40.0), vec2(12.9, 78.2))) * 43758.5453);
float crystal = smoothstep(0.6, 1.0, edge + cr * 0.3);
float g = dot(color.rgb, vec3(0.299, 0.587, 0.114));
float f = clamp(edge * 0.8 + crystal * 0.4, 0.0, 1.0) * k;
color.rgb = mix(color.rgb, vec3(g) * vec3(0.7, 0.85, 1.05), f);
color.rgb += vec3(0.1, 0.15, 0.25) * crystal * k * 0.3;`,
  whispers: `
float k = uIntensity;
vec2 w; w.x = sin(uv.y * 30.0 + uTime * 2.0) * 0.004; w.y = cos(uv.x * 26.0 - uTime * 1.7) * 0.004;
color = texture(uTexture, uv + w * k * 3.0);
float g = dot(color.rgb, vec3(0.299, 0.587, 0.114));
color.rgb = mix(color.rgb, vec3(g) * vec3(0.7, 0.7, 0.8), k * 0.5);
float pulse = 0.5 + 0.5 * sin(uTime * 3.0);
color.rgb *= 1.0 - k * 0.25 * pulse;`,
  heat: `
float k = uIntensity;
vec2 w; w.x = sin(uv.y * 40.0 + uTime * 4.0) * 0.003; w.y = 0.0;
color = texture(uTexture, uv + w * k);
color.rgb = mix(color.rgb, color.rgb * vec3(1.15, 0.9, 0.7), k * 0.5);
color.rgb += vec3(0.15, 0.05, 0.0) * k * (0.5 + 0.5 * sin(uTime * 2.0));`,
  void: `
float k = uIntensity;
vec2 pc = (uv - 0.5) * vec2(uResolution.x / uResolution.y, 1.0);
float edge = smoothstep(0.1, 1.0, length(pc));
float g = fract(sin(floor(uTime * 6.0) * 13.7) * 43758.5453);
float inv = step(0.9, g) * k;
color.rgb = mix(color.rgb, 1.0 - color.rgb, inv * 0.6);
color.rgb *= 1.0 - edge * k * 0.85;
color.rgb += vec3(0.25, 0.0, 0.35) * edge * k * 0.2;`,
};

function buildFragment(body: string): string {
  return [
    "in vec2 vTextureCoord;",
    "out vec4 finalColor;",
    "uniform sampler2D uTexture;",
    "uniform float uTime;",
    "uniform float uIntensity;",
    "uniform vec2 uResolution;",
    "void main() {",
    "  vec2 uv = vTextureCoord;",
    "  vec4 color = texture(uTexture, uv);",
    body,
    "  finalColor = color;",
    "}",
  ].join("\n");
}

/** Is `id` a known preset whose body compiles on THIS GPU? (used for tests) */
export function validateEnvFx(id: string): string | null {
  const body = BODIES[id];
  if (!body) return `Unknown env FX preset "${id}".`;
  return validateFragmentSource(buildFragment(body));
}

export class EnvFxFilter extends Filter {
  private u: UniformGroup;
  constructor(readonly preset: string) {
    const body = BODIES[preset];
    if (!body) throw new Error(`Unknown env FX preset "${preset}".`);
    const glProgram = GlProgram.from({ vertex: defaultFilterVert, fragment: buildFragment(body), name: "wte-env-fx" });
    const u = new UniformGroup({
      uTime: { value: 0, type: "f32" },
      uIntensity: { value: 0, type: "f32" },
      uResolution: { value: new Float32Array([1, 1]), type: "vec2<f32>" },
    });
    super({ glProgram, resources: { customUniforms: u } });
    this.u = u;
  }
  setIntensity(v: number): void {
    (this.u.uniforms as { uIntensity: number }).uIntensity = Math.max(0, Math.min(1, v));
  }
  tick(timeSeconds: number, width: number, height: number): void {
    const uu = this.u.uniforms as { uTime: number; uResolution: Float32Array };
    uu.uTime = timeSeconds;
    uu.uResolution[0] = width;
    uu.uResolution[1] = height;
  }
}
