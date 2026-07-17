// Pointer + wheel input → tool behavior. Left-drag acts per tool; middle/right
// drag always pans; wheel zooms at the cursor.
import type { PixiVttApp } from "./PixiVttApp";
import { lightVisibleTo } from "./systems/VisionSystem";

type DragMode = "none" | "pan" | "token" | "measure" | "wall" | "rotate" | "scale" | "zone" | "draw";

export class InputController {
  private canvas: HTMLCanvasElement | null = null;
  private mode: DragMode = "none";
  private dragTokenId: string | null = null;
  private dragFrom = { x: 0, y: 0 }; // token position at drag start (collision revert)
  private last = { x: 0, y: 0 };
  private start = { x: 0, y: 0 }; // world coords for measure
  private moved = false;
  // pan velocity (EMA of pointer deltas) for the momentum fling on release
  private vel = { x: 0, y: 0 };

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
    v.camera.cancelFling(); // grabbing the map arrests any glide
    this.vel = { x: 0, y: 0 };
    const s = this.pos(e);
    this.last = s;
    this.moved = false;
    const w = v.camera.screenToWorld(s.x, s.y);

    if (e.button === 1 || e.button === 2 || v.tool === "pan") {
      this.mode = "pan";
      return;
    }
    // Scene-BUILDER tools are Curator-only. The action bar hides them from
    // players; this guard is the belt to that suspender.
    if (v.playerView && (v.tool === "token" || v.tool === "wall" || v.tool === "light" || v.tool === "effect" || v.tool === "zone")) {
      this.mode = "none";
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
    if (v.tool === "zone") {
      this.mode = "zone";
      v.paintZoneAt(w.x, w.y); // paint the cell under the press; drag keeps painting
      return;
    }
    if (v.tool === "draw") {
      if (!v.canDraw()) {
        this.mode = "none";
        return; // Curator turned player drawing off
      }
      this.mode = "draw";
      v.beginDraw(w.x, w.y);
      return;
    }
    // transform handles on the already-selected token take priority
    if (v.selection?.kind === "token") {
      const h = v.tokens.pickHandle(v.scene, v.selection.id, w.x, w.y, v.camera.zoom);
      if (h) {
        this.mode = h;
        this.dragTokenId = v.selection.id;
        return;
      }
    }
    // select — tokens first, then lights, then walls
    const hit = v.tokens.pick(v.scene, w.x, w.y);
    if (hit) {
      v.select({ kind: "token", id: hit.id });
      this.mode = "token";
      this.dragTokenId = hit.id;
      this.dragFrom = { x: hit.x, y: hit.y };
      return;
    }
    if (v.playerView) {
      // Players never SELECT lights or walls (they can't even see the points).
      // Realistic fog: a click anywhere near a lantern they can see (re)lights
      // it — the pulsing beacon marks the area, no pixel-hunting required.
      if (v.scene.data.fog.mode === "realistic") {
        const near = v.lights.pickNear(v.scene, w.x, w.y, v.scene.data.grid.size * 0.9);
        if (near) {
          const l = v.scene.data.lights.find((x) => x.id === near);
          if (l && lightVisibleTo(v.scene.data, l, v.selfId ?? undefined)) {
            v.igniteLight(near);
            this.mode = "none";
            return;
          }
        }
      }
      // players can still grab AoE effects (aiming their own placed hitboxes)
      const pfx = v.effects.pick(v.scene, w.x, w.y, v.camera.zoom);
      if (pfx) {
        v.select({ kind: "effect", id: pfx });
        this.mode = "none";
        return;
      }
      v.select(null);
      this.mode = "pan"; // drag empty space to pan, same as the Curator
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

    if (this.mode === "pan") {
      v.camera.panBy(dx, dy);
      this.vel = { x: 0.75 * this.vel.x + 0.25 * dx, y: 0.75 * this.vel.y + 0.25 * dy };
    }
    else if (this.mode === "token" && this.dragTokenId) v.moveToken(this.dragTokenId, w.x, w.y, false);
    else if ((this.mode === "rotate" || this.mode === "scale") && this.dragTokenId) {
      const t = v.scene.data.tokens.find((x) => x.id === this.dragTokenId);
      if (t) {
        if (this.mode === "rotate") {
          const deg = (Math.atan2(w.y - t.y, w.x - t.x) * 180) / Math.PI + 90;
          t.rotation = Math.round(((deg % 360) + 360) % 360);
        } else {
          const dist = Math.hypot(w.x - t.x, w.y - t.y);
          t.size = Math.max(1, Math.min(6, Math.round((dist * 2) / v.scene.data.grid.size)));
        }
        v.redraw();
      }
    }
    else if (this.mode === "measure") v.measure.show(this.start.x, this.start.y, w.x, w.y, v.scene.data.grid.size);
    else if (this.mode === "zone") v.paintZoneAt(w.x, w.y); // brush-drag painting
    else if (this.mode === "draw") v.extendDraw(w.x, w.y);
    else if (this.mode === "wall") {
      const p = v.snapVertex(w.x, w.y);
      v.walls.preview(this.start.x, this.start.y, p.x, p.y);
    }
  };

  private onUp = (): void => {
    const v = this.vtt;
    if (this.mode === "draw") v.endDraw(); // commit + sync the stroke
    if (this.mode === "token" && this.dragTokenId && this.moved) {
      const t = v.scene?.data.tokens.find((x) => x.id === this.dragTokenId);
      if (t) {
        // COLLISION: players can't drag through walls — a drop whose straight
        // path from the pick-up point crosses a wall reverts to the origin.
        // The Curator's drag stays free (GM repositioning tool).
        if (v.playerView && v.moveBlocked(this.dragFrom.x, this.dragFrom.y, t.x, t.y)) {
          v.moveToken(this.dragTokenId, this.dragFrom.x, this.dragFrom.y, true);
        } else {
          v.moveToken(this.dragTokenId, t.x, t.y, true); // snap on drop
          // FACING follows movement — directional vision looks where you walked.
          const fdx = t.x - this.dragFrom.x;
          const fdy = t.y - this.dragFrom.y;
          if (Math.hypot(fdx, fdy) > 2) v.updateToken(this.dragTokenId, { facing: Math.atan2(fdy, fdx) });
        }
        v.onChanged();
      }
    }
    if ((this.mode === "rotate" || this.mode === "scale") && this.dragTokenId && this.moved) {
      const t = v.scene?.data.tokens.find((x) => x.id === this.dragTokenId);
      if (t) v.updateToken(t.id, this.mode === "rotate" ? { rotation: t.rotation } : { size: t.size }); // one op + persist on release
    }
    if (this.mode === "pan" && this.moved) {
      // fling: keep gliding if the pointer was moving on release (persist on stop)
      if (Math.hypot(this.vel.x, this.vel.y) > 2) v.camera.fling(this.vel.x, this.vel.y);
      else v.persistCamera();
    }
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
