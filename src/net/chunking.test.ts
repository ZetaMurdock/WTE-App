import { describe, it, expect } from "vitest";
import { frameChunks, ChunkAssembler, CHUNK_SIZE } from "./chunking";

describe("chunking (large-message transport framing)", () => {
  it("passes small payloads through untouched", () => {
    const rx = new ChunkAssembler();
    expect(frameChunks("hello")).toEqual(["hello"]);
    expect(rx.feed("hello")).toBe("hello");
  });

  it("round-trips a multi-megabyte payload (the scene-snapshot case)", () => {
    const payload = JSON.stringify({ t: "snapshot", state: { background: "data:image/png;base64," + "A".repeat(3_000_000) } });
    const frames = frameChunks(payload);
    expect(frames.length).toBe(Math.ceil(payload.length / CHUNK_SIZE));
    expect(frames.every((f) => f.length <= CHUNK_SIZE + 40)).toBe(true); // header stays tiny
    const rx = new ChunkAssembler();
    let out: string | null = null;
    for (const f of frames) out = rx.feed(f);
    expect(out).toBe(payload);
  });

  it("keeps interleaved messages from colliding", () => {
    const a = frameChunks("A".repeat(CHUNK_SIZE * 2 + 5));
    const b = frameChunks("B".repeat(CHUNK_SIZE * 2 + 5));
    const rx = new ChunkAssembler();
    const results: string[] = [];
    // interleave: a0 b0 a1 b1 a2 b2
    for (let i = 0; i < a.length; i++) {
      for (const f of [a[i], b[i]]) {
        const r = rx.feed(f);
        if (r) results.push(r);
      }
    }
    expect(results).toHaveLength(2);
    expect(results[0][0]).toBe("A");
    expect(results[1][0]).toBe("B");
  });

  it("small frames flow while a big message is mid-assembly", () => {
    const big = frameChunks("X".repeat(CHUNK_SIZE * 3));
    const rx = new ChunkAssembler();
    expect(rx.feed(big[0])).toBeNull();
    expect(rx.feed('{"t":"roll"}')).toBe('{"t":"roll"}'); // ops keep flowing
    expect(rx.feed(big[1])).toBeNull();
    expect(rx.feed(big[2])).toBe("X".repeat(CHUNK_SIZE * 3));
  });

  it("ignores malformed chunk frames instead of crashing", () => {
    const rx = new ChunkAssembler();
    expect(rx.feed("@@c|broken")).toBeNull();
    expect(rx.feed("@@c|id|9|2|out-of-range")).toBeNull();
  });

  it("drops stale partials after 30s (a peer that died mid-send)", () => {
    const big = frameChunks("Y".repeat(CHUNK_SIZE * 2));
    const rx = new ChunkAssembler();
    expect(rx.feed(big[0], 1_000)).toBeNull();
    // 40s later a new message's frame triggers cleanup; the old partial is gone,
    // so its late second half can never complete it.
    expect(rx.feed('{"t":"chat"}', 41_000)).toBe('{"t":"chat"}');
    expect(rx.feed(big[1], 41_001)).toBeNull();
  });
});
