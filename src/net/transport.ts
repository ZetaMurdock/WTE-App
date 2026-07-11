// A Transport moves opaque Envelopes between endpoints. The NetSession layer is
// unaware of whether WebRTC / mDNS / loopback sits underneath — future transports
// implement this interface and plug in without touching the session or protocol.
// See docs/NETPLAY.md.
import type { Envelope } from "./protocol";

export interface Transport {
  /** This endpoint's stable id (peer id). */
  readonly id: string;
  start(): Promise<void>;
  /** Send an envelope. `to` omitted → every connected peer. */
  send(env: Envelope): void;
  onEnvelope(cb: (env: Envelope) => void): void;
  onPeerUp(cb: (peerId: string) => void): void;
  onPeerDown(cb: (peerId: string) => void): void;
  close(): void;
}

// ── In-process transport (dev + tests) ──
// LoopbackTransports sharing a LoopbackHub deliver envelopes to each other
// synchronously. Lets us drive NetSession end-to-end before the WebRTC transport
// exists. (Fully-connected, unlike the real star; the session's relay logic is
// still exercised, just redundant here.)
export class LoopbackHub {
  private nodes = new Map<string, LoopbackTransport>();

  attach(node: LoopbackTransport): void {
    this.nodes.set(node.id, node); // register first so replies can route back during the handshake
    for (const [id, other] of this.nodes) {
      if (id === node.id) continue;
      other.notifyUp(node.id);
      node.notifyUp(other.id);
    }
  }
  detach(id: string): void {
    this.nodes.delete(id);
    for (const other of this.nodes.values()) other.notifyDown(id);
  }
  route(env: Envelope): void {
    if (env.to) {
      this.nodes.get(env.to)?.deliver(env);
      return;
    }
    for (const [id, node] of this.nodes) if (id !== env.from) node.deliver(env);
  }
}

export class LoopbackTransport implements Transport {
  private envCbs: ((env: Envelope) => void)[] = [];
  private upCbs: ((id: string) => void)[] = [];
  private downCbs: ((id: string) => void)[] = [];

  constructor(readonly id: string, private hub: LoopbackHub) {}

  async start(): Promise<void> {
    this.hub.attach(this);
  }
  send(env: Envelope): void {
    this.hub.route(env);
  }
  onEnvelope(cb: (env: Envelope) => void): void {
    this.envCbs.push(cb);
  }
  onPeerUp(cb: (id: string) => void): void {
    this.upCbs.push(cb);
  }
  onPeerDown(cb: (id: string) => void): void {
    this.downCbs.push(cb);
  }
  close(): void {
    this.hub.detach(this.id);
  }

  // ── hub → this node ──
  deliver(env: Envelope): void {
    for (const cb of this.envCbs) cb(env);
  }
  notifyUp(id: string): void {
    for (const cb of this.upCbs) cb(id);
  }
  notifyDown(id: string): void {
    for (const cb of this.downCbs) cb(id);
  }
}
