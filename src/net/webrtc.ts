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
}

export class WebRtcTransport implements Transport {
  readonly id: string;
  private ws?: WebSocket;
  private peers = new Map<string, PeerConn>();
  private envCbs: ((env: Envelope) => void)[] = [];
  private upCbs: ((id: string) => void)[] = [];
  private downCbs: ((id: string) => void)[] = [];

  constructor(private opts: WebRtcOpts) {
    this.id = opts.peerId;
  }

  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.opts.signalUrl);
      this.ws = ws;
      ws.onopen = () => {
        ws.send(JSON.stringify({ t: "join", room: this.opts.room, peer: this.opts.peerId, role: this.opts.role, name: this.opts.name }));
        resolve();
      };
      ws.onerror = () => reject(new Error("Could not reach the signaling server."));
      ws.onmessage = (ev) => this.onSignal(JSON.parse(ev.data as string) as SignalIn);
    });
  }

  private onSignal(m: SignalIn): void {
    switch (m.t) {
      case "joined":
        // The host initiates to everyone already present; players wait for the offer.
        if (this.opts.role === "host") for (const p of m.peers || []) void this.connectTo(p.peer, true);
        break;
      case "peer-join":
        if (this.opts.role === "host" && m.peer) void this.connectTo(m.peer, true);
        break;
      case "peer-leave":
        if (m.peer) this.dropPeer(m.peer);
        break;
      case "signal":
        if (m.from && m.data) void this.onPeerSignal(m.from, m.data);
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
    }
    ch.onopen = () => this.upCbs.forEach((cb) => cb(remote));
    ch.onclose = () => this.downCbs.forEach((cb) => cb(remote));
    ch.onmessage = (e) => {
      try {
        const payload = rx.feed(e.data as string);
        if (payload === null) return; // partial chunk — keep accumulating
        const env = JSON.parse(payload) as Envelope;
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
  private sendRaw(ch: RTCDataChannel, payload: string): void {
    for (const frame of frameChunks(payload)) {
      try {
        ch.send(frame);
      } catch {
        return; // send queue overrun — drop the rest of this message, keep the channel
      }
    }
  }

  send(env: Envelope): void {
    const payload = JSON.stringify(env);
    if (env.to) {
      const e = this.peers.get(env.to);
      if (e?.ch?.readyState === "open") {
        this.sendRaw(e.ch, payload);
        return;
      }
      // Target not directly connected (e.g. a player whispering to another player) →
      // fall through to every channel; in the star that reaches the host, which forwards.
    }
    for (const e of this.peers.values()) if (e.ch?.readyState === "open") this.sendRaw(e.ch, payload);
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
    for (const e of this.peers.values()) {
      try {
        e.ch?.close();
        e.pc.close();
      } catch {
        /* ignore */
      }
    }
    this.peers.clear();
    try {
      this.ws?.close();
    } catch {
      /* ignore */
    }
  }
}
