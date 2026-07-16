// Custom GLSL fragment shaders for the 2D view. The user's chunk is a GLSL ES
// 3.00 BODY that runs per-pixel over the scene background with this contract:
//
//   vec2  uv          — texture coordinate (0..1 across the map)
//   vec4  color       — the sampled pixel; MODIFY THIS
//   float uTime       — seconds since the shader was applied (animate with it)
//   vec2  uResolution — filter input size in pixels
//   uTexture          — the background sampler (re-sample for distortion:
//                       `color = texture(uTexture, warpedUv);`)
//
// Chunks are pre-validated against a raw GL context so a typo reports a
// readable compile error instead of crashing the renderer. NOTE: Pixi compiles
// filters as GLSL ES 1.00 (compat defines, no #version) — chunks must stick to
// ES 1.00-compatible syntax (no ES3 array constructors, no bit ops).
import { Filter, GlProgram, UniformGroup, defaultFilterVert } from "pixi.js";

function buildFragment(body: string): string {
  return [
    "in vec2 vTextureCoord;",
    "out vec4 finalColor;",
    "uniform sampler2D uTexture;",
    "uniform float uTime;",
    "uniform vec2 uResolution;",
    "void main() {",
    "  vec2 uv = vTextureCoord;",
    "  vec4 color = texture(uTexture, uv);",
    "  // ── custom chunk ──",
    body,
    "  // ── end chunk ──",
    "  finalColor = color;",
    "}",
  ].join("\n");
}

/** Compile-check a FULL fragment source, mirroring EXACTLY how Pixi's GL filter
 *  pipeline compiles it: as GLSL ES 1.00 with compatibility defines (in→varying,
 *  texture→texture2D, finalColor→gl_FragColor) and the `out` declaration
 *  stripped — there is NO #version 300 es. Validating as ES3 (the old way) let
 *  ES3-only syntax like array constructors pass validation and then fail the
 *  real compile as a SILENT no-render. Returns null when it compiles, else a
 *  (trimmed) human-readable error. */
export function validateFragmentSource(src: string): string | null {
  const canvas = document.createElement("canvas");
  const gl = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
  if (!gl) return null; // nothing to validate with — let the renderer try
  const sh = gl.createShader(gl.FRAGMENT_SHADER);
  if (!sh) return null;
  const preamble = ["#define in varying", "#define finalColor gl_FragColor", "#define texture texture2D", "precision mediump float;", ""].join("\n");
  const body = src.replace(/^\s*out\s+vec4\s+finalColor\s*;\s*$/m, "");
  gl.shaderSource(sh, preamble + body);
  gl.compileShader(sh);
  const ok = gl.getShaderParameter(sh, gl.COMPILE_STATUS) as boolean;
  const log = ok ? null : gl.getShaderInfoLog(sh);
  gl.deleteShader(sh);
  return ok ? null : (log || "Shader failed to compile.").trim().slice(0, 500);
}

/** Compile-check a background-chunk BODY (the whole-map custom shader). */
export function validateShaderBody(body: string): string | null {
  return validateFragmentSource(buildFragment(body));
}

export class CustomShaderFilter extends Filter {
  private customUniforms: UniformGroup;

  constructor(body: string) {
    const glProgram = GlProgram.from({
      vertex: defaultFilterVert,
      fragment: buildFragment(body),
      name: "wte-custom-2d",
    });
    const customUniforms = new UniformGroup({
      uTime: { value: 0, type: "f32" },
      uResolution: { value: new Float32Array([1, 1]), type: "vec2<f32>" },
    });
    super({ glProgram, resources: { customUniforms } });
    this.customUniforms = customUniforms;
  }

  /** Advance the animation clock (seconds) + keep the resolution current. */
  tick(timeSeconds: number, width: number, height: number): void {
    const u = this.customUniforms.uniforms as { uTime: number; uResolution: Float32Array };
    u.uTime = timeSeconds;
    u.uResolution[0] = width;
    u.uResolution[1] = height;
  }
}
