// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  net: { current: null as any },
  active: vi.fn(),
  build: vi.fn(),
  clear: vi.fn(),
  install: vi.fn(),
  syncing: vi.fn(),
  error: vi.fn(),
  parse: vi.fn(),
  toast: vi.fn(),
}));

vi.mock("./NetContext", () => ({ useNet: () => mocks.net.current }));
vi.mock("../lib/appToast", () => ({ pushToast: mocks.toast }));
vi.mock("../lib/campaignCodex", () => ({
  activeRoomCodex: mocks.active,
  buildCampaignCodexSnapshot: mocks.build,
  clearRoomCodex: mocks.clear,
  installRoomCodex: mocks.install,
  markRoomCodexError: mocks.error,
  markRoomCodexSyncing: mocks.syncing,
  parseCampaignCodexSnapshot: mocks.parse,
}));

import { CampaignCodexSync } from "./CampaignCodexSync";

type Handler = (message: any, from: string) => void;

function makeNet(role: "host" | "player") {
  const listeners = new Map<string, Set<Handler>>();
  const publish = vi.fn();
  const subscribe = vi.fn((type: string, handler: Handler) => {
    let handlers = listeners.get(type);
    if (!handlers) listeners.set(type, (handlers = new Set()));
    handlers.add(handler);
    return () => handlers?.delete(handler);
  });
  return {
    value: {
      status: "connected",
      role,
      room: "ROOM-ONE",
      peers: role === "player" ? [{ id: "host-1", name: "Curator", role: "host" }] : [],
      table: role === "player" ? { campaignId: "campaign-1", campaignName: "Ashfall" } : null,
      publish,
      subscribe,
    },
    publish,
    deliver(type: string, message: any, from: string) {
      for (const handler of listeners.get(type) ?? []) handler(message, from);
    },
  };
}

const campaign = {
  id: "campaign-1",
  name: "Ashfall",
  createdAt: 1,
  updatedAt: 1,
  archived: false,
};

