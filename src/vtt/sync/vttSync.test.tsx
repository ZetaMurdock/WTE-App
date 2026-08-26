// @vitest-environment happy-dom
import { act, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NetMessage, NetMessageType, Peer, Role } from "../../net/protocol";
import type { PixiVttApp } from "../engine/PixiVttApp";
import { newScene, type VttScene, type VttToken } from "../types/scene";

const netState = vi.hoisted(() => ({ current: null as unknown }));
vi.mock("../../net/NetContext", () => ({ useNet: () => netState.current }));

import { MAX_CONDITION_CLOCKS } from "../engine/systems/ConditionClockSystem";
import { isVttSceneSnapshot, useVttSync, type VttSyncApi } from "./vttSync";

type Handler = (message: NetMessage, from: string) => void;

function token(owner = "player-1"): VttToken {
  return { id: "token-1", owner, name: "Hero", x: 35, y: 35, size: 1, color: "#fff", visible: true };
}

function sceneWith(owner = "player-1"): VttScene {
  const scene = newScene("campaign-1", "Table");
  scene.id = "scene-1";
  scene.data.tokens = [token(owner)];
  return scene;
}

function makeNet(role: Role) {
  const selfId = role === "host" ? "host-1" : "player-1";
  const peers: Peer[] = role === "host"
    ? [{ id: "player-1", name: "Player", role: "player" }]
    : [{ id: "host-1", name: "Curator", role: "host" }, { id: "player-2", name: "Other", role: "player" }];
  const listeners = new Map<NetMessageType, Set<Handler>>();
  const publish = vi.fn<(message: NetMessage, to?: string) => void>();
  const subscribe = vi.fn((type: NetMessageType, handler: Handler) => {
    let handlers = listeners.get(type);
    if (!handlers) listeners.set(type, (handlers = new Set()));
    handlers.add(handler);
    return () => handlers?.delete(handler);
  });
  return {
    value: { status: "connected", role, room: "ROOM", selfId, peers, publish, subscribe },
    publish,
    async emit(type: NetMessageType, message: NetMessage, from: string) {
      await act(async () => {
        for (const handler of listeners.get(type) ?? []) handler(message, from);
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
      });
    },
  };
}

function makeEngine(scene: VttScene | null, apply = true) {
  return {
    scene,
    applyRemote: vi.fn(() => apply),
    commitTokenMove: vi.fn(() => true),
    rejectTokenMove: vi.fn(),
  } as unknown as PixiVttApp;
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;
let api: VttSyncApi | null = null;

function Harness({ engine, scene, onSnapshot = () => {}, expectedCampaignId }: {
  engine: PixiVttApp;
  scene: VttScene | null;
  onSnapshot?: (value: VttScene) => void;
  expectedCampaignId?: string | null;
}) {
  const engineRef = useRef(engine);
  engineRef.current = engine;
  api = useVttSync({
    engineRef,
    expectedCampaignId,
    sceneId: scene?.id ?? null,
    getScene: () => scene,
    onSnapshot,
  });
  return null;
}

function mount(engine: PixiVttApp, scene: VttScene | null, onSnapshot?: (value: VttScene) => void, expectedCampaignId?: string | null) {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() => root?.render(<Harness engine={engine} scene={scene} onSnapshot={onSnapshot} expectedCampaignId={expectedCampaignId} />));
}

beforeEach(() => {
  api = null;
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  vi.useRealTimers();
});

