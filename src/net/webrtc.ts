// WebRTC transport: RTCPeerConnection data channels brokered by the room-code
// signaling server. Host-authoritative STAR — the host offers a connection to each
// player; players answer and only ever connect to the host. Plugs into the Transport
// interface so NetSession is unaware of any of this. See docs/NETPLAY.md.
import type { Envelope } from "./protocol";
import type { Transport } from "./transport";
import { ChunkAssembler, frameChunks } from "./chunking";

type Role = "host" | "player";
interface SignalData {
  sdp?: RTCSessionDescriptionInit;
  ice?: RTCIceCandidateInit;
}
interface SignalIn {
  t: "joined" | "peer-join" | "peer-leave" | "signal" | "error";
  peers?: { peer: string; role: Role; name: string }[];
  peer?: string;
  role?: Role;
  from?: string;
  data?: SignalData;
  message?: string;
}

export interface WebRtcOpts {
  signalUrl: string;
  room: string;
  peerId: string;
  role: Role;
  name: string;
  iceServers: RTCIceServer[];
}

interface PeerConn {
  pc: RTCPeerConnection;
  ch?: RTCDataChannel;
  /** Reassembles chunked large messages (scene snapshots with map art). */
  rx?: ChunkAssembler;
  tx?: string[];
  txChars?: number;
}

const MAX_BUFFERED_AMOUNT = 1024 * 1024;
const BUFFERED_LOW_WATER = 256 * 1024;
const MAX_QUEUED_CHARS = 26 * 1024 * 1024;

export class WebRtcTransport implements Transport {
  readonly id: string;
  private ws?: WebSocket;
  private peers = new Map<string, PeerConn>();
  private envCbs: ((env: Envelope) => void)[] = [];
  private upCbs: ((id: string) => void)[] = [];
  private downCbs: ((id: string) => void)[] = [];
  private errorCbs: ((error: Error) => void)[] = [];
  private signalRoles = new Map<string, Role>();
  private openedChannel = false;

