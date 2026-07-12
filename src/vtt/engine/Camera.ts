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
