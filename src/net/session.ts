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
  /** Host-set: a locked room refuses NEW joins (current peers stay). */
  locked = false;
  private name: string;
  private ready = false;
  private closed = false;
  private queued: { msg: NetMessage; to?: string }[] = [];
  private readyResolve!: () => void;
  private readyReject!: (error: Error) => void;
  private readonly readyPromise: Promise<void>;
  private hostId: string | null = null;
  private peers = new Map<string, Peer>();
  private handlers = new Map<NetMessageType, Set<(msg: NetMessage, from: string) => void>>();
  private readyCbs: (() => void)[] = [];
  private peersCbs: ((peers: Peer[]) => void)[] = [];
  private fatalCbs: ((error: Error) => void)[] = [];

  constructor(private transport: Transport, opts: { name: string; role: Role }) {
    this.self = transport.id;
    this.role = opts.role;
    this.name = opts.name;
    this.readyPromise = new Promise<void>((resolve, reject) => {
      this.readyResolve = resolve;
      this.readyReject = reject;
    });
    // Some callers only use onReady(); closing such a half-open session should
    // not create an unhandled rejection while whenReady() remains available.
    void this.readyPromise.catch(() => {});
  }

  async start(): Promise<void> {
    this.transport.onEnvelope((e) => this.onEnvelope(e));
    this.transport.onPeerUp((id) => this.onPeerUp(id));
    this.transport.onPeerDown((id) => this.onPeerDown(id));
    this.transport.onError?.((error) => {
      this.fail(error);
    });
    await this.transport.start();
    if (this.role === "host") {
      this.peers.set(this.self, { id: this.self, name: this.name, role: "host" });
      this.markReady();
      this.emitPeers();
    }
  }

  // ── public API ──
  isReady(): boolean {
    return this.ready;
  }
  /** Resolves only after the application handshake is complete. Transport
   *  startup merely means the signaling socket opened; players are not safe to
   *  publish until the host's welcome has arrived. */
  whenReady(): Promise<void> {
    return this.ready ? Promise.resolve() : this.readyPromise;
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
  /** Fatal transport/session loss. Normal caller-initiated close does not fire. */
  onFatal(cb: (error: Error) => void): void {
    this.fatalCbs.push(cb);
  }
  on<T extends NetMessageType>(t: T, cb: MsgHandler<T>): void {
    let set = this.handlers.get(t);
    if (!set) this.handlers.set(t, (set = new Set()));
    set.add(cb as (msg: NetMessage, from: string) => void);
  }

  /** Publish a shared message. `to` = a peer id to whisper to, or undefined to broadcast.
   *  In the star a player's transport sends over its single (host) channel; the host routes. */
  publish(msg: NetMessage, to?: string): void {
    if (this.closed) return;
    if (!this.ready) {
      // Keep a bounded queue so an unreachable room cannot grow memory forever.
      if (this.queued.length >= 200) this.queued.shift();
      this.queued.push({ msg, to });
      return;
    }
    this.send(to, msg);
  }
  close(): void {
    if (this.closed) return;
    this.closed = true;
    if (!this.ready) this.readyReject(new Error("The netplay session closed before it was ready."));
    this.queued = [];
    this.transport.close();
  }

  // ── internals ──
  private send(to: string | undefined, msg: NetMessage): void {
    this.transport.send({ v: PROTOCOL_VERSION, from: this.self, to, ts: Date.now(), msg });
  }
  private emitReady(): void {
    for (const cb of this.readyCbs) cb();
  }
  private markReady(): void {
    if (this.ready || this.closed) return;
    this.ready = true;
    this.readyResolve();
    this.emitReady();
    const queued = this.queued;
    this.queued = [];
    for (const item of queued) this.send(item.to, item.msg);
  }
  private emitPeers(): void {
    const list = this.roster();
    for (const cb of this.peersCbs) cb(list);
  }
  private fail(error: Error): void {
    if (this.closed) return;
    this.closed = true;
    this.queued = [];
    if (!this.ready) this.readyReject(error);
    this.transport.close();
    for (const cb of this.fatalCbs) cb(error);
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
    if (this.role === "player" && (!this.ready || id === this.hostId)) {
      this.fail(new Error(this.ready ? "The Curator disconnected from the table." : "The table connection closed before the Curator welcome arrived."));
    }
  }

  private onEnvelope(env: Envelope): void {
    const { msg, from } = env;
    switch (msg.t) {
      case "hello": {
        if (this.role !== "host" || from === this.self || msg.role !== "player") return;
        if (env.v !== PROTOCOL_VERSION || msg.protocol !== PROTOCOL_VERSION) {
          this.send(from, { t: "protocol-mismatch", expected: PROTOCOL_VERSION, received: msg.protocol });
          return;
        }
        if (this.locked) {
          this.send(from, { t: "room-locked" });
          return; // never welcomed — the joiner surfaces the refusal and leaves
        }
        const peer: Peer = { id: from, name: msg.name, role: msg.role };
        this.peers.set(from, peer);
        this.send(from, { t: "welcome", you: from, host: this.self, peers: this.roster(), protocol: PROTOCOL_VERSION });
        for (const p of this.peers.values())
          if (p.id !== from && p.id !== this.self) this.send(p.id, { t: "peer-join", peer });
        this.emitPeers();
        return;
      }
      case "welcome": {
        if (this.role !== "player" || this.ready || msg.you !== this.self || msg.host !== from || env.v !== PROTOCOL_VERSION || msg.protocol !== PROTOCOL_VERSION) {
          if (this.role === "player" && !this.ready) this.readyReject(new Error("This table is using an incompatible netplay version."));
          return;
        }
        this.hostId = from;
        this.peers = new Map(msg.peers.map((p) => [p.id, { ...p, role: p.id === from ? "host" as const : "player" as const }]));
        this.peers.set(from, { id: from, name: this.peers.get(from)?.name || "Curator", role: "host" });
        this.peers.set(this.self, { id: this.self, name: this.name, role: "player" });
        this.markReady();
        this.emitPeers();
        return;
      }
      case "protocol-mismatch": {
        if (this.role === "player" && !this.ready) {
          this.queued = [];
          this.readyReject(new Error(`Netplay version mismatch (this app uses ${PROTOCOL_VERSION}; the table expected ${msg.expected}).`));
        }
        return;
      }
      case "room-locked": {
        if (this.role !== "player" || this.ready) return;
        this.fire("room-locked", msg, from);
        if (!this.ready) {
          this.queued = [];
          this.readyReject(new Error("That room is locked by its host."));
        }
        return;
      }
      case "peer-join": {
        if (this.role !== "player" || from !== this.hostId || msg.peer.role === "host") return;
        this.peers.set(msg.peer.id, msg.peer);
        this.emitPeers();
        return;
      }
      case "peer-leave": {
        if (this.role !== "player" || from !== this.hostId) return;
        this.peers.delete(msg.peerId);
        this.fire("peer-leave", msg, from);
        this.emitPeers();
        return;
      }
      default: {
        if (env.v !== PROTOCOL_VERSION || !this.ready) return;
        if (this.role === "host") {
          const sender = this.peers.get(from);
          if (!sender || sender.role !== "player") return;
        } else if (!this.peers.has(from)) {
          return;
        }
        // Players have no direct channels to one another and every legitimate
        // player intent targets the host. Never blindly forward a peer-authored
        // whisper to a different client.
        if (this.role === "host" && env.to && env.to !== this.self) {
          return;
        }
        // Deliver to the app if it's a broadcast or addressed to me.
        if (!env.to || env.to === this.self) this.fire(msg.t, msg, from);
        // Host rebroadcasts a player's non-targeted shared message to the rest of the room.
        if (this.role === "host" && !env.to && RELAYED.has(msg.t) && from !== this.self) {
          for (const p of this.peers.values())
            if (p.id !== from && p.id !== this.self) this.transport.send({ ...env, to: p.id });
        }
      }
    }
  }
}