describe("host-authoritative VTT synchronization", () => {
  it("lets the host validate, apply, and re-author an accepted player patch", async () => {
    const net = makeNet("host");
    netState.current = net.value;
    const table = sceneWith();
    const engine = makeEngine(table);
    mount(engine, table);
    await act(async () => { await Promise.resolve(); });
    net.publish.mockClear();

    const patch: NetMessage = {
      t: "vtt-patch",
      scope: table.id,
      patch: { op: "token.update", id: "token-1", patch: { color: "#123456" } },
      rev: 7,
    };
    await net.emit("vtt-patch", patch, "player-1");

    expect(engine.applyRemote).toHaveBeenCalledWith(patch.patch);
    expect(net.publish).toHaveBeenCalledWith(expect.objectContaining({
      t: "vtt-patch",
      scope: table.id,
      patch: patch.patch,
    }));
  });

  it("rolls back a rejected optimistic edit and does not consume its revision", async () => {
    const net = makeNet("host");
    netState.current = net.value;
    const table = sceneWith("player-2");
    const engine = makeEngine(table);
    mount(engine, table);
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    net.publish.mockClear();

    const patch: NetMessage = {
      t: "vtt-patch",
      scope: table.id,
      patch: { op: "token.update", id: "token-1", patch: { size: 2 } },
      rev: 4,
    };
    await net.emit("vtt-patch", patch, "player-1");

    expect(engine.applyRemote).not.toHaveBeenCalled();
    expect(net.publish).toHaveBeenCalledWith(expect.objectContaining({ t: "snapshot", state: table }), "player-1");

    net.publish.mockClear();
    table.data.tokens[0].owner = "player-1";
    await net.emit("vtt-patch", patch, "player-1");
    expect(engine.applyRemote).toHaveBeenCalledWith(patch.patch);
    expect(net.publish).toHaveBeenCalledWith(expect.objectContaining({ t: "vtt-patch", patch: patch.patch }));
  });

  it("lets players accept patches only from their known host", async () => {
    const net = makeNet("player");
    netState.current = net.value;
    const table = sceneWith();
    const engine = makeEngine(table, false); // an optimistic echo may already be a no-op
    mount(engine, table);
    net.publish.mockClear();
    const patch: NetMessage = {
      t: "vtt-patch",
      scope: table.id,
      patch: { op: "token.update", id: "token-1", patch: { color: "#abcdef" } },
      rev: 1,
    };

    await net.emit("vtt-patch", patch, "player-2");
    expect(engine.applyRemote).not.toHaveBeenCalled();
    await net.emit("vtt-patch", patch, "host-1");
    expect(engine.applyRemote).toHaveBeenCalledWith(patch.patch);
    expect(net.publish).not.toHaveBeenCalledWith(expect.objectContaining({ t: "vtt-patch" }));
  });

  it("sends a post-mutation token removal but suppresses Curator-only intents", () => {
    const net = makeNet("player");
    netState.current = net.value;
    const table = sceneWith();
    table.data.tokens = []; // Pixi already removed it before onOp fires
    const engine = makeEngine(table);
    mount(engine, table);
    net.publish.mockClear();

    act(() => api?.broadcastOp({ op: "token.remove", id: "token-1" }));
    expect(net.publish).toHaveBeenCalledWith({
      t: "vtt-patch",
      scope: table.id,
      patch: { op: "token.remove", id: "token-1" },
      rev: expect.any(Number),
    }, "host-1");

    net.publish.mockClear();
    act(() => api?.broadcastOp({
      op: "wall.add",
      wall: { id: "wall-1", x1: 0, y1: 0, x2: 70, y2: 0, blocksLight: true },
    }));
    expect(net.publish).not.toHaveBeenCalled();
  });

  it("correlates a move rejection, restores host coordinates, then bounces", async () => {
    const net = makeNet("player");
    netState.current = net.value;
    const table = sceneWith();
    const engine = makeEngine(table);
    mount(engine, table);
    net.publish.mockClear();

    act(() => api?.requestMove("token-1", 35, 35, 105, 35));
    const request = net.publish.mock.calls.find(([message]) => message.t === "vtt-move-request")?.[0];
    expect(request?.t).toBe("vtt-move-request");
    if (!request || request.t !== "vtt-move-request") throw new Error("move request missing");

    await net.emit("vtt-move-reject", {
      t: "vtt-move-reject",
      requestId: "unrelated",
      scope: table.id,
      tokenId: "token-1",
      x: 35,
      y: 35,
      attemptedX: 105,
      attemptedY: 35,
      reason: "occupied",
    }, "host-1");
    expect(engine.commitTokenMove).not.toHaveBeenCalled();

    await net.emit("vtt-move-reject", {
      t: "vtt-move-reject",
      requestId: request.requestId,
      scope: table.id,
      tokenId: "token-1",
      x: 45,
      y: 35,
      attemptedX: 105,
      attemptedY: 35,
      reason: "stale",
    }, "host-1");

    expect(engine.commitTokenMove).toHaveBeenCalledWith("token-1", 45, 35, false, true);
    expect(engine.rejectTokenMove).toHaveBeenCalledWith("token-1", 105, 35);
    expect(vi.mocked(engine.commitTokenMove).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(engine.rejectTokenMove).mock.invocationCallOrder[0]
    );
  });

  it("retries snapshot recovery until a valid host snapshot is adopted", async () => {
    vi.useFakeTimers();
    const net = makeNet("player");
    netState.current = net.value;
    const engine = makeEngine(null);
    const adopted = vi.fn();
    mount(engine, null, adopted);

    const requestCount = () => net.publish.mock.calls.filter(([message]) => message.t === "vtt-snapshot-request").length;
    expect(requestCount()).toBe(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(1_200); });
    expect(requestCount()).toBe(2);

    const snapshot = sceneWith();
    await net.emit("snapshot", { t: "snapshot", state: snapshot, rev: 2 }, "host-1");
    expect(adopted).toHaveBeenCalledWith(snapshot);
    const acceptedAt = requestCount();
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(requestCount()).toBe(acceptedAt);
  });

  it("resets snapshot recovery when the announced campaign changes", async () => {
    const net = makeNet("player");
    netState.current = net.value;
    const engine = makeEngine(null);
    const adopted = vi.fn();
    mount(engine, null, adopted, "campaign-1");
    const firstRequests = net.publish.mock.calls.filter(([message]) => message.t === "vtt-snapshot-request").length;

    const campaignOne = sceneWith();
    await net.emit("snapshot", { t: "snapshot", state: campaignOne, rev: 1 }, "host-1");
    expect(adopted).toHaveBeenCalledTimes(1);

    act(() => root?.render(
      <Harness engine={engine} scene={null} onSnapshot={adopted} expectedCampaignId="campaign-2" />
    ));
    expect(net.publish.mock.calls.filter(([message]) => message.t === "vtt-snapshot-request").length).toBeGreaterThan(firstRequests);

    await net.emit("snapshot", { t: "snapshot", state: campaignOne, rev: 2 }, "host-1");
    expect(adopted).toHaveBeenCalledTimes(1);
    const campaignTwo = { ...sceneWith(), id: "scene-2", campaignId: "campaign-2" };
    await net.emit("snapshot", { t: "snapshot", state: campaignTwo, rev: 3 }, "host-1");
    expect(adopted).toHaveBeenLastCalledWith(campaignTwo);
  });
});

