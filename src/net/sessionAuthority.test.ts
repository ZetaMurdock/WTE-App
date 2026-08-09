import { describe, expect, it } from "vitest";
import { PROTOCOL_VERSION, type Envelope } from "./protocol";
import { NetSession } from "./session";
import type { Transport } from "./transport";

class ManualTransport implements Transport {
  readonly sent: Envelope[] = [];
  private readonly envelopes: ((env: Envelope) => void)[] = [];
  private readonly ups: ((id: string) => void)[] = [];
  private readonly downs: ((id: string) => void)[] = [];

  constructor(readonly id: string) {}
  async start(): Promise<void> {}
  send(env: Envelope): void {
    this.sent.push(env);
  }
  onEnvelope(cb: (env: Envelope) => void): void {
    this.envelopes.push(cb);
  }
  onPeerUp(cb: (peerId: string) => void): void {
    this.ups.push(cb);
  }
  onPeerDown(cb: (peerId: string) => void): void {
    this.downs.push(cb);
  }
  close(): void {}
  peerUp(id: string): void {
    this.ups.forEach((cb) => cb(id));
  }
  deliver(env: Envelope): void {
    this.envelopes.forEach((cb) => cb(env));
  }
}

const envelope = (from: string, msg: Envelope["msg"], to?: string): Envelope => ({ v: PROTOCOL_VERSION, from, to, ts: 1, msg });
const request = {
  t: "vtt-move-request" as const,
  requestId: "move-1",
  scope: "scene-1",
  tokenId: "token-1",
  fromX: 5,
  fromY: 5,
  toX: 15,
  toY: 5,
};

describe("movement session authority", () => {
  it("preserves a queued movement request's host target until welcome", async () => {
    const transport = new ManualTransport("player-1");
    const session = new NetSession(transport, { name: "Player", role: "player" });
    await session.start();

    session.publish(request, "host-1");
    expect(transport.sent).toEqual([]);

    transport.peerUp("host-1");
    transport.deliver(
      envelope("host-1", {
        t: "welcome",
        you: "player-1",
        host: "host-1",
        peers: [{ id: "host-1", name: "Curator", role: "host" }],
        protocol: PROTOCOL_VERSION,
      })
    );
    await session.whenReady();

    expect(transport.sent[transport.sent.length - 1]).toMatchObject({ from: "player-1", to: "host-1", msg: request });
  });

  it("delivers a movement intent to the host app without relaying it to peers", async () => {
    const transport = new ManualTransport("host-1");
    const session = new NetSession(transport, { name: "Curator", role: "host" });
    await session.start();
    transport.deliver(envelope("player-1", { t: "hello", name: "One", role: "player", protocol: PROTOCOL_VERSION }));
    transport.deliver(envelope("player-2", { t: "hello", name: "Two", role: "player", protocol: PROTOCOL_VERSION }));
    transport.sent.length = 0;

    const received: string[] = [];
    session.on("vtt-move-request", (_message, from) => received.push(from));
    transport.deliver(envelope("player-1", request));

    expect(received).toEqual(["player-1"]);
    expect(transport.sent).toEqual([]);
  });

  it("delivers snapshot recovery to the host without relaying it to peers", async () => {
    const transport = new ManualTransport("host-1");
    const session = new NetSession(transport, { name: "Curator", role: "host" });
    await session.start();
    transport.deliver(envelope("player-1", { t: "hello", name: "One", role: "player", protocol: PROTOCOL_VERSION }));
    transport.deliver(envelope("player-2", { t: "hello", name: "Two", role: "player", protocol: PROTOCOL_VERSION }));
    transport.sent.length = 0;

    const received: string[] = [];
    session.on("vtt-snapshot-request", (_message, from) => received.push(from));
    transport.deliver(envelope("player-1", { t: "vtt-snapshot-request" }));

    expect(received).toEqual(["player-1"]);
    expect(transport.sent).toEqual([]);
  });
});