  constructor(private opts: WebRtcOpts) {
    this.id = opts.peerId;
  }

  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const ws = new WebSocket(this.opts.signalUrl);
      this.ws = ws;
      ws.onopen = () => {
        ws.send(JSON.stringify({ t: "join", room: this.opts.room, peer: this.opts.peerId, role: this.opts.role, name: this.opts.name }));
      };
      ws.onerror = () => {
        const error = new Error("Could not reach the signaling server.");
        if (!settled) {
          settled = true;
          reject(error);
        } else this.errorCbs.forEach((cb) => cb(error));
      };
      ws.onclose = () => {
        if (!settled) {
          settled = true;
          reject(new Error("The signaling server closed before the room was joined."));
        } else if (!this.openedChannel) {
          this.errorCbs.forEach((cb) => cb(new Error("Signaling closed before the peer connection completed.")));
        }
      };
      ws.onmessage = (ev) => {
        let message: SignalIn;
        try {
          message = JSON.parse(ev.data as string) as SignalIn;
        } catch {
          return;
        }
        if (message.t === "joined" && !settled) {
          settled = true;
          resolve();
        } else if (message.t === "error" && !settled) {
          settled = true;
          reject(new Error(message.message || "The signaling server rejected the connection."));
        }
        this.onSignal(message);
      };
    });
  }

  private onSignal(m: SignalIn): void {
    switch (m.t) {
      case "joined":
        this.signalRoles = new Map((m.peers || []).map((peer) => [peer.peer, peer.role]));
        // The host initiates to everyone already present; players wait for the offer.
        if (this.opts.role === "host") for (const p of m.peers || []) if (p.role === "player") void this.connectTo(p.peer, true);
        break;
      case "peer-join":
        if (m.peer && m.role) this.signalRoles.set(m.peer, m.role);
        if (this.opts.role === "host" && m.peer && m.role === "player") void this.connectTo(m.peer, true);
        break;
      case "peer-leave":
        if (m.peer) {
          this.signalRoles.delete(m.peer);
          this.dropPeer(m.peer);
        }
        break;
      case "signal":
        if (
          m.from && m.data &&
          (this.opts.role === "host" ? this.signalRoles.get(m.from) === "player" : this.signalRoles.get(m.from) === "host")
        ) void this.onPeerSignal(m.from, m.data);
        break;
      case "error":
        this.errorCbs.forEach((cb) => cb(new Error(m.message || "The signaling server rejected the connection.")));
        break;
    }
  }

  private ensurePc(remote: string): RTCPeerConnection {
    const existing = this.peers.get(remote);
    if (existing) return existing.pc;
    const pc = new RTCPeerConnection({ iceServers: this.opts.iceServers });
    this.peers.set(remote, { pc });
    pc.onicecandidate = (e) => {
      if (e.candidate) this.signal(remote, { ice: e.candidate.toJSON() });
    };
    pc.ondatachannel = (e) => this.bindChannel(remote, e.channel);
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "failed" || pc.connectionState === "closed") this.dropPeer(remote);
    };
    return pc;
  }

  private async connectTo(remote: string, initiator: boolean): Promise<void> {
    if (remote === this.id) return;
    const pc = this.ensurePc(remote);
    if (initiator) {
      this.bindChannel(remote, pc.createDataChannel("wte"));
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      this.signal(remote, { sdp: pc.localDescription!.toJSON() });
    }
  }

  private async onPeerSignal(from: string, data: SignalData): Promise<void> {
    const pc = this.ensurePc(from);
    if (data.sdp) {
      await pc.setRemoteDescription(data.sdp);
      if (data.sdp.type === "offer") {
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        this.signal(from, { sdp: pc.localDescription!.toJSON() });
      }
    } else if (data.ice) {
      try {
        await pc.addIceCandidate(data.ice);
      } catch {
        /* candidate can arrive before remote description; browsers tolerate loss */
      }
    }
  }

  private bindChannel(remote: string, ch: RTCDataChannel): void {
    const entry = this.peers.get(remote);
    const rx = new ChunkAssembler();
    if (entry) {
      entry.ch = ch;
      entry.rx = rx;
      entry.tx = [];
      entry.txChars = 0;
    }
    ch.bufferedAmountLowThreshold = BUFFERED_LOW_WATER;
    ch.onopen = () => {
      this.openedChannel = true;
      if (entry) this.flushOutbound(entry);
      this.upCbs.forEach((cb) => cb(remote));
    };
    ch.onbufferedamountlow = () => entry && this.flushOutbound(entry);
    ch.onclose = () => this.downCbs.forEach((cb) => cb(remote));
    ch.onmessage = (e) => {
      try {
        const payload = rx.feed(e.data as string);
        if (payload === null) return; // partial chunk — keep accumulating
        const env = JSON.parse(payload) as Envelope;
        // On the host, the physical channel is the sender identity. A player
        // receives host-attested relays through its single host channel, where
        // the original author in `from` may legitimately differ.
        if (this.opts.role === "host" && env.from !== remote) return;
        this.envCbs.forEach((cb) => cb(env));
      } catch {
        /* ignore malformed frame */
      }
    };
  }

  private dropPeer(remote: string): void {
    const entry = this.peers.get(remote);
    if (!entry) return;
    try {
      entry.ch?.close();
      entry.pc.close();
    } catch {
      /* already gone */
    }
    this.peers.delete(remote);
    this.downCbs.forEach((cb) => cb(remote));
  }

  private signal(to: string, data: SignalData): void {
    try {
      this.ws?.send(JSON.stringify({ t: "signal", to, data }));
    } catch {
      /* ws closed */
    }
  }

  /** Send a payload down one channel, chunking anything past the safe SCTP
   *  message floor — an oversized send can kill the entire channel. */
  private sendRaw(entry: PeerConn, payload: string): void {
    const frames = frameChunks(payload);
    if (!frames.length || !entry.ch || entry.ch.readyState !== "open") return;
    const queuedChars = entry.txChars ?? 0;
    const addedChars = frames.reduce((sum, frame) => sum + frame.length, 0);
    if (queuedChars + addedChars > MAX_QUEUED_CHARS) return;
    (entry.tx ??= []).push(...frames);
    entry.txChars = queuedChars + addedChars;
    this.flushOutbound(entry);
  }

  private flushOutbound(entry: PeerConn): void {
    const ch = entry.ch;
    const queue = entry.tx;
    if (!ch || ch.readyState !== "open" || !queue) return;
    while (queue.length && ch.bufferedAmount < MAX_BUFFERED_AMOUNT) {
      const frame = queue.shift()!;
      entry.txChars = Math.max(0, (entry.txChars ?? 0) - frame.length);
      try {
        ch.send(frame);
      } catch {
        queue.length = 0;
        entry.txChars = 0;
        return;
      }
    }
  }

  send(env: Envelope): void {
    const payload = JSON.stringify(env);
    if (env.to) {
      const e = this.peers.get(env.to);
      if (e?.ch?.readyState === "open") {
        this.sendRaw(e, payload);
        return;
      }
      // Target not directly connected (e.g. a player whispering to another player) →
      // fall through to every channel; in the star that reaches the host, which forwards.
    }
    for (const e of this.peers.values()) if (e.ch?.readyState === "open") this.sendRaw(e, payload);
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
  onError(cb: (error: Error) => void): void {
    this.errorCbs.push(cb);
  }
  close(): void {
    for (const e of this.peers.values()) {
      try {
        e.ch?.close();
        e.pc.close();
      } catch {
        /* ignore */
      }
    }
    this.peers.clear();
    this.signalRoles.clear();
    try {
      this.ws?.close();
    } catch {
      /* ignore */
    }
  }
}
