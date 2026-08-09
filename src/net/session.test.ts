import { describe, expect, it } from "vitest";
import { PROTOCOL_VERSION, type Envelope } from "./protocol";
import { NetSession } from "./session";
import type { Transport } from "./transport";

class ManualTransport implements Transport {
  readonly sent: Envelope[] = [];
  private envelopes: ((env: Envelope) => void)[] = [];
  private ups: ((id: string) => void)[] = [];
  private downs: ((id: string) => void)[] = [];

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
  peerDown(id: string): void {
    this.downs.forEach((cb) => cb(id));
  }
  deliver(env: Envelope): void {
    this.envelopes.forEach((cb) => cb(env));
  }
}

function envelope(from: string, msg: Envelope["msg"]): Envelope {
  return { v: PROTOCOL_VERSION, from, ts: 1, msg };
}

describe("NetSession readiness", () => {
  it("queues player publishes until the host welcome handshake", async () => {
    const transport = new ManualTransport("player-1");
    const session = new NetSession(transport, { name: "Player", role: "player" });
    await session.start();

    session.publish({ t: "chat", text: "after welcome" });
    expect(transport.sent).toEqual([]);
    expect(session.isReady()).toBe(false);

    transport.peerUp("host-1");
    expect(transport.sent.map((e) => e.msg.t)).toEqual(["hello"]);

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
    expect(session.isReady()).toBe(true);
    expect(transport.sent.map((e) => e.msg.t)).toEqual(["hello", "chat"]);
  });

  it("makes a host ready as soon as its transport starts", async () => {
    const transport = new ManualTransport("host-1");
    const session = new NetSession(transport, { name: "Curator", role: "host" });
    await session.start();
    await session.whenReady();
    expect(session.isReady()).toBe(true);
    expect(session.roster()).toEqual([{ id: "host-1", name: "Curator", role: "host" }]);
  });

  it("rejects readiness when the host refuses a room", async () => {
    const transport = new ManualTransport("player-1");
    const session = new NetSession(transport, { name: "Player", role: "player" });
    await session.start();
    const waiting = session.whenReady();
    transport.deliver(envelope("host-1", { t: "room-locked" }));
    await expect(waiting).rejects.toThrow("locked");
  });

  it("rejects an incompatible welcome instead of connecting with broken movement semantics", async () => {
    const transport = new ManualTransport("player-1");
    const session = new NetSession(transport, { name: "Player", role: "player" });
    await session.start();
    const waiting = session.whenReady();
    transport.deliver({
      v: PROTOCOL_VERSION - 1,
      from: "old-host",
      ts: 1,
      msg: { t: "welcome", you: "player-1", host: "old-host", peers: [], protocol: PROTOCOL_VERSION - 1 },
    });
    await expect(waiting).rejects.toThrow("incompatible");
  });

  it("ignores a player's attempt to kick a ready host with room-locked", async () => {
    const transport = new ManualTransport("host-1");
    const session = new NetSession(transport, { name: "Curator", role: "host" });
    await session.start();
    let kicked = false;
    session.on("room-locked", () => { kicked = true; });
    transport.deliver(envelope("attacker", { t: "room-locked" }));
    expect(kicked).toBe(false);
    expect(session.isReady()).toBe(true);
  });

  it("surfaces host loss instead of leaving a player falsely connected", async () => {
    const transport = new ManualTransport("player-1");
    const session = new NetSession(transport, { name: "Player", role: "player" });
    await session.start();
    transport.peerUp("host-1");
    transport.deliver(envelope("host-1", {
      t: "welcome",
      you: "player-1",
      host: "host-1",
      peers: [{ id: "host-1", name: "Curator", role: "host" }],
      protocol: PROTOCOL_VERSION,
    }));
    await session.whenReady();
    let fatal = "";
    session.onFatal((error) => { fatal = error.message; });

    transport.peerDown("host-1");

    expect(fatal).toContain("Curator disconnected");
    expect(session.roster().some((peer) => peer.id === "host-1")).toBe(false);
  });

  it("rejects readiness when the pre-welcome data channel closes", async () => {
    const transport = new ManualTransport("player-1");
    const session = new NetSession(transport, { name: "Player", role: "player" });
    await session.start();
    const waiting = session.whenReady();
    transport.peerUp("host-1");
    transport.peerDown("host-1");
    await expect(waiting).rejects.toThrow("before the Curator welcome");
  });
});
