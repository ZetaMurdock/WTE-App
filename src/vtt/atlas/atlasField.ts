// Scalar fields for the Atlas: the machinery that makes a grayscale image
// answer questions.
//
// A field layer's source encodes a value per pixel — terrain height, fyber
// saturation, hazard intensity — and everything here is derived from that one
// sample: the recolored overlay (palette LUT), hillshade relief (gradient
// lighting), contour bands (LUT with band edges), and the cursor readout
// ("ELEV | 2,340 FT"). The pure parts are exported for tests; the canvas
// parts cache aggressively because they run inside a render loop.
import type { AtlasLayer, LayerPalette, LayerStyle } from "./atlasModel";

// ── pure: palettes ───────────────────────────────────────────────────────────

/** RGBA stops, positions 0..1. Linear interpolation between them. */
const PALETTES: Record<LayerPalette, [number, number, number, number, number][]> = {
  gray: [
    [0, 20, 22, 26, 255],
    [1, 235, 240, 244, 255],
  ],
  terrain: [
    [0, 22, 44, 66, 255], // deep water
    [0.32, 40, 92, 110, 255], // shallows
    [0.36, 78, 110, 74, 255], // lowland green
    [0.6, 128, 124, 82, 255], // dry plains
    [0.8, 122, 96, 72, 255], // mountains
    [0.95, 168, 160, 152, 255], // high rock
    [1, 240, 244, 248, 255], // peaks
  ],
  thermal: [
    [0, 18, 24, 48, 255], // cold dark blue
    [0.35, 70, 32, 96, 255], // violet
    [0.6, 160, 44, 52, 255], // red
    [0.82, 232, 120, 40, 255], // orange
    [1, 255, 232, 160, 255], // white-hot
  ],
  toxin: [
    [0, 14, 20, 16, 255],
    [0.5, 52, 108, 62, 255],
    [0.8, 116, 190, 70, 255],
    [1, 210, 250, 120, 255],
  ],
};

/** How many contour bands the "contours" style draws. */
export const CONTOUR_BANDS = 12;

/**
 * A 256-entry RGBA lookup table for a palette+style. "tint" paints the palette
 * itself; "contours" is transparent except thin lines at band edges, so the
 * shape of the field shows without covering the map.
 */
export function paletteLut(palette: LayerPalette, style: LayerStyle): Uint8ClampedArray {
  const lut = new Uint8ClampedArray(256 * 4);
  const stops = PALETTES[palette];
  for (let i = 0; i < 256; i++) {
    const t = i / 255;
    let a = stops[0];
    let b = stops[stops.length - 1];
    for (let s = 0; s < stops.length - 1; s++) {
      if (t >= stops[s][0] && t <= stops[s + 1][0]) {
        a = stops[s];
        b = stops[s + 1];
        break;
      }
    }
    const span = Math.max(1e-6, b[0] - a[0]);
    const k = Math.min(1, Math.max(0, (t - a[0]) / span));
    let r = a[1] + (b[1] - a[1]) * k;
    let g = a[2] + (b[2] - a[2]) * k;
    let bl = a[3] + (b[3] - a[3]) * k;
    let al = a[4] + (b[4] - a[4]) * k;
    if (style === "contours") {
      // thin pale lines at band edges, transparent in between
      const band = (i / 256) * CONTOUR_BANDS;
      const frac = band - Math.floor(band);
      const line = frac < 0.14 && i > 4; // skip the zero band's edge
      r = 190; g = 210; bl = 215;
      al = line ? 200 : 0;
    }
    lut[i * 4] = r;
    lut[i * 4 + 1] = g;
    lut[i * 4 + 2] = bl;
    lut[i * 4 + 3] = al;
  }
  return lut;
}

// ── pure: hillshade ──────────────────────────────────────────────────────────

/**
 * Lambert-ish shade for a height gradient, light from the northwest.
 * Returns 0..1 where 0.5 is flat: below is shadow, above is lit slope.
 */
export function hillshade(gx: number, gy: number): number {
  // light direction (-1,-1) normalized; steeper slopes shade harder
  const s = 0.5 + (-gx - gy) * 1.6;
  return Math.min(1, Math.max(0, s));
}

// ── pure: the readout ────────────────────────────────────────────────────────

/** "ELEV | 2,340 FT", "FYBER | 87%". Null when the layer has no label. */
export function formatFieldValue(sample01: number, layer: Pick<AtlasLayer, "label" | "min" | "max" | "unit">): string | null {
  if (!layer.label) return null;
  const v = layer.min + Math.min(1, Math.max(0, sample01)) * (layer.max - layer.min);
  const span = Math.abs(layer.max - layer.min);
  const shown = span < 10 ? +v.toFixed(1) : Math.round(v);
  const text = shown.toLocaleString("en-US");
  const unit = layer.unit ? (layer.unit === "%" ? "%" : ` ${layer.unit.toUpperCase()}`) : "";
  return `${layer.label.toUpperCase()} | ${text}${unit}`;
}

