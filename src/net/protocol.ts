// Wire protocol for W.T.E netplay. Transport-agnostic — the same envelopes ride
// WebRTC data channels (LAN via mDNS, internet via the signaling server) today, and
// could ride any future transport. See docs/NETPLAY.md.

export const PROTOCOL_VERSION = 1;

export type Role = "host" | "player";

export interface Peer {
  id: string;
  name: string;
  role: Role;
}

// The message set. VTT/sheet sync types are reserved now so the protocol stays
// stable as we wire them — we extend payloads, not the envelope.
export type NetMessage =
  | { t: "hello"; name: string; role: Role; protocol: number }
  | { t: "welcome"; you: string; host: string; peers: Peer[] }
  | { t: "peer-join"; peer: Peer }
  | { t: "peer-leave"; peerId: string }
  | { t: "presence"; status: string }
  | { t: "roll"; label: string; formula: string; result: number; detail?: unknown }
  | { t: "chat"; text: string }
  | { t: "party"; charId: string; name: string; summary: Record<string, unknown> }
  | { t: "bp"; value: number } // shared Base Pressure for the table
  | { t: "sheet-patch"; charId: string; patch: unknown; rev: number } // reserved: sheet sync
  | { t: "vtt-patch"; scope: string; patch: unknown; rev: number } // reserved: VTT sync
  | { t: "snapshot"; state: unknown; rev: number } // reserved: late-joiner catch-up
  | { t: "ping"; ts: number }
  | { t: "pong"; ts: number };

export type NetMessageType = NetMessage["t"];

export interface Envelope {
  v: number; // protocol version
  from: string; // sender peer id
  to?: string; // targeted peer id; omitted = broadcast
  ts: number;
  msg: NetMessage;
}

// App-level shared events the host relays from a player to the rest of the room.
// Protocol/handshake messages (hello/welcome/peer-*) are handled by the session itself.
export const RELAYED: ReadonlySet<NetMessageType> = new Set<NetMessageType>([
  "presence",
  "roll",
  "chat",
  "party",
  "sheet-patch",
  "vtt-patch",
]);
