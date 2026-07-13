// Pointer + wheel input → tool behavior. Left-drag acts per tool; middle/right
// drag always pans; wheel zooms at the cursor.
import type { PixiVttApp } from "./PixiVttApp";

type DragMode = "none" | "pan" | "token" | "measure" | "wall";

export class InputController {
  private canvas: HTMLCanvasElement | null = null;
  private mode: DragMode = "none";
  private dragTokenId: string | null = null;
  private last = { x: 0, y: 0 };
  private start = { x: 0, y: 0 }; // world coords for measure
  private moved = false;

  constructor(private vtt: PixiVttApp) {}

  attach(canvas: HTMLCanvasElement): void {
    this.canvas = canvas;
    canvas.addEventListener("pointerdown", this.onDown);
    canvas.addEventListener("pointermove", this.onMove);
    window.addEventListener("pointerup", this.onUp);
    canvas.addEventListener("wheel", this.onWheel, { passive: false });
    canvas.addEventListener("contextmenu", (e) => e.preventDefault());
  }
  detach(): void {
    const c = this.canvas;
    if (!c) return;
    c.removeEventListener("pointerdown", this.onDown);
    c.removeEventListener("pointermove", this.onMove);
    window.removeEventListener("pointerup", this.onUp);
    c.removeEventListener("wheel", this.onWheel);
  }

  private pos(e: PointerEvent | WheelEvent): { x: number; y: number } {
    const r = this.canvas!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private onDown = (e: PointerEvent): void => {
    const v = this.vtt;
    if (!v.scene) return;
    const s = this.pos(e);
    this.last = s;
    this.moved = false;
    const w = v.camera.screenToWorld(s.x, s.y);

    if (e.button === 1 || e.button === 2 || v.tool === "pan") {
      this.mode = "pan";
      return;
    }
    if (v.tool === "token") {
      v.addTokenAt(w.x, w.y);
      this.mode = "none";
      return;
    }
    if (v.tool === "light") {
      v.addLightAt(w.x, w.y);
      this.mode = "none";
      return;
    }
    if (v.tool === "effect") {
      v.addEffectAt("circle", w.x, w.y);
      this.mode = "none";
      return;
    }
    if (v.tool === "wall") {
      this.mode = "wall";
      this.start = v.snapVertex(w.x, w.y);
      v.walls.preview(this.start.x, this.start.y, this.start.x, this.start.y);
      return;
    }
    if (v.tool === "measure") {
      this.mode = "measure";
      this.start = w;
      v.measure.show(w.x, w.y, w.x, w.y, v.scene.data.grid.size);
      return;
    }
    // select — tokens first, then lights, then walls
    const hit = v.tokens.pick(v.scene, w.x, w.y);
    if (hit) {
      v.select({ kind: "token", id: hit.id });
      this.mode = "token";
      this.dragTokenId = hit.id;
      return;
    }
    const light = v.lights.pick(v.scene, w.x, w.y, v.camera.zoom);
    if (light) {
      v.select({ kind: "light", id: light });
      this.mode = "none";
      return;
    }
    const wall = v.walls.pick(v.scene, w.x, w.y, v.camera.zoom);
    if (wall) {
      v.select({ kind: "wall", id: wall });
      this.mode = "none";
      return;
    }
    const fx = v.effects.pick(v.scene, w.x, w.y, v.camera.zoom);
    if (fx) {
      v.select({ kind: "effect", id: fx });
      this.mode = "none";
      return;
    }
    v.select(null);
    this.mode = "pan"; // drag empty space to pan even in select
  };

  private onMove = (e: PointerEvent): void => {
    const v = this.vtt;
    if (this.mode === "none" || !v.scene) return;
    const s = this.pos(e);
    const dx = s.x - this.last.x;
    const dy = s.y - this.last.y;
    if (Math.abs(dx) + Math.abs(dy) > 0) this.moved = true;
    this.last = s;
    const w = v.camera.screenToWorld(s.x, s.y);

    if (this.mode === "pan") v.camera.panBy(dx, dy);
    else if (this.mode === "token" && this.dragTokenId) v.moveToken(this.dragTokenId, w.x, w.y, false);
    else if (this.mode === "measure") v.measure.show(this.start.x, this.start.y, w.x, w.y, v.scene.data.grid.size);
    else if (this.mode === "wall") {
      const p = v.snapVertex(w.x, w.y);
      v.walls.preview(this.start.x, this.start.y, p.x, p.y);
    }
  };

  private onUp = (): void => {
    const v = this.vtt;
    if (this.mode === "token" && this.dragTokenId && this.moved) {
      const t = v.scene?.data.tokens.find((x) => x.id === this.dragTokenId);
      if (t) {
        v.moveToken(this.dragTokenId, t.x, t.y, true); // snap on drop
        v.onChanged();
      }
    }
    if (this.mode === "pan" && this.moved) v.persistCamera();
    if (this.mode === "measure") window.setTimeout(() => v.measure.clear(), 900);
    if (this.mode === "wall") {
      v.walls.clearPreview();
      if (this.moved && v.scene) {
        const p = v.snapVertex(
          v.camera.screenToWorld(this.last.x, this.last.y).x,
          v.camera.screenToWorld(this.last.x, this.last.y).y
        );
        v.addWall(this.start.x, this.start.y, p.x, p.y);
      }
    }
    this.mode = "none";
    this.dragTokenId = null;
  };

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    const s = this.pos(e);
    this.vtt.camera.zoomAt(s.x, s.y, e.deltaY < 0 ? 1.12 : 1 / 1.12);
    this.vtt.persistCamera();
  };
}