// ── canvas: decoded field data + rendered overlays ───────────────────────────

/** Fields don't need art resolution; this bounds sample memory (~4 MB). */
const MAX_FIELD_SIDE = 1024;

export class FieldData {
  private image: ImageData | null = null;
  private renders = new Map<string, HTMLCanvasElement>();

  private constructor(src: string) {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, MAX_FIELD_SIDE / Math.max(img.naturalWidth, img.naturalHeight, 1));
      const w = Math.max(1, Math.round(img.naturalWidth * scale));
      const h = Math.max(1, Math.round(img.naturalHeight * scale));
      const c = document.createElement("canvas");
      c.width = w;
      c.height = h;
      const ctx = c.getContext("2d", { willReadFrequently: true });
      if (!ctx) return;
      ctx.drawImage(img, 0, 0, w, h);
      try {
        this.image = ctx.getImageData(0, 0, w, h);
      } catch {
        this.image = null; // tainted or out of memory: no field, no readout
      }
    };
    img.src = src;
  }

  get ready(): boolean {
    return this.image !== null;
  }

  /** Grayscale sample 0..1 at normalized map coords, or null off-map/not ready. */
  sample(u: number, v: number): number | null {
    const im = this.image;
    if (!im || u < 0 || v < 0 || u > 1 || v > 1) return null;
    const x = Math.min(im.width - 1, Math.floor(u * im.width));
    const y = Math.min(im.height - 1, Math.floor(v * im.height));
    const i = (y * im.width + x) * 4;
    // luminance; pure grayscale sources make this exact
    return (im.data[i] * 0.299 + im.data[i + 1] * 0.587 + im.data[i + 2] * 0.114) / 255;
  }

  /** The overlay canvas for a palette+style, built once and cached. */
  rendered(palette: LayerPalette, style: LayerStyle): HTMLCanvasElement | null {
    const im = this.image;
    if (!im) return null;
    const key = `${palette}/${style}`;
    const hit = this.renders.get(key);
    if (hit) return hit;
    const c = document.createElement("canvas");
    c.width = im.width;
    c.height = im.height;
    const ctx = c.getContext("2d");
    if (!ctx) return null;
    const out = ctx.createImageData(im.width, im.height);
    if (style === "hillshade") {
      // gradient lighting from the source heights; palette is ignored
      const g = (x: number, y: number) => {
        const cx = Math.min(im.width - 1, Math.max(0, x));
        const cy = Math.min(im.height - 1, Math.max(0, y));
        const i = (cy * im.width + cx) * 4;
        return (im.data[i] * 0.299 + im.data[i + 1] * 0.587 + im.data[i + 2] * 0.114) / 255;
      };
      for (let y = 0; y < im.height; y++) {
        for (let x = 0; x < im.width; x++) {
          // Steep multiplier: smooth, gently-sloped heightmaps still have to
          // READ as relief — verified against a synthetic island whose
          // per-pixel gradients were nearly invisible at lower gains.
          const gx = (g(x + 1, y) - g(x - 1, y)) * 12;
          const gy = (g(x, y + 1) - g(x, y - 1)) * 12;
          const s = hillshade(gx, gy);
          const i = (y * im.width + x) * 4;
          const lit = s > 0.5;
          const strength = Math.abs(s - 0.5) * 2;
          out.data[i] = lit ? 255 : 4;
          out.data[i + 1] = lit ? 250 : 6;
          out.data[i + 2] = lit ? 240 : 10;
          out.data[i + 3] = Math.round(strength * 190);
        }
      }
    } else {
      const lut = paletteLut(palette, style);
      for (let p = 0; p < im.width * im.height; p++) {
        const i = p * 4;
        const g = Math.round(im.data[i] * 0.299 + im.data[i + 1] * 0.587 + im.data[i + 2] * 0.114);
        out.data[i] = lut[g * 4];
        out.data[i + 1] = lut[g * 4 + 1];
        out.data[i + 2] = lut[g * 4 + 2];
        out.data[i + 3] = lut[g * 4 + 3];
      }
    }
    ctx.putImageData(out, 0, 0);
    this.renders.set(key, c);
    return c;
  }

  // recency-ordered cache, same shape as AtlasArt's
  private static cache = new Map<string, FieldData>();

  static get(src: string): FieldData {
    const hit = FieldData.cache.get(src);
    if (hit) {
      FieldData.cache.delete(src);
      FieldData.cache.set(src, hit);
      return hit;
    }
    const fd = new FieldData(src);
    if (FieldData.cache.size >= 16) {
      const oldest = FieldData.cache.keys().next().value;
      if (oldest !== undefined) FieldData.cache.delete(oldest);
    }
    FieldData.cache.set(src, fd);
    return fd;
  }
}
