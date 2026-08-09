import { describe, expect, it } from "vitest";
import type { VttToken } from "../types/scene";
import { canAcceptSnapshot, canControlToken, tokenOwnerId } from "./tokenPermissions";

const token = (over: Partial<VttToken> = {}): VttToken => ({
  id: "t1",
  name: "Actor",
  x: 35,
  y: 35,
  size: 1,
  color: "#fff",
  visible: true,
  ...over,
});

describe("strict token control", () => {
  it("lets a player control only their explicitly owned actor", () => {
    expect(canControlToken({ peerId: "p1", role: "player" }, token({ owner: "p1" }))).toBe(true);
    expect(canControlToken({ peerId: "p2", role: "player" }, token({ owner: "p1" }))).toBe(false);
    expect(canControlToken({ peerId: "p1", role: "player" }, token())).toBe(false);
  });

  it("never gives players control of props, even when an old scene assigned one", () => {
    expect(canControlToken({ peerId: "p1", role: "player" }, token({ owner: "p1", prop: true }))).toBe(false);
  });

  it("keeps player-owned actors private from ordinary Curator input", () => {
    const owned = token({ owner: "p1" });
    expect(canControlToken({ peerId: "host", role: "host" }, owned)).toBe(false);
    expect(canControlToken({ peerId: "host", role: "host", administrative: true }, owned)).toBe(true);
    expect(canControlToken({ peerId: "host", role: "host" }, token())).toBe(true);
    expect(canControlToken({ peerId: "host", role: "host" }, token({ prop: true }))).toBe(true);
  });

  it("recognizes the legacy ownerPeer field during migration", () => {
    const legacy = token({ ownerPeer: "legacy-player" });
    expect(tokenOwnerId(legacy)).toBe("legacy-player");
    expect(canControlToken({ peerId: "legacy-player", role: "player" }, legacy)).toBe(true);
  });
});

describe("snapshot authority", () => {
  it("allows a player to adopt only the known host's snapshot", () => {
    expect(canAcceptSnapshot("player", "host", "host", "p1")).toBe(true);
    expect(canAcceptSnapshot("player", "p2", "host", "p1")).toBe(false);
    expect(canAcceptSnapshot("player", "p1", "host", "p1")).toBe(false);
  });

  it("never lets the host adopt a remote snapshot", () => {
    expect(canAcceptSnapshot("host", "p1", "host", "host")).toBe(false);
  });
});
