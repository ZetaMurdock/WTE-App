import { describe, it, expect } from "vitest";
import { blobId, deflateSceneData, inflateSceneData, collectBlobRefs, BLOB_PREFIX, BLOB_MIN_CHARS } from "./sceneBlobs";
import { defaultSceneData, type VttEmitter, type VttToken } from "../types/scene";

const bigImg = "data:image/png;base64," + "A".repeat(BLOB_MIN_CHARS);
const smallImg = "data:image/png;base64,tiny";
const bigClip = "data:audio/wav;base64," + "Q".repeat(BLOB_MIN_CHARS);
const tok = (id: string, img?: string): VttToken => ({ id, name: id, x: 0, y: 0, size: 1, color: "#fff", hp: 1, visible: true, img });
const emit = (id: string, src: string): VttEmitter => ({ id, x: 0, y: 0, radius: 8, name: id, src, volume: 1, loop: true });

describe("blobId", () => {
  it("is stable and content-addressed", () => {
    expect(blobId(bigImg)).toBe(blobId(bigImg));
    expect(blobId(bigImg)).not.toBe(blobId(bigImg + "B"));
    expect(blobId(bigImg)).toMatch(/^bl-/);
  });
});

describe("deflateSceneData", () => {
  it("extracts big images into blobs and replaces them with refs", () => {
    const d = defaultSceneData();
    d.background.src = bigImg;
    d.tokens.push(tok("t1", bigImg), tok("t2", smallImg), tok("t3"));
    const blobs = new Map<string, string>();
    const slim = deflateSceneData(d, (id, uri) => blobs.set(id, uri));

    expect(slim.background.src).toBe(BLOB_PREFIX + blobId(bigImg));
    expect(slim.tokens[0].img).toBe(BLOB_PREFIX + blobId(bigImg));
    expect(slim.tokens[1].img).toBe(smallImg); // under threshold — left inline
    expect(slim.tokens[2].img).toBeUndefined();
    expect(blobs.size).toBe(1); // same content → one shared blob
    expect(blobs.get(blobId(bigImg))).toBe(bigImg);
  });

  it("NEVER mutates the live input data", () => {
    const d = defaultSceneData();
    d.background.src = bigImg;
    d.tokens.push(tok("t1", bigImg));
    d.emitters = [emit("e1", bigClip)];
    deflateSceneData(d, () => {});
    expect(d.background.src).toBe(bigImg);
    expect(d.tokens[0].img).toBe(bigImg);
    expect(d.emitters[0].src).toBe(bigClip);
  });

  it("de-inlines spatial-emitter audio too, and round-trips it", () => {
    const d = defaultSceneData();
    d.emitters = [emit("e1", bigClip)];
    const blobs = new Map<string, string>();
    const slim = deflateSceneData(d, (id, uri) => blobs.set(id, uri));
    expect(slim.emitters![0].src).toBe(BLOB_PREFIX + blobId(bigClip));
    expect(collectBlobRefs(slim)).toEqual([blobId(bigClip)]);
    const back = inflateSceneData(slim, (id) => blobs.get(id));
    expect(back.emitters![0].src).toBe(bigClip);
  });

  it("shrinks the serialized payload dramatically", () => {
    const d = defaultSceneData();
    d.background.src = bigImg;
    const slim = deflateSceneData(d, () => {});
    expect(JSON.stringify(slim).length).toBeLessThan(JSON.stringify(d).length / 4);
  });
});

describe("collectBlobRefs + inflateSceneData (round trip)", () => {
  it("restores exactly what was deflated", () => {
    const d = defaultSceneData();
    d.background.src = bigImg;
    d.tokens.push(tok("t1", bigImg));
    const blobs = new Map<string, string>();
    const slim = deflateSceneData(d, (id, uri) => blobs.set(id, uri));

    const refs = collectBlobRefs(slim);
    expect(refs).toEqual([blobId(bigImg), blobId(bigImg)]);

    const back = inflateSceneData(slim, (id) => blobs.get(id));
    expect(back.background.src).toBe(bigImg);
    expect(back.tokens[0].img).toBe(bigImg);
  });

  it("leaves unknown refs intact instead of crashing", () => {
    const d = defaultSceneData();
    d.background.src = BLOB_PREFIX + "bl-missing";
    inflateSceneData(d, () => undefined);
    expect(d.background.src).toBe(BLOB_PREFIX + "bl-missing");
  });

  it("is a no-op on scenes with no refs (legacy inline saves)", () => {
    const d = defaultSceneData();
    d.background.src = bigImg; // legacy: full data URL stored inline
    expect(collectBlobRefs(d)).toEqual([]);
    inflateSceneData(d, () => undefined);
    expect(d.background.src).toBe(bigImg);
  });
});