describe("snapshot runtime boundary", () => {
  it("rejects oversized or non-finite renderer inputs", () => {
    const valid = sceneWith();
    expect(isVttSceneSnapshot(valid)).toBe(true);
    expect(isVttSceneSnapshot({
      ...valid,
      data: { ...valid.data, grid: { ...valid.data.grid, cols: 100_000 } },
    })).toBe(false);
    expect(isVttSceneSnapshot({
      ...valid,
      data: { ...valid.data, tokens: [{ ...valid.data.tokens[0], x: Number.NaN }] },
    })).toBe(false);
    expect(isVttSceneSnapshot({
      ...valid,
      data: { ...valid.data, drawings: [{ id: "hostile", points: undefined, color: "#fff", width: 2 }] },
    })).toBe(false);
    expect(isVttSceneSnapshot({
      ...valid,
      data: { ...valid.data, emitters: [{ id: "bad-audio", x: 0, y: 0, radius: 4, name: "bad", src: "x", volume: 2, loop: true }] },
    })).toBe(false);
    expect(isVttSceneSnapshot({
      ...valid,
      data: { ...valid.data, links: [{ id: "bad-link", targetSceneId: "scene-2", edge: "diagonal" }] },
    })).toBe(false);
  });

  it("accepts well-formed condition clocks and rejects unusable countdowns", () => {
    const valid = sceneWith();
    const clock = { tokenId: "token-1", status: "Slowed (2)", bornRound: 3, rounds: 2 };
    expect(isVttSceneSnapshot({ ...valid, data: { ...valid.data, conditionClocks: [clock] } })).toBe(true);
    expect(isVttSceneSnapshot({ ...valid, data: { ...valid.data, conditionClocks: [{ ...clock, potency: 4 }] } })).toBe(true);

    // A countdown that cannot be counted: bornRound + rounds has to mean a round.
    for (const bad of [
      { ...clock, bornRound: Number.NaN },
      { ...clock, bornRound: -1 },
      { ...clock, rounds: 0 },
      { ...clock, rounds: 1.5 },
      { ...clock, rounds: 1_000_000 },
      { ...clock, status: "" },
      { ...clock, status: "x".repeat(81) },
      { ...clock, tokenId: 7 },
      { ...clock, potency: Number.POSITIVE_INFINITY },
      "not a clock",
    ]) {
      expect(isVttSceneSnapshot({ ...valid, data: { ...valid.data, conditionClocks: [bad] } })).toBe(false);
    }

    // The per-entry rules do not bound the field: a peer handing over a million
    // well-formed clocks would fit the wire and then be walked once per token,
    // every round, forever.
    const clocks = (n: number) => Array.from({ length: n }, () => ({ ...clock }));
    expect(isVttSceneSnapshot({ ...valid, data: { ...valid.data, conditionClocks: clocks(MAX_CONDITION_CLOCKS) } })).toBe(true);
    expect(isVttSceneSnapshot({ ...valid, data: { ...valid.data, conditionClocks: clocks(MAX_CONDITION_CLOCKS + 1) } })).toBe(false);
  });
});
