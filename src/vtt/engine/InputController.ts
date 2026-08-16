// Pointer, touch, and wheel input -> tool behavior. Left/one-finger drag acts
// per tool; middle/right drag pans; two fingers pan + pinch; wheel zooms at the
// cursor. Pointer Events keep mouse, pen, and touch on one cancellation-safe
// path without also listening for synthetic compatibility mouse events.
import type { PixiVttApp } from "./PixiVttApp";
import { lightVisibleTo } from "./systems/VisionSystem";
import { burnMechanicOn } from "./systems/lightState";

type DragMode = "none" | "pan" | "token" | "measure" | "wall" | "rotate" | "scale" | "zone" | "draw";
type Point = { x: number; y: number };
type Pinch = { ids: [number, number]; center: Point; distance: number };

const TAP_SLOP = 10;
const DOUBLE_TAP_MS = 360;
const DOUBLE_TAP_DISTANCE = 28;
const SYNTHETIC_MOUSE_GUARD_MS = 900;

export class InputController {
  private canvas: HTMLCanvasElement | null = null;
  private previousTouchAction = "";
  private mode: DragMode = "none";
  private dragTokenId: string | null = null;
  private dragFrom = { x: 0, y: 0 }; // token position at drag start (collision revert)
  private transformFrom: { rotation?: number; size?: number } = {};
  private last = { x: 0, y: 0 };
  private start = { x: 0, y: 0 }; // world coords for measure
  private moved = false;
  // pan velocity (EMA of pointer deltas) for the momentum fling on release
  private vel = { x: 0, y: 0 };

  private activePointerId: number | null = null;
  private touches = new Map<number, Point>();
  private pinch: Pinch | null = null;
  /** After a pinch ends with one finger still down, ignore that finger until it
   * lifts. Otherwise it could accidentally begin/finish the selected tool. */
  private waitForAllTouchesUp = false;
  private touchCameraMoved = false;
  private touchStart: Point | null = null;
  private touchTapMoved = false;
  /** Tap-only mutations wait for touch-up so finger one of a pinch cannot place
   * a token/light/effect (or paint a zone) before finger two arrives. */
  private pendingTouchTap: (() => void) | null = null;
  private lastTouchAt = 0;
  private lastTap: ({ at: number } & Point) | null = null;
  private lastTouchClient: Point | null = null;
  private touchSelectionBefore: PixiVttApp["selection"] = null;

  constructor(private vtt: PixiVttApp) {}

  attach(canvas: HTMLCanvasElement): void {
    this.canvas = canvas;
    this.previousTouchAction = canvas.style.touchAction;
    // Stops page scroll, pull-to-refresh, and browser pinch zoom while a finger
    // is manipulating the table. The listeners also preventDefault for engines
    // that only partially honour touch-action on a dynamically-added canvas.
    canvas.style.touchAction = "none";
    canvas.addEventListener("pointerdown", this.onDown);
    canvas.addEventListener("pointermove", this.onMove, { passive: false });
    window.addEventListener("pointerup", this.onUp, { passive: false });
    window.addEventListener("pointercancel", this.onCancel, { passive: false });
    canvas.addEventListener("lostpointercapture", this.onLostPointerCapture);
    window.addEventListener("blur", this.onWindowBlur);
    canvas.addEventListener("wheel", this.onWheel, { passive: false });
    canvas.addEventListener("dblclick", this.onDblClick);
    canvas.addEventListener("contextmenu", this.onContextMenu);
  }

  detach(): void {
    const c = this.canvas;
    if (!c) return;
    this.abortInteraction();
    this.releaseAllTouches();
    if (this.activePointerId != null) this.release(this.activePointerId);
    c.removeEventListener("pointerdown", this.onDown);
    c.removeEventListener("pointermove", this.onMove);
    window.removeEventListener("pointerup", this.onUp);
    window.removeEventListener("pointercancel", this.onCancel);
    c.removeEventListener("lostpointercapture", this.onLostPointerCapture);
    window.removeEventListener("blur", this.onWindowBlur);
    c.removeEventListener("wheel", this.onWheel);
    c.removeEventListener("dblclick", this.onDblClick);
    c.removeEventListener("contextmenu", this.onContextMenu);
    c.style.touchAction = this.previousTouchAction;
    this.canvas = null;
  }

