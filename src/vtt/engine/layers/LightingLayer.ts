// Light sources: soft radial-gradient glows (additive blend, tinted per light)
// with a pickable handle. The glow texture is generated once from a canvas
// radial gradient — far softer falloff than the old flat circles.
import { Container, Graphics, Sprite, Texture } from "pixi.js";
import type { VttScene } from "../../types/scene";
import type { VttSelection } from "../PixiVttApp";
import { lightVisibleTo } from "../systems/VisionSystem";
import { burnMechanicOn, isDirectional, lightFactor, lightRadiusScale } from "../systems/lightState";

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

  draw(scene: VttScene, selection: VttSelection, viewerId?: string): void {
    this.handles.clear();
    for (const ch of this.glows.removeChildren()) ch.destroy();
    this.view.visible = scene.data.layers.lights;
    if (!this.view.visible) return;
    const size = scene.data.grid.size;
    const realistic = scene.data.fog.enabled && burnMechanicOn(scene.data.fog);
    const now = Date.now();
    for (const l of scene.data.lights) {
      // Players don't see a light AT ALL (glow or handle) until they have a
      // visual on it — no free map knowledge from off-screen torches.
      if (viewerId && scene.data.fog.enabled && !lightVisibleTo(scene.data, l, viewerId)) continue;
      const f = lightFactor(l, realistic, now);
      if (f > 0) {
        const spr = new Sprite(glowTexture());
        spr.anchor.set(0.5);
        spr.position.set(l.x, l.y);
        // gradient fades before the edge — overshoot for softness; burn-down shrinks it
        const d = l.radius * size * 2.3 * lightRadiusScale(f);
        spr.width = d;
        spr.height = d;
        spr.tint = l.color || "#a08a4f";
        spr.alpha = Math.min(1, (l.intensity ?? 0.5) * 0.95) * (realistic ? 0.25 + 0.75 * f : 1);
        spr.blendMode = "add";
        this.glows.addChild(spr);
        // Directional lights are clipped to their cone — a pie mask over the
        // radial glow keeps the soft falloff but points it somewhere.
        if (isDirectional(l)) {
          const half = ((l.cone as number) * Math.PI) / 180 / 2;
          const reach = d; // cover the whole glow sprite
          const pie = new Graphics();
          pie.moveTo(l.x, l.y);
          pie.arc(l.x, l.y, reach, (l.dir as number) - half, (l.dir as number) + half);
          pie.closePath();
          pie.fill({ color: 0xffffff });
          this.glows.addChild(pie);
          spr.mask = pie;
        }
      }

      const cold = realistic && f <= 0;
      if (!viewerId) {
        // Curator: editing handles for every light; cold lanterns read dim grey.
        const sel = selection?.kind === "light" && selection.id === l.id;
        this.handles.circle(l.x, l.y, 7).fill({ color: cold ? 0x39424f : l.color || "#a08a4f", alpha: cold ? 0.7 : 0.9 });
        this.handles.circle(l.x, l.y, sel ? 12 : 9).stroke({ width: sel ? 2.5 : 1.5, color: sel ? 0x7ecfca : 0x04070d });
      } else if (cold) {
        // Player: light SOURCE points stay invisible — except a cold lantern
        // right next to their own token, which prompts with a soft beacon so
        // they know something here can be lit (click anywhere in it).
        const near = scene.data.tokens.some(
          (t) => t.owner === viewerId && t.visible !== false && Math.hypot(t.x - l.x, t.y - l.y) < size * 2.5
        );
        if (near) {
          const pulse = 0.5 + 0.5 * Math.sin(now / 280);
          this.handles.circle(l.x, l.y, size * (0.22 + 0.1 * pulse)).stroke({ width: 2.5, color: 0x9fb9d0, alpha: 0.35 + 0.35 * pulse });
          this.handles.circle(l.x, l.y, size * 0.06).fill({ color: 0x9fb9d0, alpha: 0.8 });
        }
      }
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

  /** Nearest light within a WORLD-space radius — players lighting a lantern
   *  click the beacon area, not a pixel-perfect point. */
  pickNear(scene: VttScene, wx: number, wy: number, worldTol: number): string | null {
    let best: string | null = null;
    let bestD = worldTol;
    for (const l of scene.data.lights) {
      const d = Math.hypot(wx - l.x, wy - l.y);
      if (d < bestD) {
        bestD = d;
        best = l.id;
      }
    }
    return best;
  }
}
