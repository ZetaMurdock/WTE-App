import { describe, expect, it } from "vitest";
import { myPeerId } from "./discovery";

describe("myPeerId", () => {
  it("returns a non-empty string between 8 and 64 chars matching peer ID regex", () => {
    const id = myPeerId();
    expect(id).toBeDefined();
    expect(id).toMatch(/^[a-z0-9_-]{8,64}$/i);
  });

  it("consistently returns the session peer ID within the same session", () => {
    const first = myPeerId();
    const second = myPeerId();
    expect(first).toBe(second);
  });
});
