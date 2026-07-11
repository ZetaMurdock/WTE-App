// Host-authoritative room session. Players connect to a host; the host owns the
// peer roster and relays shared messages. App code publish()es intents and
// subscribes to typed events — it never touches the transport. See docs/NETPLAY.md.
import {
  PROTOCOL_VERSION,
  RELAYED,
  type Envelope,
  type NetMessage,
  type NetMessageType,
  type Peer,
  type Role,
} from "./protocol";
import type { Transport } from "./transport";

type MsgOf<T extends NetMessageType> = Extract<NetMessage, { t: T }>;
type MsgHandler<T extends NetMessageType> = (msg: MsgOf<T>, from: string) => void;

export class NetSession {
  readonly self: string;
  readonly role: Role;
  private name: string;
  private hostId = "";
  private ready = false;
  private peers = new Map<string, Peer>();
  private handlers = new Map<NetMessageType, Set<(msg: NetMessage, from: string) => void>>();
  private readyCbs: (() => void)[] = [];
  private peersCbs: ((peers: Peer[]) => void)[] = [];

  constructor(private transport: Transport, opts: { name: string; role: Role }) {
    this.self = transport.id;
    this.role = opts.role;
    this.name = opts.name;
  }

  async start(): Promise<void> {
    this.transport.onEnvelope((e) => this.onEnvelope(e));
    this.transport.onPeerUp((id) => this.onPeerUp(id));
    this.transport.onPeerDown((id) => this.onPeerDown(id));
    await this.transport.start();
    if (this.role === "host") {
      this.hostId = this.self;
      this.peers.set(this.self, { id: this.self, name: this.name, role: "host" });
      this.ready = true;
      this.emitReady();
      this.emitPeers();
    }
  }

  // ── public API ──
  isReady(): boolean {
    return this.ready;
  }
  roster(): Peer[] {
    return [...this.peers.values()];
  }
  onReady(cb: () => void): void {
    this.readyCbs.push(cb);
    if (this.ready) cb();
  }
  onPeers(cb: (peers: Peer[]) => void): void {
    this.peersCbs.push(cb);
  }
  on<T extends NetMessageType>(t: T, cb: MsgHandler<T>): void {
    let set = this.handlers.get(t);
    if (!set) this.handlers.set(t, (set = new Set()));
    set.add(cb as (msg: NetMessage, from: string) => void);
  }

  /** Publish a shared message. Players send to the host; the host broadcasts. */
  publish(msg: NetMessage, to?: string): void {
    const target = to ?? (this.role === "player" ? this.hostId : undefined);
    this.send(target, msg);
  }
  close(): void {
    this.transport.close();
  }

  // ── internals ──
  private send(to: string | undefined, msg: NetMessage): void {
    this.transport.send({ v: PROTOCOL_VERSION, from: this.self, to, ts: Date.now(), msg });
  }
  private emitReady(): void {
    for (const cb of this.readyCbs) cb();
  }
  private emitPeers(): void {
    const list = this.roster();
    for (const cb of this.peersCbs) cb(list);
  }
  private fire(t: NetMessageType, msg: NetMessage, from: string): void {
    const set = this.handlers.get(t);
    if (set) for (const cb of set) cb(msg, from);
  }

  private onPeerUp(id: string): void {
    // A player greets the first endpoint it sees (the host it dialed).
    if (this.role === "player" && !this.ready) {
      this.send(id, { t: "hello", name: this.name, role: "player", protocol: PROTOCOL_VERSION });
    }
  }
  private onPeerDown(id: string): void {
    if (this.peers.delete(id)) {
      this.fire("peer-leave", { t: "peer-leave", peerId: id }, id);
      this.emitPeers();
    }
  }

  private onEnvelope(env: Envelope): void {
    const { msg, from } = env;
    switch (msg.t) {
      case "hello": {
        if (this.role !== "host") return;
        const peer: Peer = { id: from, name: msg.name, role: msg.role };
        this.peers.set(from, peer);
        this.send(from, { t: "welcome", you: from, host: this.self, peers: this.roster() });
        for (const p of this.peers.values())
          if (p.id !== from && p.id !== this.self) this.send(p.id, { t: "peer-join", peer });
        this.emitPeers();
        return;
      }
      case "welcome": {
        this.hostId = msg.host;
        this.peers = new Map(msg.peers.map((p) => [p.id, p]));
        this.peers.set(this.self, { id: this.self, name: this.name, role: "player" });
        this.ready = true;
        this.emitReady();
        this.emitPeers();
        return;
      }
      case "peer-join": {
        this.peers.set(msg.peer.id, msg.peer);
        this.emitPeers();
        return;
      }
      case "peer-leave": {
        this.peers.delete(msg.peerId);
        this.fire("peer-leave", msg, from);
        this.emitPeers();
        return;
      }
      default: {
        this.fire(msg.t, msg, from);
        // Host relays a player's shared message to the rest of the room (star topology).
        if (this.role === "host" && RELAYED.has(msg.t) && from !== this.self) {
          for (const p of this.peers.values())
            if (p.id !== from && p.id !== this.self) this.transport.send({ ...env, to: p.id });
        }
      }
    }
  }
}
