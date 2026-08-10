// Animated art for the Atlas canvas.
//
// A 2D canvas drawImage of an animated GIF paints the FIRST frame only — the
// browser animates GIFs in <img> elements, not in canvas draws. So GIF sprites
// are decoded once into their frames with WebCodecs' ImageDecoder (present in
// the Chromium WebView2 the app ships in), and the render loop asks for the
// frame that belongs to "now". Anything that can't decode — a static image, an
// old engine, a corrupt file, a GIF past the frame/memory budget — falls back
// to a plain <img>, which draws its first frame and never errors the loop.

/** Which frame is showing `tMs` into the loop? Pure so it can be tested. */
export function pickFrame(durationsMs: number[], tMs: number): number {
  if (durationsMs.length === 0) return 0;
  let total = 0;
  for (const d of durationsMs) total += Math.max(1, d);
  const t = ((tMs % total) + total) % total;
  let acc = 0;
  for (let i = 0; i < durationsMs.length; i++) {
    acc += Math.max(1, durationsMs[i]);
    if (t < acc) return i;
  }
  return durationsMs.length - 1;
}

/** Decode budgets. A GIF is decoded whole up front, so both are hard walls:
 *  past either, the remaining frames are dropped and what decoded plays as a
 *  shorter loop (or the static fallback shows, if nothing decoded). */
const MAX_GIF_FRAMES = 120;
const MAX_GIF_PIXEL_BYTES = 64 * 1024 * 1024; // RGBA accumulation across frames

interface DecodedGif {
  frames: ImageBitmap[];
  durationsMs: number[];
}

/** One drawable art source: static immediately, animated once decoding lands. */
export class AtlasArt {
  private img: HTMLImageElement;
  private gif: DecodedGif | null = null;

  private constructor(src: string) {
    this.img = new Image();
    this.img.src = src;
    if (src.startsWith("data:image/gif")) void this.decodeGif(src);
  }

  /** The frame to draw at `nowMs`, or null while nothing has loaded yet. */
  frame(nowMs: number): CanvasImageSource | null {
    const g = this.gif;
    if (g && g.frames.length > 0) return g.frames[pickFrame(g.durationsMs, nowMs)];
    return this.img.complete && this.img.naturalWidth > 0 ? this.img : null;
  }

  get width(): number {
    const g = this.gif;
    if (g && g.frames.length > 0) return g.frames[0].width;
    return this.img.naturalWidth;
  }

  get height(): number {
    const g = this.gif;
    if (g && g.frames.length > 0) return g.frames[0].height;
    return this.img.naturalHeight;
  }

  /** Release decoded frames. GPU-backed ImageBitmaps do not wait politely for
   *  the garbage collector. */
  private dispose(): void {
    const g = this.gif;
    this.gif = null;
    if (g) for (const f of g.frames) f.close();
  }

  private async decodeGif(src: string): Promise<void> {
    const frames: ImageBitmap[] = [];
    const durationsMs: number[] = [];
    let decoder: ImageDecoder | undefined;
    try {
      const Decoder = (globalThis as { ImageDecoder?: typeof ImageDecoder }).ImageDecoder;
      if (!Decoder) return; // the <img> fallback shows the first frame
      // CSP forbids fetching data: URLs, so the base64 is unpacked by hand.
      const b64 = src.slice(src.indexOf(",") + 1);
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      decoder = new Decoder({ data: bytes, type: "image/gif" });
      await decoder.tracks.ready;
      const count = Math.min(decoder.tracks.selectedTrack?.frameCount ?? 1, MAX_GIF_FRAMES);
      let pixelBytes = 0;
      for (let i = 0; i < count; i++) {
        const { image } = await decoder.decode({ frameIndex: i });
        pixelBytes += image.codedWidth * image.codedHeight * 4;
        if (pixelBytes > MAX_GIF_PIXEL_BYTES) {
          image.close();
          break; // whatever decoded plays as a shorter loop
        }
        frames.push(await createImageBitmap(image));
        // VideoFrame duration is microseconds; browsers report 0 for some GIFs,
        // where the conventional fallback is 100 ms.
        durationsMs.push(image.duration ? image.duration / 1000 : 100);
        image.close();
      }
      if (frames.length > 0) {
        this.gif = { frames, durationsMs };
      }
    } catch {
      // fall back to the static <img>; nothing half-decoded may linger
      for (const f of frames) f.close();
    } finally {
      try {
        decoder?.close();
      } catch {
        // already closed
      }
    }
  }

  // A small cache so every render loop shares one decode per source. Recency-
  // ordered: a hit is re-appended, so eviction takes the least recently drawn
  // art — and eviction CLOSES its frames rather than abandoning them.
  private static cache = new Map<string, AtlasArt>();

  static get(src: string): AtlasArt {
    const hit = AtlasArt.cache.get(src);
    if (hit) {
      AtlasArt.cache.delete(src);
      AtlasArt.cache.set(src, hit);
      return hit;
    }
    const art = new AtlasArt(src);
    if (AtlasArt.cache.size >= 48) {
      const oldest = AtlasArt.cache.keys().next().value;
      if (oldest !== undefined) {
        AtlasArt.cache.get(oldest)?.dispose();
        AtlasArt.cache.delete(oldest);
      }
    }
    AtlasArt.cache.set(src, art);
    return art;
  }
}