  private pos(e: Pick<PointerEvent | WheelEvent, "clientX" | "clientY">): Point {
    const r = this.canvas!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private capture(id: number): void {
    try {
      this.canvas?.setPointerCapture?.(id);
    } catch {
      // Capture can throw if the pointer ended between dispatch and this call.
    }
  }

  private release(id: number): void {
    try {
      if (this.canvas?.hasPointerCapture?.(id)) this.canvas.releasePointerCapture(id);
    } catch {
      // A browser may already have released capture on up/cancel.
    }
  }

  private preventTouchDefault(e: PointerEvent): void {
    this.lastTouchAt = Date.now();
    this.lastTouchClient = { x: e.clientX, y: e.clientY };
    if (e.cancelable) e.preventDefault();
  }

  private recentTouch(): boolean {
    return Date.now() - this.lastTouchAt < SYNTHETIC_MOUSE_GUARD_MS;
  }

  private onDown = (e: PointerEvent): void => {
    if (e.pointerType === "touch") {
      this.preventTouchDefault(e);
      if (!this.vtt.scene) return;
      const s = this.pos(e);
      this.touches.set(e.pointerId, s);
      this.capture(e.pointerId);

      if (this.touches.size >= 2) {
        if (!this.pinch) {
          // Finger two always owns the canvas. Roll back every preview started
          // by finger one and discard deferred one-shot mutations.
          if (this.mode === "pan" && this.moved) this.touchCameraMoved = true;
          this.abortInteraction();
          this.restoreTouchSelection();
          this.activePointerId = null;
          this.pendingTouchTap = null;
          this.lastTap = null;
          this.beginPinch();
        }
        return;
      }

      if (this.waitForAllTouchesUp) return;
      this.activePointerId = e.pointerId;
      this.touchStart = s;
      this.touchTapMoved = false;
      this.touchCameraMoved = false;
      this.touchSelectionBefore = this.vtt.selection ? { ...this.vtt.selection } : null;
      this.beginInteraction(e, s, true);
      return;
    }

    // Compatibility mouse events are not subscribed here; Pointer Events plus
    // preventDefault avoid duplicate touch actions while a real mouse remains
    // immediately usable on hybrid laptops.
    if (this.activePointerId != null || this.pinch) return;
    if (!this.vtt.scene) return;
    this.activePointerId = e.pointerId;
    this.capture(e.pointerId);
    this.beginInteraction(e, this.pos(e), false);
  };

  private beginInteraction(e: PointerEvent, s: Point, touch: boolean): void {
    const v = this.vtt;
    if (!v.scene) return;
    v.camera.cancelFling(); // grabbing the map arrests any glide
    this.vel = { x: 0, y: 0 };
    this.last = s;
    this.moved = false;
    this.pendingTouchTap = null;
    const w = v.camera.screenToWorld(s.x, s.y);

    if (e.button === 1 || e.button === 2 || v.tool === "pan") {
      // Play mode: players don't drive the camera - it walks with their token.
      this.mode = v.playLocked() ? "none" : "pan";
      return;
    }
    // Scene-BUILDER tools are Curator-only. The action bar hides them from
    // players; this guard is the belt to that suspender.
    if (v.playerView && (v.tool === "token" || v.tool === "wall" || v.tool === "light" || v.tool === "effect" || v.tool === "zone")) {
      this.mode = "none";
      return;
    }
    if (v.tool === "token") {
      if (touch) this.pendingTouchTap = () => v.addTokenAt(w.x, w.y);
      else v.addTokenAt(w.x, w.y);
      this.mode = "none";
      return;
    }
    if (v.tool === "light") {
      if (touch) this.pendingTouchTap = () => v.addLightAt(w.x, w.y);
      else v.addLightAt(w.x, w.y);
      this.mode = "none";
      return;
    }
    if (v.tool === "effect") {
      if (touch) this.pendingTouchTap = () => v.addEffectAt("circle", w.x, w.y);
      else v.addEffectAt("circle", w.x, w.y);
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
      if (touch) this.pendingTouchTap = () => v.paintZoneAt(w.x, w.y);
      else v.paintZoneAt(w.x, w.y);
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
      const h = v.tokens.pickHandle(v.scene, v.selection.id, w.x, w.y, v.camera.zoom, touch ? 24 : 14);
      if (h && v.canControlToken(v.selection.id)) {
        this.mode = h;
        this.dragTokenId = v.selection.id;
        const token = v.scene.data.tokens.find((candidate) => candidate.id === v.selection!.id);
        this.transformFrom = { rotation: token?.rotation, size: token?.size };
        return;
      }
    }
    // select - tokens first, then lights, then walls. Props are Curator
    // scenery: a player's click passes straight through them (no select, no
    // drag), so the map furniture can't be rearranged by the party.
    const hit = v.tokens.pick(v.scene, w.x, w.y, () => true, !v.playerView);
    if (hit && !(v.playerView && hit.prop)) {
      v.select({ kind: "token", id: hit.id });
      if (v.canControlToken(hit.id)) {
        this.mode = "token";
        this.dragTokenId = hit.id;
        this.dragFrom = { x: hit.x, y: hit.y };
      } else {
        this.mode = "none";
      }
      return;
    }
    if (v.playerView) {
      // Players never SELECT lights or walls (they can't even see the points).
      // Realistic fog: a tap anywhere near a lantern they can see (re)lights
      // it; defer touch ignition so a pinch cannot accidentally trigger it.
      if (burnMechanicOn(v.scene.data.fog)) {
        const near = v.lights.pickNear(v.scene, w.x, w.y, v.scene.data.grid.size * 0.9);
        if (near) {
          const l = v.scene.data.lights.find((x) => x.id === near);
          if (l && lightVisibleTo(v.scene.data, l, v.selfId ?? undefined)) {
            if (touch) this.pendingTouchTap = () => v.igniteLight(near);
            else v.igniteLight(near);
            this.mode = "none";
            return;
          }
        }
      }
      // players can still grab AoE effects (aiming their own placed hitboxes)
      const pfx = v.effects.pick(v.scene, w.x, w.y, v.camera.zoom, touch ? 22 : 12);
      if (pfx) {
        v.select({ kind: "effect", id: pfx });
        this.mode = "none";
        return;
      }
      v.select(null);
      this.mode = v.playLocked() ? "none" : "pan"; // drag empty space to pan, same as the Curator
      return;
    }
    const light = v.lights.pick(v.scene, w.x, w.y, v.camera.zoom, touch ? 22 : 12);
    if (light) {
      v.select({ kind: "light", id: light });
      this.mode = "none";
      return;
    }
    const emitter = v.emitters.pick(v.scene, w.x, w.y, v.camera.zoom, touch ? 22 : 14);
    if (emitter) {
      v.select({ kind: "emitter", id: emitter });
      this.mode = "none";
      return;
    }
    const wall = v.walls.pick(v.scene, w.x, w.y, v.camera.zoom, touch ? 22 : 12);
    if (wall) {
      v.select({ kind: "wall", id: wall });
      this.mode = "none";
      return;
    }
    const fx = v.effects.pick(v.scene, w.x, w.y, v.camera.zoom, touch ? 22 : 12);
    if (fx) {
      v.select({ kind: "effect", id: fx });
      this.mode = "none";
      return;
    }
    v.select(null);
    this.mode = "pan"; // drag empty space to pan even in select
  }

  private onMove = (e: PointerEvent): void => {
    if (e.pointerType === "touch") {
      this.preventTouchDefault(e);
      if (!this.touches.has(e.pointerId)) return;
      const s = this.pos(e);
      this.touches.set(e.pointerId, s);
      if (this.pinch) {
        this.movePinch();
        return;
      }
      if (this.waitForAllTouchesUp || e.pointerId !== this.activePointerId) return;
      if (!this.touchTapMoved) {
        if (!this.touchStart || Math.hypot(s.x - this.touchStart.x, s.y - this.touchStart.y) <= TAP_SLOP) return;
        this.touchTapMoved = true;
        // Tap-only placement tools are cancelled by a drag. Zone is different:
        // its drag means paint, so lay down the deferred first cell now.
        if (this.pendingTouchTap && this.mode === "zone") {
          this.pendingTouchTap();
          this.pendingTouchTap = null;
        } else if (this.pendingTouchTap) {
          this.pendingTouchTap = null;
        }
      }
      this.moveInteraction(s);
      return;
    }

    if (e.pointerId !== this.activePointerId) return;
    this.moveInteraction(this.pos(e));
  };

  private moveInteraction(s: Point): void {
    const v = this.vtt;
    if (this.mode === "none" || !v.scene) return;
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
  }

  private beginPinch(): void {
    const ids = [...this.touches.keys()].slice(0, 2) as [number, number];
    const a = this.touches.get(ids[0]);
    const b = this.touches.get(ids[1]);
    if (!a || !b) return;
    this.vtt.camera.cancelFling();
    this.pinch = { ids, center: midpoint(a, b), distance: Math.max(8, distance(a, b)) };
  }

  private movePinch(): void {
    const pinch = this.pinch;
    if (!pinch) return;
    const a = this.touches.get(pinch.ids[0]);
    const b = this.touches.get(pinch.ids[1]);
    if (!a || !b) return;
    const center = midpoint(a, b);
    const nextDistance = Math.max(8, distance(a, b));
    const rawFactor = nextDistance / pinch.distance;
    // Camera.zoomAt applies the scene's min/max limits; retaining the full
    // distance ratio keeps a fast/coalesced pinch mathematically accurate.
    const factor = Number.isFinite(rawFactor) && rawFactor > 0 ? rawFactor : 1;
    const dx = center.x - pinch.center.x;
    const dy = center.y - pinch.center.y;
    if (Math.abs(dx) + Math.abs(dy) > 0.01 || Math.abs(factor - 1) > 0.001) {
      this.touchCameraMoved = true;
    }

    if (Math.abs(factor - 1) > 0.0001) this.vtt.camera.zoomAt(pinch.center.x, pinch.center.y, factor);
    if (this.vtt.playLocked()) {
      // Same restriction as mouse panning/wheel zoom in Play mode: zoom works,
      // but the camera remains centred on the player's body.
      this.vtt.followOwnToken();
    } else if (dx || dy) {
      this.vtt.camera.panBy(dx, dy);
    }
    pinch.center = center;
    pinch.distance = nextDistance;
  }

  private onUp = (e: PointerEvent): void => {
    if (e.pointerType === "touch") {
      this.preventTouchDefault(e);
      if (!this.touches.has(e.pointerId)) return;
      const pinchBeforeUp = this.pinch;
      this.touches.delete(e.pointerId);
      this.release(e.pointerId);

      if (pinchBeforeUp) {
        // A third resting finger is not part of the current gesture and must not
        // terminate/rebase it or cause an early persistence write.
        if (!pinchBeforeUp.ids.includes(e.pointerId)) return;
        if (this.touches.size >= 2) this.beginPinch();
        else {
          if (this.touchCameraMoved) this.vtt.persistCamera();
          this.pinch = null;
          this.waitForAllTouchesUp = this.touches.size > 0;
          this.activePointerId = null;
          if (!this.touches.size) this.resetTouchSequence();
        }
        return;
      }

      if (e.pointerId !== this.activePointerId) {
        if (!this.touches.size) this.resetTouchSequence();
        return;
      }
      const point = this.pos(e);
      const qualifiesAsTap = !this.touchTapMoved;
      const tapAction = qualifiesAsTap ? this.pendingTouchTap : null;
      this.pendingTouchTap = null;
      this.finishInteraction();
      tapAction?.();
      if (tapAction) this.lastTap = null;
      else if (qualifiesAsTap) this.noteTouchTap(point);
      this.activePointerId = null;
      if (!this.touches.size) this.resetTouchSequence(false);
      return;
    }

    if (e.pointerId !== this.activePointerId) return;
    this.finishInteraction();
    this.activePointerId = null;
    this.release(e.pointerId);
  };

  private finishInteraction(): void {
    const v = this.vtt;
    if (this.mode === "draw") v.endDraw(); // commit + sync the stroke
    if (this.mode === "token" && this.dragTokenId && this.moved) {
      const target = v.tokens.displayPosition(this.dragTokenId);
      if (target) v.requestTokenMove(this.dragTokenId, this.dragFrom.x, this.dragFrom.y, target.x, target.y);
    }
    if ((this.mode === "rotate" || this.mode === "scale") && this.dragTokenId && this.moved) {
      const t = v.scene?.data.tokens.find((x) => x.id === this.dragTokenId);
      if (t) {
        const requested = this.mode === "rotate" ? { rotation: t.rotation } : { size: t.size };
        if (this.mode === "rotate") t.rotation = this.transformFrom.rotation;
        else if (this.transformFrom.size != null) t.size = this.transformFrom.size;
        v.redraw();
        v.updateToken(t.id, requested); // one validated op + persist on release
      }
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
        const w = v.camera.screenToWorld(this.last.x, this.last.y);
        const p = v.snapVertex(w.x, w.y);
        v.addWall(this.start.x, this.start.y, p.x, p.y);
      }
    }
    this.resetInteraction();
  }

