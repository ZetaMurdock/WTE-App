import { describe, expect, it } from "vitest";
import { SfxPlayer, type SfxAudio } from "./sfxPlayer";

// Fake audio element: records lifecycle instead of touching DOM Audio.
class FakeAudio implements SfxAudio {
  played = 0;
  paused = false;
  loop = false;
  volume = 1;
  onended: (() => void) | null = null;
  constructor(public uri: string) {}
  play() {
    this.played += 1;
    this.paused = false;
  }
  pause() {
    this.paused = true;
  }
}

function player() {
  const made: FakeAudio[] = [];
  const p = new SfxPlayer((uri) => {
    const a = new FakeAudio(uri);
    made.push(a);
    return a;
  });
  return { p, made };
}

describe("SfxPlayer", () => {
  it("master volume scales live clips and future ones", () => {
    const { p, made } = player();
    p.apply({ action: "loop", id: "a", uri: "data:x", volume: 0.8 });
    expect(made[0].volume).toBeCloseTo(0.8);
    p.setMaster(0.5);
    expect(made[0].volume).toBeCloseTo(0.4); // retunes what's already playing
    p.apply({ action: "play", id: "b", uri: "data:y", volume: 1 });
    expect(made[1].volume).toBeCloseTo(0.5); // and scales new clips
    p.setMaster(1);
    expect(made[0].volume).toBeCloseTo(0.8);
  });

  it("caches bytes on first play and plays them", () => {
    const { p, made } = player();
    p.apply({ action: "play", id: "a", uri: "data:x", volume: 0.5 });
    expect(p.has("a")).toBe(true);
    expect(made).toHaveLength(1);
    expect(made[0].uri).toBe("data:x");
    expect(made[0].played).toBe(1);
    expect(made[0].volume).toBe(0.5);
    expect(made[0].loop).toBe(false);
    expect(p.playing).toBe(1);
  });

  it("replays from cache when bytes are omitted", () => {
    const { p, made } = player();
    p.apply({ action: "play", id: "a", uri: "data:x" });
    p.apply({ action: "stop", id: "a" });
    p.apply({ action: "play", id: "a" }); // no uri — cache hit
    expect(made).toHaveLength(2);
    expect(made[1].uri).toBe("data:x");
  });

  it("ignores a play whose bytes never arrived", () => {
    const { p, made } = player();
    p.apply({ action: "play", id: "ghost" });
    expect(made).toHaveLength(0);
    expect(p.playing).toBe(0);
  });

  it("re-trigger restarts: old element paused, fresh one started", () => {
    const { p, made } = player();
    p.apply({ action: "play", id: "a", uri: "data:x" });
    p.apply({ action: "play", id: "a" });
    expect(made).toHaveLength(2);
    expect(made[0].paused).toBe(true);
    expect(p.playing).toBe(1);
  });

  it("loop sets the flag and stop halts it", () => {
    const { p, made } = player();
    p.apply({ action: "loop", id: "amb", uri: "data:y" });
    expect(made[0].loop).toBe(true);
    p.apply({ action: "stop", id: "amb" });
    expect(made[0].paused).toBe(true);
    expect(p.playing).toBe(0);
  });

  it("stop for an unknown id is a no-op", () => {
    const { p } = player();
    p.apply({ action: "stop", id: "nope" });
    expect(p.playing).toBe(0);
  });

  it("stopall silences everything live", () => {
    const { p, made } = player();
    p.apply({ action: "play", id: "a", uri: "data:1" });
    p.apply({ action: "loop", id: "b", uri: "data:2" });
    p.stopAll();
    expect(made.every((a) => a.paused)).toBe(true);
    expect(p.playing).toBe(0);
  });

  it("a one-shot ending removes itself from the live set", () => {
    const { p, made } = player();
    p.apply({ action: "play", id: "a", uri: "data:x" });
    made[0].onended?.();
    expect(p.playing).toBe(0);
  });

  it("clamps volume into 0..1 and defaults to 0.8", () => {
    const { p, made } = player();
    p.apply({ action: "play", id: "a", uri: "data:x", volume: 4 });
    p.apply({ action: "play", id: "b", uri: "data:y" });
    expect(made[0].volume).toBe(1);
    expect(made[1].volume).toBe(0.8);
  });
});
