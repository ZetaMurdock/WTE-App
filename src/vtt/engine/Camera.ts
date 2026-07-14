// World-space camera: a translation + zoom applied to the Pixi world container.
import type { Container } from "pixi.js";
import type { VttCameraState } from "../types/scene";

export class Camera {
  x = 0;
  y = 0;
  zoom = 1;
  min = 0.15;
  max = 4;

  constructor(private world: Container) {}

  apply(): void {
    this.world.position.set(this.x, this.y);
    this.world.scale.set(this.zoom);
  }
  set(state: VttCameraState): void {
    this.x = state.x;
    this.y = state.y;
    this.zoom = Math.min(this.max, Math.max(this.min, state.zoom || 1));
    this.apply();
  }
  state(): VttCameraState {
    return { x: this.x, y: this.y, zoom: this.zoom };
  }
  panBy(dx: number, dy: number): void {
    this.x += dx;
    this.y += dy;
    this.apply();
  }
  // ── Momentum: fling on release, glide to a stop with friction ──
  private vx = 0;
  private vy = 0;
  /** Start gliding with the given velocity (px per frame at 60fps). */
  fling(vx: number, vy: number): void {
    this.vx = vx;
    this.vy = vy;
  }
  cancelFling(): void {
    this.vx = 0;
    this.vy = 0;
  }
  get flinging(): boolean {
    return Math.abs(this.vx) > 0.05 || Math.abs(this.vy) > 0.05;
  }
  /** Advance the glide by `frames` (Pixi ticker deltaTime). True while moving. */
  tick(frames: number): boolean {
    if (!this.flinging) return false;
    this.x += this.vx * frames;
    this.y += this.vy * frames;
    const decay = Math.pow(0.92, frames);
    this.vx *= decay;
    this.vy *= decay;
    this.apply();
    return this.flinging;
  }
  /** Zoom keeping the given screen point fixed. */
  zoomAt(sx: number, sy: number, factor: number): void {
    const next = Math.min(this.max, Math.max(this.min, this.zoom * factor));
    const wx = (sx - this.x) / this.zoom;
    const wy = (sy - this.y) / this.zoom;
    this.zoom = next;
    this.x = sx - wx * next;
    this.y = sy - wy * next;
    this.apply();
  }
  screenToWorld(sx: number, sy: number): { x: number; y: number } {
    return { x: (sx - this.x) / this.zoom, y: (sy - this.y) / this.zoom };
  }
}
