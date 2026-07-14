// Light sources: soft radial-gradient glows (additive blend, tinted per light)
// with a pickable handle. The glow texture is generated once from a canvas
// radial gradient — far softer falloff than the old flat circles.
import { Container, Graphics, Sprite, Texture } from "pixi.js";
import type { VttScene } from "../../types/scene";
import type { VttSelection } from "../PixiVttApp";

let glowTex: Texture | null = null;
function glowTexture(): Texture {
  if (glowTex) return glowTex;
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const x = c.getContext("2d")!;
  const grad = x.createRadialGradient(128, 128, 0, 128, 128, 128);
  grad.addColorStop(0, "rgba(255,255,255,0.85)");
  grad.addColorStop(0.35, "rgba(255,255,255,0.4)");
  grad.addColorStop(0.7, "rgba(255,255,255,0.12)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  x.fillStyle = grad;
  x.fillRect(0, 0, 256, 256);
  glowTex = Texture.from(c);
  return glowTex;
}

export class LightingLayer {
  readonly view = new Container();
  private glows = new Container();
  private handles = new Graphics();

  constructor() {
    this.view.addChild(this.glows, this.handles);
  }

  draw(scene: VttScene, selection: VttSelection): void {
    this.handles.clear();
    for (const ch of this.glows.removeChildren()) ch.destroy();
    this.view.visible = scene.data.layers.lights;
    if (!this.view.visible) return;
    const size = scene.data.grid.size;
    for (const l of scene.data.lights) {
      const spr = new Sprite(glowTexture());
      spr.anchor.set(0.5);
      spr.position.set(l.x, l.y);
      const d = l.radius * size * 2.3; // gradient fades before the edge — overshoot for softness
      spr.width = d;
      spr.height = d;
      spr.tint = l.color || "#a08a4f";
      spr.alpha = Math.min(1, (l.intensity ?? 0.5) * 0.95);
      spr.blendMode = "add";
      this.glows.addChild(spr);

      const sel = selection?.kind === "light" && selection.id === l.id;
      this.handles.circle(l.x, l.y, 7).fill({ color: l.color || "#a08a4f", alpha: 0.9 });
      this.handles.circle(l.x, l.y, sel ? 12 : 9).stroke({ width: sel ? 2.5 : 1.5, color: sel ? 0x7ecfca : 0x04070d });
    }
  }

  pick(scene: VttScene, wx: number, wy: number, zoom: number): string | null {
    const tol = 12 / Math.max(zoom, 0.001);
    for (let i = scene.data.lights.length - 1; i >= 0; i--) {
      const l = scene.data.lights[i];
      if ((wx - l.x) ** 2 + (wy - l.y) ** 2 <= tol * tol) return l.id;
    }
    return null;
  }
}
