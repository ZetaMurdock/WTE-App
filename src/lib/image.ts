// Shared image helper: read a user-picked image file and re-encode it to a PNG
// data URL via canvas (downscaling only past maxSide, to bound stored/synced
// size). Works in the browser and the Tauri webview alike — no native file APIs.
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
