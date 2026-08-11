// Shared image helpers. Work in the browser and the Tauri webview alike — no
// native file APIs.

/**
 * Read a user-picked image, KEEPING animated GIFs animated.
 *
 * A GIF cannot pass through the canvas re-encode below without being flattened
 * to its first frame, so GIFs are stored byte-for-byte (their size checked
 * against `maxChars`, since there is no client-side way to shrink one).
 * Everything else takes the PNG re-encode path, which can downscale to fit.
 */
export async function fileToImageDataUrl(file: File, maxSide = 4096, maxChars = Infinity): Promise<string> {
  if (file.type === "image/gif" && (await isReallyGif(file))) {
    const uri = await new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.onerror = () => reject(new Error("read failed"));
      r.readAsDataURL(file);
    });
    if (!uri.startsWith("data:image/")) throw new Error("decode failed");
    if (uri.length > maxChars) {
      throw new Error(`That GIF is too large to share (${Math.ceil(file.size / 1024 / 1024)} MB). GIFs cannot be shrunk on import; export a smaller one.`);
    }
    return uri;
  }
  return fileToPngDataUrl(file, maxSide, maxChars);
}

// file.type comes from the extension, not the bytes. A renamed PNG must take
// the re-encode path, not be stored raw under a false image/gif label.
async function isReallyGif(file: File): Promise<boolean> {
  const head = new Uint8Array(await file.slice(0, 6).arrayBuffer());
  const magic = String.fromCharCode(...head);
  return magic === "GIF87a" || magic === "GIF89a";
}

/**
 * Rasterize an SVG document into an image data URL. Rendered at `maxSide`
 * regardless of the SVG's own size — vectors upscale for free, and a world
 * map deserves the pixels. External resources inside the SVG (web fonts,
 * linked textures) are skipped by the browser's SVG-in-img rules; everything
 * self-contained renders. WebP keeps a map at a fraction of PNG's weight;
 * browsers that can't encode it silently hand back PNG.
 */
export async function svgToImageDataUrl(svg: string, maxSide = 2048): Promise<string> {
  const blob = new Blob([svg], { type: "image/svg+xml" });
  const url = URL.createObjectURL(blob);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error("the map's artwork could not be rendered"));
      i.src = url;
    });
    const w = img.naturalWidth || 1;
    const h = img.naturalHeight || 1;
    const k = maxSide / Math.max(w, h);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(w * k));
    canvas.height = Math.max(1, Math.round(h * k));
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no 2d context");
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/webp", 0.92);
  } finally {
    URL.revokeObjectURL(url);
  }
}

// Re-encode to a PNG data URL via canvas (downscaling only past maxSide, to
// bound stored/synced size).
export async function fileToPngDataUrl(file: File, maxSide = 4096, maxChars = Infinity): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error("decode failed"));
      i.src = url;
    });
    let scale = Math.min(1, maxSide / Math.max(img.width, img.height || 1));
    const canvas = document.createElement("canvas");
    for (let attempt = 0; attempt < 10; attempt++) {
      const w = Math.max(1, Math.round(img.width * scale));
      const h = Math.max(1, Math.round(img.height * scale));
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("no 2d context");
      ctx.drawImage(img, 0, 0, w, h);
      const encoded = canvas.toDataURL("image/png");
      if (encoded.length <= maxChars) return encoded;
      if (w <= 96 && h <= 96) break;
      // PNG size roughly follows pixel count. Use the measured overshoot to
      // converge quickly, with a safety margin for noisy/poorly-compressing art.
      const ratio = Math.sqrt(maxChars / encoded.length) * 0.9;
      scale *= Math.max(0.35, Math.min(0.8, ratio));
    }
    throw new Error("encoded image exceeds the table media budget");
  } finally {
    URL.revokeObjectURL(url);
  }
}
