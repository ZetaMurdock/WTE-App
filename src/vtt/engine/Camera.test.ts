import { describe, expect, it } from "vitest";
import { Camera } from "./Camera";
import type { Container } from "pixi.js";

// Camera only ever touches world.position.set / world.scale.set — stub it.
function stubWorld() {
  return { position: { set: () => {} }, scale: { set: () => {} } } as unknown as Container;
}
const cam = () => new Camera(stubWorld());

describe("Camera smooth follow", () => {
  it("glides toward the target instead of teleporting", () => {
    const c = cam();
    c.x = 0;
    c.y = 0;
    c.followTo(100, 0);
    c.tick(1);
    expect(c.x).toBeGreaterThan(0);
    expect(c.x).toBeLessThan(100); // eased, not snapped
  });

  it("converges on the target and then settles exactly", () => {
    const c = cam();
    c.followTo(100, 50);
    for (let i = 0; i < 240; i++) c.tick(1);
    expect(c.x).toBe(100);
    expect(c.y).toBe(50);
    expect(c.tick(1)).toBe(false); // no work once settled
  });

  it("is frame-rate independent — same distance covered per unit time", () => {
    const a = cam();
    a.followTo(100, 0);
    for (let i = 0; i < 60; i++) a.tick(1); // 60 frames of 1x
    const b = cam();
    b.followTo(100, 0);
    for (let i = 0; i < 30; i++) b.tick(2); // 30 frames of 2x = same elapsed
    expect(Math.abs(a.x - b.x)).toBeLessThan(1.5);
  });

  it("snapTo jumps immediately and clears the follow", () => {
    const c = cam();
    c.followTo(500, 500);
    c.snapTo(10, 20);
    expect([c.x, c.y]).toEqual([10, 20]);
    expect(c.following).toBe(false);
  });

  it("hand-panning cancels the follow so the camera doesn't fight the user", () => {
    const c = cam();
    c.followTo(500, 500);
    c.panBy(5, 5);
    expect(c.following).toBe(false);
  });

  it("loading a camera state cancels a stale follow target", () => {
    const c = cam();
    c.followTo(999, 999);
    c.set({ x: 1, y: 2, zoom: 1 });
    expect(c.following).toBe(false);
    expect([c.x, c.y]).toEqual([1, 2]);
  });

  it("still supports fling momentum alongside follow", () => {
    const c = cam();
    c.fling(10, 0);
    expect(c.tick(1)).toBe(true);
    expect(c.x).toBeGreaterThan(0);
  });
});
