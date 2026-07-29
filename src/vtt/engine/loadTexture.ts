// Turning a scene's stored image reference into a texture.
//
// Every map background and every piece of token art in this app arrives as a
// base64 data URL — either stored inline in the scene, or held in the `assets`
// table as a `wte-blob:` row and re-inlined on load (see sceneBlobs.ts). So the
// data-URL path is not an edge case here; it is the only path.
//
// Pixi's Assets.load fetches the URL and builds an ImageBitmap from the response.
// fetch() is governed by the page's connect-src, and this app's CSP deliberately
// does not list `data:` there — img-src does, which is why ordinary <img> tags
// show the same pictures perfectly well. Rather than widen connect-src for every
// request the app makes, images are decoded the way the CSP already permits.
//
// This also removes a second-order dependency on Assets' URL cache, which keyed
// megabyte-long data URLs as cache strings.
import { Assets, Texture } from "pixi.js";

function isInlineSource(src: string): boolean {
  return src.startsWith("data:") || src.startsWith("blob:");
}

/**
 * Load a texture from anything a scene can reference.
 *
 * Rejects rather than resolving to a blank texture — a caller that cannot show
 * the image needs to be able to say so. Silence is what made this invisible.
 */
export async function loadSceneTexture(src: string): Promise<Texture> {
  if (!src) throw new Error("no image source");
  if (!isInlineSource(src)) return (await Assets.load(src)) as Texture;

  const img = new Image();
  img.decoding = "async";
  img.src = src;
  await img.decode();

  // ImageBitmap is what Pixi's own loader produces, so it is the best-supported
  // resource for a texture source. Falling back to the element itself keeps this
  // working anywhere createImageBitmap is missing.
  if (typeof createImageBitmap === "function") {
    try {
      return Texture.from(await createImageBitmap(img));
    } catch {
      /* fall through to the element */
    }
  }
  return Texture.from(img);
}

/** A short, human-readable description of an image source, for error messages.
 *  Never the whole data URL — that is megabytes of base64. */
export function describeSource(src: string): string {
  if (!src) return "(none)";
  if (src.startsWith("data:")) return `${src.slice(0, src.indexOf(",") + 1 || 32)}… (${src.length} chars)`;
  return src.length > 120 ? src.slice(0, 120) + "…" : src;
}