  /** Cancel is intentionally different from up: every live preview is removed,
   * transforms are restored, and no mutation/request is committed. */
  private abortInteraction(): void {
    const v = this.vtt;
    if (this.mode === "draw") v.cancelDraw();
    if (this.mode === "measure") v.measure.clear();
    if (this.mode === "wall") v.walls.clearPreview();
    if (this.dragTokenId) {
      v.cancelTokenPreview(this.dragTokenId);
      const token = v.scene?.data.tokens.find((candidate) => candidate.id === this.dragTokenId);
      if (token) {
        if (this.mode === "rotate") token.rotation = this.transformFrom.rotation;
        if (this.mode === "scale" && this.transformFrom.size != null) token.size = this.transformFrom.size;
        v.redraw();
      }
    }
    this.pendingTouchTap = null;
    this.resetInteraction();
  }

  private resetInteraction(): void {
    this.mode = "none";
    this.dragTokenId = null;
    this.transformFrom = {};
    this.moved = false;
    this.vel = { x: 0, y: 0 };
  }

  private onCancel = (e: PointerEvent): void => {
    if (e.pointerType === "touch") {
      this.preventTouchDefault(e);
      if (!this.touches.has(e.pointerId)) return;
      if (this.touchCameraMoved || (this.mode === "pan" && this.moved)) this.vtt.persistCamera();
      this.abortInteraction();
      this.restoreTouchSelection();
      this.releaseAllTouches();
      this.resetTouchSequence();
      return;
    }
    if (e.pointerId !== this.activePointerId) return;
    const persistPan = this.mode === "pan" && this.moved;
    this.abortInteraction();
    if (persistPan) this.vtt.persistCamera();
    this.release(e.pointerId);
    this.activePointerId = null;
  };

