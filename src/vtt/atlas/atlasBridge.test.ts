// The pop-out bridge: URL identity and message validation. Both ends treat
// the bus as untrusted input, so the parser is the contract.
import { describe, expect, it } from "vitest";
import { atlasHashFor, parseAtlasHash, parseBridge } from "./atlasBridge";

describe("the popped window's identity", () => {
  it("round-trips through the URL hash", () => {
    const p = { campaignId: "camp-42", curator: true, netPlayer: false };
    expect(parseAtlasHash(atlasHashFor(p))).toEqual(p);
    const q = { campaignId: "x y&z", curator: false, netPlayer: true };
    expect(parseAtlasHash(atlasHashFor(q))).toEqual(q);
  });

  it("rejects anything that is not an atlas hash", () => {
    expect(parseAtlasHash("")).toBeNull();
    expect(parseAtlasHash("#/sheet")).toBeNull();
    expect(parseAtlasHash("#/atlas")).toBeNull(); // no campaign
    expect(parseAtlasHash("#/atlas?curator=1")).toBeNull(); // still no campaign
  });
});

describe("bridge messages", () => {
  it("passes well-formed messages", () => {
    expect(parseBridge({ kind: "saved", campaignId: "c1" })).toEqual({ kind: "saved", campaignId: "c1" });
    expect(parseBridge({ kind: "want" })).toEqual({ kind: "want" });
    expect(parseBridge({ kind: "hello" })).toEqual({ kind: "hello" });
    expect(parseBridge({ kind: "netDoc", doc: { version: 1 } })).toEqual({ kind: "netDoc", doc: { version: 1 } });
    expect(parseBridge({ kind: "focus", x: 3, y: 4, zoom: 9, label: "Rivenbark" })).toEqual({ kind: "focus", x: 3, y: 4, zoom: 9, label: "Rivenbark" });
    expect(parseBridge({ kind: "bring", x: 1, y: 2, to: "peer-9" })).toMatchObject({ kind: "bring", to: "peer-9" });
    expect(parseBridge({ kind: "peers", players: [{ id: "a", name: "Ada" }] })).toEqual({ kind: "peers", players: [{ id: "a", name: "Ada" }] });
  });

  it("drops garbage instead of forwarding it", () => {
    expect(parseBridge(null)).toBeNull();
    expect(parseBridge("focus")).toBeNull();
    expect(parseBridge({ kind: "focus", x: Number.NaN, y: 2 })).toBeNull();
    expect(parseBridge({ kind: "saved" })).toBeNull(); // no campaign
    expect(parseBridge({ kind: "launch-the-missiles" })).toBeNull();
  });

  it("bounds and filters what crosses the bus", () => {
    const f = parseBridge({ kind: "focus", x: 1, y: 2, label: "L".repeat(200) });
    expect(f && f.kind === "focus" ? f.label!.length : 0).toBe(80);
    const peers = parseBridge({ kind: "peers", players: [{ id: "ok", name: "Kim" }, { id: 7 }, "junk", null] });
    expect(peers && peers.kind === "peers" ? peers.players : []).toEqual([{ id: "ok", name: "Kim" }]);
  });
});
