// World-space camera: a translation + zoom applied to the Pixi world container.
import type { Container } from "pixi.js";
import type { VttCameraState } from "../types/scene";

/** Follow stiffness — higher snaps tighter, lower drifts more cinematically. */
const CAM_FOLLOW_DAMP = 9;

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
    this.cancelFollow(); // hard state load — don't glide toward a stale target
    this.x = state.x;
    this.y = state.y;
    this.zoom = Math.min(this.max, Math.max(this.min, state.zoom || 1));
    this.apply();
  }
  state(): VttCameraState {
    return { x: this.x, y: this.y, zoom: this.zoom };
  }
  panBy(dx: number, dy: number): void {
    this.cancelFollow(); // dragging by hand wins over any follow target
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

  // ── Smooth follow: a camera LOCKED to something (your token while piloting, a
  // cinematic subject) glides to it instead of teleporting. Tokens move in whole
  // grid steps, so snapping the view every step is what made piloting feel jerky.
  private tx: number | null = null;
  private ty: number | null = null;
  /** Ease toward this translation (call every frame; cheap when unchanged). */
  followTo(x: number, y: number): void {
    this.tx = x;
    this.ty = y;
  }
  /** Jump there now and drop any in-flight easing (scene loads, teleports). */
  snapTo(x: number, y: number): void {
    this.tx = null;
    this.ty = null;
    this.x = x;
    this.y = y;
    this.apply();
  }
  cancelFollow(): void {
    this.tx = null;
    this.ty = null;
  }
  get following(): boolean {
    return this.tx != null && this.ty != null;
  }

  /** Advance the glide + follow by `frames` (Pixi ticker deltaTime). True while moving. */
  tick(frames: number): boolean {
    let moved = false;
    if (this.flinging) {
      this.x += this.vx * frames;
      this.y += this.vy * frames;
      const decay = Math.pow(0.92, frames);
      this.vx *= decay;
      this.vy *= decay;
      moved = true;
    }
    if (this.tx != null && this.ty != null) {
      // frame-rate independent damping: same feel at 60Hz, 144Hz, or mid-stutter
      const dt = Math.min(0.05, frames / 60);
      const k = 1 - Math.exp(-CAM_FOLLOW_DAMP * dt);
      const dx = this.tx - this.x;
      const dy = this.ty - this.y;
      if (Math.abs(dx) < 0.25 && Math.abs(dy) < 0.25) {
        this.x = this.tx;
        this.y = this.ty;
      } else {
        this.x += dx * k;
        this.y += dy * k;
        moved = true;
      }
    }
    if (moved || this.following) this.apply();
    return moved;
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
