// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { InputController } from "./InputController";
import type { PixiVttApp } from "./PixiVttApp";

const attached: InputController[] = [];

afterEach(() => {
  for (const controller of attached.splice(0)) controller.detach();
  vi.restoreAllMocks();
});

function makeVtt(tokens: Array<Record<string, unknown>> = []) {
  const camera = {
    zoom: 1,
    cancelFling: vi.fn(),
    screenToWorld: vi.fn((x: number, y: number) => ({ x, y })),
    panBy: vi.fn(),
    zoomAt: vi.fn(),
    fling: vi.fn(),
  };
  const vtt = {
    scene: {
      data: {
        grid: { size: 70 },
        tokens,
        lights: [],
        fog: { mode: "none" },
      },
    },
    camera,
    tool: "select",
    selection: null as PixiVttApp["selection"],
    playerView: false,
    selfId: "self",
    tokens: {
      pickHandle: vi.fn((..._args: unknown[]): any => null),
      pick: vi.fn((..._args: unknown[]): any => null),
      displayPosition: vi.fn((..._args: unknown[]): any => null),
    },
    lights: { pick: vi.fn(() => null), pickNear: vi.fn(() => null) },
    emitters: { pick: vi.fn(() => null) },
    walls: { pick: vi.fn(() => null), preview: vi.fn(), clearPreview: vi.fn() },
    effects: { pick: vi.fn(() => null) },
    measure: { show: vi.fn(), clear: vi.fn() },
    playLocked: vi.fn(() => false),
    followOwnToken: vi.fn(),
    persistCamera: vi.fn(),
    canControlToken: vi.fn(() => true),
    canDraw: vi.fn(() => true),
    addTokenAt: vi.fn(),
    addLightAt: vi.fn(),
    addEffectAt: vi.fn(),
    paintZoneAt: vi.fn(),
    beginDraw: vi.fn(),
    extendDraw: vi.fn(),
    endDraw: vi.fn(),
    cancelDraw: vi.fn(),
    snapVertex: vi.fn((x: number, y: number) => ({ x, y })),
    addWall: vi.fn(),
    moveToken: vi.fn(),
    cancelTokenPreview: vi.fn(),
    requestTokenMove: vi.fn(),
    updateToken: vi.fn(),
    igniteLight: vi.fn(),
    redraw: vi.fn(),
    ping: vi.fn(),
    select: vi.fn((selection: PixiVttApp["selection"]) => {
      vtt.selection = selection;
    }),
  };
  return vtt;
}

function setup(vtt = makeVtt()) {
  const canvas = document.createElement("canvas");
  Object.defineProperty(canvas, "getBoundingClientRect", {
    value: () => ({ x: 0, y: 0, left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600, toJSON: () => ({}) }),
  });
  Object.defineProperties(canvas, {
    setPointerCapture: { value: vi.fn(), configurable: true },
    hasPointerCapture: { value: vi.fn(() => true), configurable: true },
    releasePointerCapture: { value: vi.fn(), configurable: true },
  });
  document.body.appendChild(canvas);
  const controller = new InputController(vtt as unknown as PixiVttApp);
  controller.attach(canvas);
  attached.push(controller);
  return { vtt, canvas, controller };
}

function pointer(
  target: EventTarget,
  type: string,
  id: number,
  x: number,
  y: number,
  pointerType: "touch" | "mouse" = "touch",
  button = 0
) {
  const event = new PointerEvent(type, {
    bubbles: true,
    cancelable: true,
    pointerId: id,
    pointerType,
    clientX: x,
    clientY: y,
    button,
  });
  target.dispatchEvent(event);
  return event;
}

function touchDown(canvas: HTMLCanvasElement, id: number, x: number, y: number) {
  return pointer(canvas, "pointerdown", id, x, y);
}
function touchMove(canvas: HTMLCanvasElement, id: number, x: number, y: number) {
  return pointer(canvas, "pointermove", id, x, y);
}
function touchUp(id: number, x: number, y: number) {
  return pointer(window, "pointerup", id, x, y);
}