  private onLostPointerCapture = (e: PointerEvent): void => {
    // Normal pointerup removes our pointer before implicit capture is released.
    // A still-tracked pointer means the OS/browser took it away unexpectedly.
    if (e.pointerType === "touch" ? this.touches.has(e.pointerId) : e.pointerId === this.activePointerId) {
      this.onCancel(e);
    }
  };

  private onWindowBlur = (): void => {
    if (!this.touches.size && this.activePointerId == null && !this.pinch) return;
    const hadTouch = this.touches.size > 0 || !!this.pinch;
    if (this.touchCameraMoved || (this.mode === "pan" && this.moved)) this.vtt.persistCamera();
    this.abortInteraction();
    if (hadTouch) this.restoreTouchSelection();
    this.releaseAllTouches();
    if (this.activePointerId != null) this.release(this.activePointerId);
    this.resetTouchSequence();
  };

  private releaseAllTouches(): void {
    for (const id of this.touches.keys()) this.release(id);
    this.touches.clear();
  }

  private resetTouchSequence(clearLastTap = true): void {
    this.pinch = null;
    this.waitForAllTouchesUp = false;
    this.activePointerId = null;
    this.touchStart = null;
    this.touchTapMoved = false;
    this.touchCameraMoved = false;
    this.pendingTouchTap = null;
    this.touchSelectionBefore = null;
    if (clearLastTap) this.lastTap = null;
  }

