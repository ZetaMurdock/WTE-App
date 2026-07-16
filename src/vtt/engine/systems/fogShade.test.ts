import { describe, it, expect } from "vitest";
import { fogCellAlpha } from "./fogShade";

const base = { visible: false, explored: true, playerView: true } as const;

describe("fogCellAlpha", () => {
  it("visible cells are always fully clear, in every mode", () => {
    for (const mode of ["pitch", "remembered", "realistic"] as const) {
      expect(fogCellAlpha({ ...base, mode, visible: true })).toBe(0);
    }
  });

  it("pitch: explored means NOTHING — left areas are as black as the void", () => {
    expect(fogCellAlpha({ ...base, mode: "pitch", explored: true })).toBe(1);
    expect(fogCellAlpha({ ...base, mode: "pitch", explored: false })).toBe(1);
  });

  it("remembered: explored stays dim, unexplored stays black", () => {
    expect(fogCellAlpha({ ...base, mode: "remembered", explored: true })).toBe(0.72);
    expect(fogCellAlpha({ ...base, mode: "remembered", explored: false })).toBe(1);
  });

  it("realistic: memory decays from dim back to pitch black over decaySeconds", () => {
    const now = 100_000;
    const opts = { ...base, mode: "realistic" as const, now, decaySeconds: 60 };
    expect(fogCellAlpha({ ...opts, seenAt: now })).toBeCloseTo(0.72); // just left — like memory
    expect(fogCellAlpha({ ...opts, seenAt: now - 30_000 })).toBeCloseTo(0.86); // halfway back to black
    expect(fogCellAlpha({ ...opts, seenAt: now - 60_000 })).toBe(1); // fully decayed
    expect(fogCellAlpha({ ...opts, seenAt: now - 999_000 })).toBe(1); // long gone
  });

  it("realistic: a cell with no timestamp reads as fully dark", () => {
    expect(fogCellAlpha({ ...base, mode: "realistic", seenAt: undefined })).toBe(1);
  });

  it("Curator keeps a translucent overlay instead of opaque black", () => {
    expect(fogCellAlpha({ ...base, playerView: false, mode: "pitch" })).toBe(0.9);
    expect(fogCellAlpha({ ...base, playerView: false, mode: "remembered", explored: true })).toBe(0.55);
    const gmDecayed = fogCellAlpha({ ...base, playerView: false, mode: "realistic", seenAt: 0, now: 999_000, decaySeconds: 60 });
    expect(gmDecayed).toBe(0.9);
  });
});
