// Painted effect zones: the Curator brushes cells with an effect kind and this
// layer renders them as ANIMATED procedural shader regions over the map art —
// wavy green-teal water, drifting pale smoke, glowing molten embers.
//
// Rendering trick (same family as the smooth fog): the zones are packed into a
// tiny RGBA mask at ONE PIXEL PER CELL (R=water, G=smoke, B=ember; alpha stays
// 255 because canvas uploads premultiply). The mask is stretched over the grid
// as a world-space sprite — bilinear sampling feathers zone borders — and a
// custom filter REPLACES the sprite's output with procedural effect colour,
// weighted per channel. Patterns are computed in WORLD CELL coordinates (via
// the uWorld uniform, updated each frame), so they stay glued to the map under
// any pan/zoom instead of swimming in screen space.
import { Filter, GlProgram, Sprite, Texture, UniformGroup, defaultFilterVert } from "pixi.js";
import { ZONE_KINDS, type VttScene } from "../../types/scene";

const ZONE_FRAG = /* glsl */ `
in vec2 vTextureCoord;
out vec4 finalColor;
uniform sampler2D uTexture;
// highp REQUIRED: the default filter vertex declares these highp — a mediump
// redeclaration here fails the program link ("precisions differ").
uniform highp vec4 uInputSize;
uniform highp vec4 uOutputFrame;
uniform float uTime;
uniform vec4 uWorld; // world origin x, y (screen px), 1/worldScale, cell px

void main() {
  vec4 m = texture(uTexture, vTextureCoord);
  vec2 world = ((vTextureCoord * uInputSize.xy + uOutputFrame.xy) - uWorld.xy) * uWorld.z;
  vec2 pc = world / max(uWorld.w, 1.0); // pattern space: world CELL units
  vec3 rgb = vec3(0.0);
  float a = 0.0;

  // WATER (R) — layered waves + caustic sparkle, deep green-teal
  if (m.r > 0.004) {
    float w1 = sin(pc.x * 2.6 + uTime * 1.5) * sin(pc.y * 2.2 - uTime * 1.1);
    float w2 = sin((pc.x + pc.y) * 3.7 - uTime * 1.9);
    float caust = pow(clamp(w1 * 0.5 + w2 * 0.5, 0.0, 1.0), 2.2);
    float band = 0.5 + 0.5 * sin(pc.x * 1.3 + pc.y * 0.9 + uTime * 0.7);
    vec3 col = vec3(0.03, 0.30, 0.24) + vec3(0.10, 0.42, 0.34) * caust + vec3(0.0, 0.08, 0.10) * band;
    float aa = m.r * (0.46 + 0.08 * sin(uTime * 0.9 + pc.x * 0.5));
    rgb += col * aa;
    a += aa;
  }
  // SMOKE (G) — drifting pale wisps
  if (m.g > 0.004) {
    vec2 q = pc * 0.9 + vec2(uTime * 0.25, -uTime * 0.1);
    float n = sin(q.x * 1.7 + sin(q.y * 2.3)) * sin(q.y * 1.3 + sin(q.x * 1.9 + uTime * 0.6));
    float wisp = 0.45 + 0.55 * n;
    vec3 col = vec3(0.62, 0.64, 0.68) * (0.55 + 0.45 * wisp);
    float aa = m.g * (0.28 + 0.30 * wisp);
    rgb += col * aa;
    a += aa;
  }
  // EMBER (B) — molten veins, slow pulse
  if (m.b > 0.004) {
    vec2 q = pc + vec2(0.0, uTime * 0.15);
    float veins = pow(0.5 + 0.5 * sin(q.x * 3.1) * sin(q.y * 2.4 + uTime * 0.8), 3.0);
    float pulse = 0.75 + 0.25 * sin(uTime * 1.6 + pc.x * 0.7);
    vec3 col = (vec3(0.55, 0.10, 0.02) + vec3(0.9, 0.45, 0.05) * veins) * pulse;
    float aa = m.b * 0.55;
    rgb += col * aa;
    a += aa;
  }
  finalColor = vec4(rgb, min(a, 0.9)); // premultiplied
}
`;

export class ZoneLayer {
  readonly view = new Sprite(Texture.EMPTY);
  private canvas: HTMLCanvasElement | null = null;
  private tex: Texture | null = null;
  private filter: Filter;
  private uniforms: UniformGroup;
  private lastKey = "";

  constructor() {
    this.uniforms = new UniformGroup({
      uTime: { value: 0, type: "f32" },
      uWorld: { value: new Float32Array([0, 0, 1, 70]), type: "vec4<f32>" },
    });
    this.filter = new Filter({
      glProgram: GlProgram.from({ vertex: defaultFilterVert, fragment: ZONE_FRAG, name: "wte-zones" }),
      resources: { zoneUniforms: this.uniforms },
    });
    this.view.filters = [this.filter];
    this.view.eventMode = "none";
    this.view.visible = false;
  }

  /** Rebuild the mask when zones / grid change (cheap string-keyed skip). */
  draw(scene: VttScene): void {
    const { grid, zones } = scene.data;
    const counts = ZONE_KINDS.map((k) => (zones?.[k]?.length ?? 0));
    const total = counts[0] + counts[1] + counts[2];
    // include a coarse content hash so painting the SAME COUNT of different
    // cells still repaints (e.g. simultaneous add+erase from a peer op)
    let sum = 0;
    if (zones) for (const k of ZONE_KINDS) for (const c of zones[k] ?? []) for (let i = 0; i < c.length; i++) sum = (sum + c.charCodeAt(i) * 31) >>> 0;
    const key = `${scene.id}|${grid.size},${grid.cols},${grid.rows}|${counts.join(",")}|${sum}`;
    if (key === this.lastKey) return;
    this.lastKey = key;

    this.view.visible = total > 0;
    if (total === 0) return;

    const w = grid.cols;
    const h = grid.rows;
    if (!this.canvas || this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas = document.createElement("canvas");
      this.canvas.width = w;
      this.canvas.height = h;
      this.tex?.destroy(true);
      this.tex = Texture.from(this.canvas);
      this.tex.source.scaleMode = "linear"; // feathered zone borders
      this.view.texture = this.tex;
    }
    const ctx = this.canvas.getContext("2d")!;
    const img = ctx.createImageData(w, h);
    const px = img.data;
    for (let i = 3; i < px.length; i += 4) px[i] = 255; // alpha ALWAYS opaque (premultiply-safe)
    const channel: Record<string, number> = { water: 0, smoke: 1, ember: 2 };
    if (zones) {
      for (const k of ZONE_KINDS) {
        const ch = channel[k];
        for (const cell of zones[k] ?? []) {
          const [c, r] = cell.split(",").map(Number);
          if (c >= 0 && r >= 0 && c < w && r < h) px[(r * w + c) * 4 + ch] = 255;
        }
      }
    }
    ctx.putImageData(img, 0, 0);
    this.tex!.source.update();
    this.view.position.set(0, 0);
    this.view.width = w * grid.size;
    this.view.height = h * grid.size;
  }

  /** Per-frame: advance the animation clock + re-anchor patterns to the world. */
  tick(timeSeconds: number, worldOriginX: number, worldOriginY: number, worldScale: number, cellPx: number): void {
    const u = this.uniforms.uniforms as { uTime: number; uWorld: Float32Array };
    u.uTime = timeSeconds;
    u.uWorld[0] = worldOriginX;
    u.uWorld[1] = worldOriginY;
    u.uWorld[2] = 1 / Math.max(worldScale, 0.0001);
    u.uWorld[3] = cellPx;
  }
}
