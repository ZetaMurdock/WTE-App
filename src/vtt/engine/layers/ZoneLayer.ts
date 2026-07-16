// Painted effect zones: the Curator brushes cells with an effect kind and this
// layer renders them as ANIMATED procedural shader regions over the map art.
// SIX slots across TWO masks (3 RGB channels each — canvas uploads premultiply,
// so alpha can't carry data): water/smoke/ember ship with built-in effects,
// auxa/auxb/auxc are the Custom A/B/C slots. EVERY slot's GLSL body is
// user-editable per scene (see buildZoneFragment for the contract).
//
// Rendering (same family as the smooth fog): each mask is a tiny RGBA canvas at
// ONE PIXEL PER CELL stretched over the grid as a world-space sprite — bilinear
// sampling feathers zone borders — and a filter REPLACES the sprite's output
// with procedural effect colour per channel. Patterns are computed in WORLD
// CELL coordinates (uWorld uniform, re-anchored each frame) so they stay glued
// to the map under any pan/zoom.
import { Container, Filter, GlProgram, Sprite, Texture, UniformGroup, defaultFilterVert } from "pixi.js";
import { ZONE_KINDS, type VttScene, type VttZoneKind } from "../../types/scene";

/** Built-in effect body per slot — the defaults users start from and can
 *  replace. Contract: set `col` (vec3) and `alpha` (float) using `mask`
 *  (this channel's feathered 0..1), `pc` (world cell coords), `uTime` (s). */
export const ZONE_DEFAULT_BODIES: Record<VttZoneKind, string> = {
  water: [
    "float w1 = sin(pc.x * 2.6 + uTime * 1.5) * sin(pc.y * 2.2 - uTime * 1.1);",
    "float w2 = sin((pc.x + pc.y) * 3.7 - uTime * 1.9);",
    "float caust = pow(clamp(w1 * 0.5 + w2 * 0.5, 0.0, 1.0), 2.2);",
    "float band = 0.5 + 0.5 * sin(pc.x * 1.3 + pc.y * 0.9 + uTime * 0.7);",
    "col = vec3(0.03, 0.30, 0.24) + vec3(0.10, 0.42, 0.34) * caust + vec3(0.0, 0.08, 0.10) * band;",
    "alpha = mask * (0.46 + 0.08 * sin(uTime * 0.9 + pc.x * 0.5));",
  ].join("\n"),
  smoke: [
    "vec2 q = pc * 0.9 + vec2(uTime * 0.25, -uTime * 0.1);",
    "float n = sin(q.x * 1.7 + sin(q.y * 2.3)) * sin(q.y * 1.3 + sin(q.x * 1.9 + uTime * 0.6));",
    "float wisp = 0.45 + 0.55 * n;",
    "col = vec3(0.62, 0.64, 0.68) * (0.55 + 0.45 * wisp);",
    "alpha = mask * (0.28 + 0.30 * wisp);",
  ].join("\n"),
  ember: [
    "vec2 q = pc + vec2(0.0, uTime * 0.15);",
    "float veins = pow(0.5 + 0.5 * sin(q.x * 3.1) * sin(q.y * 2.4 + uTime * 0.8), 3.0);",
    "float pulse = 0.75 + 0.25 * sin(uTime * 1.6 + pc.x * 0.7);",
    "col = (vec3(0.55, 0.10, 0.02) + vec3(0.9, 0.45, 0.05) * veins) * pulse;",
    "alpha = mask * 0.55;",
  ].join("\n"),
  auxa: [
    "float sw = sin(pc.x * 1.4 + uTime * 0.7) * sin(pc.y * 1.1 - uTime * 0.5);",
    "col = mix(vec3(0.30, 0.08, 0.45), vec3(0.10, 0.20, 0.50), 0.5 + 0.5 * sw);",
    "alpha = mask * (0.34 + 0.10 * sin(uTime * 1.1 + pc.y));",
  ].join("\n"),
  auxb: [
    "float g = sin(pc.x * 6.0 + uTime * 2.0) * sin(pc.y * 6.0 - uTime * 1.6);",
    "col = vec3(0.05, 0.55, 0.60) * (0.5 + 0.5 * pow(clamp(g, 0.0, 1.0), 2.0));",
    "alpha = mask * 0.4;",
  ].join("\n"),
  auxc: [
    "float m1 = fract(sin(dot(floor(pc * 2.0), vec2(12.9898, 78.233))) * 43758.5453);",
    "float tw = 0.5 + 0.5 * sin(uTime * (1.5 + m1 * 3.0) + m1 * 40.0);",
    "col = vec3(0.85, 0.55, 0.15) * tw;",
    "alpha = mask * 0.35 * tw;",
  ].join("\n"),
};

/** Assemble one mask-unit's fragment from three channel bodies. Each body runs
 *  in its own scope with `mask`, `pc`, `uTime` in reach and writes col/alpha. */
export function buildZoneFragment(bodies: [string, string, string]): string {
  const channel = (ch: "r" | "g" | "b", body: string) =>
    [
      `  if (m.${ch} > 0.004) {`,
      `    float mask = m.${ch};`,
      "    vec3 col = vec3(0.0);",
      "    float alpha = 0.0;",
      "    {",
      body,
      "    }",
      "    rgb += col * alpha;",
      "    a += alpha;",
      "  }",
    ].join("\n");
  return [
    "in vec2 vTextureCoord;",
    "out vec4 finalColor;",
    "uniform sampler2D uTexture;",
    "// highp REQUIRED: the default filter vertex declares these highp — a mediump",
    "// redeclaration here fails the program link ('precisions differ').",
    "uniform highp vec4 uInputSize;",
    "uniform highp vec4 uOutputFrame;",
    "uniform float uTime;",
    "uniform vec4 uWorld; // world origin x, y (screen px), 1/worldScale, cell px",
    "void main() {",
    "  vec4 m = texture(uTexture, vTextureCoord);",
    "  vec2 world = ((vTextureCoord * uInputSize.xy + uOutputFrame.xy) - uWorld.xy) * uWorld.z;",
    "  vec2 pc = world / max(uWorld.w, 1.0);",
    "  vec3 rgb = vec3(0.0);",
    "  float a = 0.0;",
    channel("r", bodies[0]),
    channel("g", bodies[1]),
    channel("b", bodies[2]),
    "  finalColor = vec4(rgb, min(a, 0.9));",
    "}",
  ].join("\n");
}