  private restoreTouchSelection(): void {
    const before = this.touchSelectionBefore;
    const current = this.vtt.selection;
    if (before?.kind !== current?.kind || before?.id !== current?.id) this.vtt.select(before);
  }

  private noteTouchTap(s: Point): void {
    const tool = this.vtt.tool;
    if (tool !== "select" && tool !== "pan" && tool !== "measure") {
      this.lastTap = null;
      return;
    }
    const now = Date.now();
    if (
      this.lastTap &&
      now - this.lastTap.at <= DOUBLE_TAP_MS &&
      Math.hypot(s.x - this.lastTap.x, s.y - this.lastTap.y) <= DOUBLE_TAP_DISTANCE
    ) {
      const w = this.vtt.camera.screenToWorld(s.x, s.y);
      this.vtt.ping(w.x, w.y);
      this.lastTap = null;
    } else {
      this.lastTap = { at: now, x: s.x, y: s.y };
    }
  }

  // PING - double-click or double-tap on the everyman tools pulses "look here".
  private onDblClick = (e: MouseEvent): void => {
    // A few WebViews still synthesize dblclick after touch despite a prevented
    // pointerdown. Suppress only a near-identical compatibility click, not a
    // real mouse being used elsewhere on a hybrid laptop.
    if (
      this.recentTouch() &&
      this.lastTouchClient &&
      Math.hypot(e.clientX - this.lastTouchClient.x, e.clientY - this.lastTouchClient.y) <= DOUBLE_TAP_DISTANCE
    ) return;
    const v = this.vtt;
    if (!v.scene) return;
    if (v.tool !== "select" && v.tool !== "pan" && v.tool !== "measure") return;
    const s = this.pos(e);
    const w = v.camera.screenToWorld(s.x, s.y);
    v.ping(w.x, w.y);
  };

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    const s = this.pos(e);
    this.vtt.camera.zoomAt(s.x, s.y, e.deltaY < 0 ? 1.12 : 1 / 1.12);
    // Play mode: zoom is clamped by the raised camera floor and always stays
    // centred on the player's own token - no zoom-walking across the map.
    if (this.vtt.playLocked()) this.vtt.followOwnToken();
    this.vtt.persistCamera();
  };

  private onContextMenu = (e: MouseEvent): void => e.preventDefault();
}

function midpoint(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