describe("InputController touchscreen input", () => {
  it("defers one-shot placement and discards it when a second finger takes over", () => {
    for (const [tool, mutation] of [
      ["token", "addTokenAt"],
      ["light", "addLightAt"],
      ["effect", "addEffectAt"],
      ["zone", "paintZoneAt"],
    ] as const) {
      const vtt = makeVtt();
      vtt.tool = tool;
      const { canvas, controller } = setup(vtt);
      touchDown(canvas, 1, 100, 100);
      expect(vtt[mutation]).not.toHaveBeenCalled();
      touchDown(canvas, 2, 200, 100);
      touchUp(2, 200, 100);
      touchUp(1, 100, 100);
      expect(vtt[mutation]).not.toHaveBeenCalled();
      controller.detach();
      attached.splice(attached.indexOf(controller), 1);
      canvas.remove();
    }
  });

  it("runs a deferred placement exactly once on a one-finger tap", () => {
    const vtt = makeVtt();
    vtt.tool = "token";
    const { canvas } = setup(vtt);
    touchDown(canvas, 1, 80, 90);
    expect(vtt.addTokenAt).not.toHaveBeenCalled();
    touchUp(1, 80, 90);
    expect(vtt.addTokenAt).toHaveBeenCalledOnce();
    expect(vtt.addTokenAt).toHaveBeenCalledWith(80, 90);
  });

  it("ignores finger jitter inside tap slop and commits a token drag only on its owning pointerup", () => {
    const token = { id: "t1", x: 0, y: 0, size: 1, name: "Hero" };
    const vtt = makeVtt([token]);
    vtt.tokens.pick.mockReturnValue(token);
    vtt.tokens.displayPosition.mockReturnValue({ x: 20, y: 0 });
    const { canvas } = setup(vtt);

    touchDown(canvas, 1, 0, 0);
    touchMove(canvas, 1, 5, 0);
    expect(vtt.moveToken).not.toHaveBeenCalled();
    touchUp(99, 5, 0); // a pointer this controller never owned
    expect(vtt.requestTokenMove).not.toHaveBeenCalled();

    touchMove(canvas, 1, 20, 0);
    expect(vtt.moveToken).toHaveBeenCalledWith("t1", 20, 0, false);
    touchUp(1, 20, 0);
    expect(vtt.requestTokenMove).toHaveBeenCalledOnce();
    expect(vtt.requestTokenMove).toHaveBeenCalledWith("t1", 0, 0, 20, 0);
  });

  it("pinches to zoom and centroid-pan, then persists once when the gesture ends", () => {
    const vtt = makeVtt();
    vtt.tool = "pan";
    const { canvas } = setup(vtt);
    touchDown(canvas, 1, 100, 100);
    touchDown(canvas, 2, 200, 100);
    touchMove(canvas, 2, 240, 120);

    expect(vtt.camera.zoomAt).toHaveBeenCalledOnce();
    expect(vtt.camera.zoomAt.mock.calls[0][2]).toBeGreaterThan(1);
    expect(vtt.camera.panBy).toHaveBeenCalledWith(20, 10);
    expect(vtt.persistCamera).not.toHaveBeenCalled();

    touchUp(2, 240, 120);
    expect(vtt.persistCamera).toHaveBeenCalledOnce();
    touchMove(canvas, 1, 140, 140); // remaining pinch finger is inert
    touchUp(1, 140, 140);
    expect(vtt.persistCamera).toHaveBeenCalledOnce();
  });

  it("cancels an in-progress drawing on pinch takeover without committing it", () => {
    const vtt = makeVtt();
    vtt.tool = "draw";
    const { canvas } = setup(vtt);
    touchDown(canvas, 1, 20, 20);
    touchMove(canvas, 1, 40, 40);
    expect(vtt.beginDraw).toHaveBeenCalledOnce();
    expect(vtt.extendDraw).toHaveBeenCalledOnce();

    touchDown(canvas, 2, 100, 100);
    expect(vtt.cancelDraw).toHaveBeenCalledOnce();
    touchUp(2, 100, 100);
    touchUp(1, 40, 40);
    expect(vtt.endDraw).not.toHaveBeenCalled();
  });

  it("restores selection and token transform previews when pinch takes over", () => {
    const token = { id: "t1", x: 100, y: 100, size: 1, rotation: 30, name: "Hero" };
    const vtt = makeVtt([token]);
    vtt.selection = null;
    vtt.tokens.pick.mockReturnValue(token);
    const { canvas } = setup(vtt);

    // First tap selects and starts dragging the token; pinch must restore null.
    touchDown(canvas, 1, 100, 100);
    expect(vtt.selection).toEqual({ kind: "token", id: "t1" });
    touchMove(canvas, 1, 120, 100);
    touchDown(canvas, 2, 200, 100);
    expect(vtt.cancelTokenPreview).toHaveBeenCalledWith("t1");
    expect(vtt.selection).toBeNull();
    expect(vtt.requestTokenMove).not.toHaveBeenCalled();
    touchUp(2, 200, 100);
    touchUp(1, 120, 100);

    // The selected-token handle path gets a finger-sized 24px tolerance and
    // restores an in-progress rotation when a new pinch begins.
    vtt.selection = { kind: "token", id: "t1" };
    vtt.tokens.pickHandle.mockReturnValue("rotate");
    touchDown(canvas, 3, 100, 50);
    expect(vtt.tokens.pickHandle).toHaveBeenLastCalledWith(vtt.scene, "t1", 100, 50, 1, 24);
    touchMove(canvas, 3, 140, 100);
    expect(token.rotation).not.toBe(30);
    touchDown(canvas, 4, 200, 100);
    expect(token.rotation).toBe(30);
    expect(vtt.updateToken).not.toHaveBeenCalled();
    touchUp(4, 200, 100);
    touchUp(3, 140, 100);
  });

  it("clears wall previews on pointer cancellation without adding a wall", () => {
    const vtt = makeVtt();
    vtt.tool = "wall";
    const { canvas } = setup(vtt);
    touchDown(canvas, 1, 10, 10);
    touchMove(canvas, 1, 40, 40);
    pointer(window, "pointercancel", 1, 40, 40);
    expect(vtt.walls.clearPreview).toHaveBeenCalledOnce();
    expect(vtt.addWall).not.toHaveBeenCalled();
  });

  it("turns a double tap into exactly one ping and suppresses its synthetic dblclick", () => {
    const vtt = makeVtt();
    const { canvas } = setup(vtt);
    touchDown(canvas, 1, 50, 60);
    touchUp(1, 50, 60);
    touchDown(canvas, 2, 52, 61);
    touchUp(2, 52, 61);
    expect(vtt.ping).toHaveBeenCalledOnce();

    canvas.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, clientX: 52, clientY: 61 }));
    expect(vtt.ping).toHaveBeenCalledOnce();
  });

  it("preserves mouse right-drag panning and wheel zoom", () => {
    const vtt = makeVtt();
    const { canvas } = setup(vtt);
    pointer(canvas, "pointerdown", 11, 10, 10, "mouse", 2);
    pointer(canvas, "pointermove", 11, 30, 25, "mouse", 2);
    pointer(window, "pointerup", 11, 30, 25, "mouse", 2);
    expect(vtt.camera.panBy).toHaveBeenCalledWith(20, 15);
    expect(vtt.camera.fling).toHaveBeenCalledOnce();

    canvas.dispatchEvent(new WheelEvent("wheel", { bubbles: true, cancelable: true, clientX: 40, clientY: 50, deltaY: -1 }));
    const lastZoom = vtt.camera.zoomAt.mock.calls[vtt.camera.zoomAt.mock.calls.length - 1];
    expect(lastZoom?.[2]).toBe(1.12);
    expect(vtt.persistCamera).toHaveBeenCalledOnce();
  });

  it("sets and restores touch-action on attach/detach", () => {
    const { canvas, controller } = setup();
    expect(canvas.style.touchAction).toBe("none");
    controller.detach();
    attached.splice(attached.indexOf(controller), 1);
    expect(canvas.style.touchAction).toBe("");
  });
});