interface MaskUnit {
  kinds: [VttZoneKind, VttZoneKind, VttZoneKind];
  sprite: Sprite;
  canvas: HTMLCanvasElement | null;
  tex: Texture | null;
  uniforms: UniformGroup;
  fragKey: string;
}

export class ZoneLayer {
  readonly view = new Container();
  private units: MaskUnit[];
  private lastKey = "";
  private bodies: Record<VttZoneKind, string> = { ...ZONE_DEFAULT_BODIES };

  constructor() {
    this.view.eventMode = "none";
    this.units = [
      this.makeUnit(["water", "smoke", "ember"]),
      this.makeUnit(["auxa", "auxb", "auxc"]),
    ];
    for (const u of this.units) this.view.addChild(u.sprite);
    this.rebuildFilters(true);
  }

  private makeUnit(kinds: [VttZoneKind, VttZoneKind, VttZoneKind]): MaskUnit {
    const sprite = new Sprite(Texture.EMPTY);
    sprite.visible = false;
    const uniforms = new UniformGroup({
      uTime: { value: 0, type: "f32" },
      uWorld: { value: new Float32Array([0, 0, 1, 70]), type: "vec4<f32>" },
    });
    return { kinds, sprite, canvas: null, tex: null, uniforms, fragKey: "" };
  }

  /** Swap in the effective (validated) GLSL bodies; rebuilds only changed units. */
  setBodies(bodies: Record<VttZoneKind, string>): void {
    this.bodies = bodies;
    this.rebuildFilters(false);
  }

  private rebuildFilters(force: boolean): void {
    for (const u of this.units) {
      const frag = buildZoneFragment([this.bodies[u.kinds[0]], this.bodies[u.kinds[1]], this.bodies[u.kinds[2]]]);
      if (!force && frag === u.fragKey) continue;
      u.fragKey = frag;
      try {
        u.sprite.filters = [
          new Filter({
            glProgram: GlProgram.from({ vertex: defaultFilterVert, fragment: frag, name: "wte-zones-" + u.kinds[0] }),
            resources: { zoneUniforms: u.uniforms },
          }),
        ];
      } catch {
        u.sprite.filters = []; // engine pre-validates; this is the last-resort belt
      }
    }
  }

  /** Rebuild the masks when zones / grid change (cheap string-keyed skip). */
  draw(scene: VttScene): void {
    const { grid, zones } = scene.data;
    const counts = ZONE_KINDS.map((k) => zones?.[k]?.length ?? 0);
    let sum = 0;
    if (zones) for (const k of ZONE_KINDS) for (const c of zones[k] ?? []) for (let i = 0; i < c.length; i++) sum = (sum + c.charCodeAt(i) * 31) >>> 0;
    const key = `${scene.id}|${grid.size},${grid.cols},${grid.rows}|${counts.join(",")}|${sum}`;
    if (key === this.lastKey) return;
    this.lastKey = key;

    for (const u of this.units) {
      const total = u.kinds.reduce((s, k) => s + (zones?.[k]?.length ?? 0), 0);
      u.sprite.visible = total > 0;
      if (total === 0) continue;

      const w = grid.cols;
      const h = grid.rows;
      if (!u.canvas || u.canvas.width !== w || u.canvas.height !== h) {
        u.canvas = document.createElement("canvas");
        u.canvas.width = w;
        u.canvas.height = h;
        u.tex?.destroy(true);
        u.tex = Texture.from(u.canvas);
        u.tex.source.scaleMode = "linear"; // feathered zone borders
        u.sprite.texture = u.tex;
      }
      const ctx = u.canvas.getContext("2d")!;
      const img = ctx.createImageData(w, h);
      const px = img.data;
      for (let i = 3; i < px.length; i += 4) px[i] = 255; // alpha ALWAYS opaque (premultiply-safe)
      u.kinds.forEach((k, ch) => {
        for (const cell of zones?.[k] ?? []) {
          const [c, r] = cell.split(",").map(Number);
          if (c >= 0 && r >= 0 && c < w && r < h) px[(r * w + c) * 4 + ch] = 255;
        }
      });
      ctx.putImageData(img, 0, 0);
      u.tex!.source.update();
      u.sprite.position.set(0, 0);
      u.sprite.width = w * grid.size;
      u.sprite.height = h * grid.size;
    }
  }

  /** Per-frame: advance the animation clock + re-anchor patterns to the world. */
  tick(timeSeconds: number, worldOriginX: number, worldOriginY: number, worldScale: number, cellPx: number): void {
    for (const un of this.units) {
      const u = un.uniforms.uniforms as { uTime: number; uWorld: Float32Array };
      u.uTime = timeSeconds;
      u.uWorld[0] = worldOriginX;
      u.uWorld[1] = worldOriginY;
      u.uWorld[2] = 1 / Math.max(worldScale, 0.0001);
      u.uWorld[3] = cellPx;
    }
  }

  /** Any painted cells at all? (drives the engine's per-frame tick guard) */
  get active(): boolean {
    return this.units.some((u) => u.sprite.visible);
  }
}