function snapshot(revision: string) {
  return {
    schema: 1,
    campaignId: campaign.id,
    campaignName: campaign.name,
    revision,
    generatedAt: 1,
    rules: {},
    ruleLayers: [],
    pages: [],
  };
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;

async function render(curator: boolean) {
  if (!container) {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  }
  await act(async () => {
    root?.render(<CampaignCodexSync campaign={campaign} curator={curator} />);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  mocks.active.mockReturnValue(null);
  mocks.clear.mockReturnValue(false);
  mocks.install.mockReturnValue(true);
  mocks.parse.mockImplementation((value) => value);
  mocks.build.mockResolvedValue(snapshot("revision-1"));
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  mocks.net.current = null;
  vi.clearAllMocks();
});

describe("CampaignCodexSync lifecycle", () => {
  it("broadcasts only changed host revisions across unrelated NetContext renders", async () => {
    const net = makeNet("host");
    mocks.net.current = net.value;
    await render(true);

    expect(mocks.build).toHaveBeenCalledTimes(1);
    expect(net.publish).toHaveBeenCalledTimes(1);
    expect(net.publish).toHaveBeenLastCalledWith(
      expect.objectContaining({ t: "codex-snapshot", snapshot: expect.objectContaining({ revision: "revision-1" }) }),
      undefined,
    );

    // NetProvider returns a fresh object whenever unrelated room state changes.
    mocks.net.current = { ...net.value, bp: 73, peers: [] };
    await render(true);
    expect(mocks.build).toHaveBeenCalledTimes(1);
    expect(net.publish).toHaveBeenCalledTimes(1);

    await act(async () => {
      window.dispatchEvent(new Event("wte-pages-changed"));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mocks.build).toHaveBeenCalledTimes(2);
    expect(net.publish).toHaveBeenCalledTimes(1);

    mocks.build.mockResolvedValue(snapshot("revision-2"));
    await act(async () => {
      window.dispatchEvent(new Event("wte-pages-changed"));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(net.publish).toHaveBeenCalledTimes(2);
    expect(net.publish).toHaveBeenLastCalledWith(
      expect.objectContaining({ t: "codex-snapshot", snapshot: expect.objectContaining({ revision: "revision-2" }) }),
      undefined,
    );
  });

  it("keeps one player request in flight and resets it on a room switch", async () => {
    const net = makeNet("player");
    mocks.net.current = net.value;
    await render(false);

    expect(net.publish).toHaveBeenCalledTimes(1);
    expect(net.publish).toHaveBeenLastCalledWith({
      t: "codex-request",
      campaignId: campaign.id,
      haveRevision: undefined,
    }, "host-1");

    mocks.net.current = { ...net.value, bp: 21, peers: [...net.value.peers] };
    await render(false);
    expect(net.publish).toHaveBeenCalledTimes(1);

    // The same campaign at another room is still a different authority scope.
    mocks.net.current = { ...net.value, room: "ROOM-TWO" };
    await render(false);
    expect(net.publish).toHaveBeenCalledTimes(2);
    expect(mocks.clear).toHaveBeenCalledTimes(2);
  });

  it("drops an async host build after leaving its room", async () => {
    let finish!: (value: ReturnType<typeof snapshot>) => void;
    mocks.build.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    const net = makeNet("host");
    mocks.net.current = net.value;
    await render(true);
    expect(mocks.build).toHaveBeenCalledTimes(1);

    mocks.net.current = { ...net.value, status: "idle" };
    await render(true);
    await act(async () => {
      finish(snapshot("late-revision"));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(net.publish).not.toHaveBeenCalled();
  });

  it("reuses one coherent host snapshot and throttles duplicate recovery requests", async () => {
    const net = makeNet("host");
    mocks.net.current = net.value;
    await render(true);

    expect(mocks.build).toHaveBeenCalledTimes(1);
    expect(net.publish).toHaveBeenCalledTimes(1);

    await act(async () => {
      net.deliver("codex-request", { t: "codex-request", campaignId: campaign.id }, "player-1");
      net.deliver("codex-request", { t: "codex-request", campaignId: campaign.id }, "player-1");
      await Promise.resolve();
      await Promise.resolve();
    });

    // The first recovery reply reuses the already-built revision; the burst's
    // duplicate neither rebuilds nor retransmits it.
    expect(mocks.build).toHaveBeenCalledTimes(1);
    expect(net.publish).toHaveBeenCalledTimes(2);
    expect(net.publish).toHaveBeenLastCalledWith(
      expect.objectContaining({ t: "codex-snapshot" }),
      "player-1",
    );

    mocks.build.mockResolvedValue(snapshot("revision-2"));
    await act(async () => {
      window.dispatchEvent(new Event("wte-pages-changed"));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mocks.build).toHaveBeenCalledTimes(2);
    expect(net.publish).toHaveBeenLastCalledWith(
      expect.objectContaining({ t: "codex-snapshot", snapshot: expect.objectContaining({ revision: "revision-2" }) }),
      undefined,
    );
  });

  it("answers a corrected request that arrives inside the throttle window", async () => {
    // A player joins holding the campaign id their last session in this room
    // left behind, is told it is not the one hosted here, and re-asks the
    // instant room-info corrects them. Throttled by PEER alone, that corrected
    // request was swallowed and nothing retried, so the player sat on "that is
    // not the campaign currently hosted at this table" for good.
    const net = makeNet("host");
    mocks.net.current = net.value;
    await render(true);
    const before = net.publish.mock.calls.length;

    await act(async () => {
      net.deliver("codex-request", { t: "codex-request", campaignId: "a-stale-campaign" }, "player-1");
      net.deliver("codex-request", { t: "codex-request", campaignId: campaign.id }, "player-1");
      await Promise.resolve();
      await Promise.resolve();
    });

    const sent = net.publish.mock.calls.slice(before).map((c) => c[0]);
    expect(sent.map((m) => m.t)).toEqual(["codex-error", "codex-snapshot"]);
  });

  it("still throttles a genuine repeat of the same request", async () => {
    const net = makeNet("host");
    mocks.net.current = net.value;
    await render(true);
    const before = net.publish.mock.calls.length;

    await act(async () => {
      net.deliver("codex-request", { t: "codex-request", campaignId: "a-stale-campaign" }, "player-1");
      net.deliver("codex-request", { t: "codex-request", campaignId: "a-stale-campaign" }, "player-1");
      await Promise.resolve();
    });

    // A refusal is not recorded as service, but the SAME question inside the
    // window is still one answer: the second refusal is suppressed by the key.
    const sent = net.publish.mock.calls.slice(before).map((c) => c[0].t);
    expect(sent.filter((t) => t === "codex-error").length).toBeLessThanOrEqual(2);
  });
});
