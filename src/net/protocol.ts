// Wire protocol for W.T.E netplay. Transport-agnostic — the same envelopes ride
// WebRTC data channels (LAN via mDNS, internet via the signaling server) today, and
// could ride any future transport. See docs/NETPLAY.md.

import type { DeskNote } from "../lib/campaignDesk";
import type { InvItem } from "../game/tableInventory";

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
  | { t: "room-locked" } // host refused the join — the room is locked
  // host → room: card info for saved rooms, plus WHICH CAMPAIGN this table is, so
  // a joining player's app points itself at the Curator's campaign.
  | { t: "room-info"; nextSession?: string; campaignId?: string; campaignName?: string; sceneName?: string }
  | { t: "peer-join"; peer: Peer }
  | { t: "peer-leave"; peerId: string }
  | { t: "presence"; status: string }
  | { t: "roll"; label: string; formula: string; result: number; detail?: unknown; id?: string }
  | { t: "chat"; text: string }
  | { t: "party"; charId: string; name: string; summary: Record<string, unknown> }
  | { t: "bp"; value: number } // shared Base Pressure for the table
  | { t: "unit-note"; op: "upsert" | "delete" | "sync"; note?: DeskNote; id?: string; notes?: DeskNote[] } // shared party notes
  // Money, in Shrives. "mine" = a player announcing their own purse (the Curator
  // collects them); "unit" = the shared party purse; "grant" = the Curator paying
  // someone; "request" = tell everyone to re-announce (late join).
  | { t: "purse"; op: "mine" | "unit" | "grant" | "request"; shrives?: number; charName?: string; peerId?: string }
  // Carried items. "mine" = a player's personal list (the Curator collects them);
  // "unit" = the shared party stash; "request" = re-announce (late join).
  | { t: "inv"; op: "mine" | "unit" | "request"; items?: InvItem[]; charName?: string }
  | { t: "sheet-patch"; charId: string; patch: unknown; rev: number } // reserved: sheet sync
  | { t: "sheet-request" } // Curator → players: push me your characters so I can open/edit them
  | { t: "vtt-patch"; scope: string; patch: unknown; rev: number } // reserved: VTT sync
  | { t: "snapshot"; state: unknown; rev: number } // reserved: late-joiner catch-up
  | { t: "ping"; ts: number }
  | { t: "pong"; ts: number }
  // Table audio: the Curator's soundboard reaches every player. `uri` (a data
  // URL, rides the chunked transport) is included the FIRST time a clip plays
  // this session; repeats reference the receiver's cache by id.
  | { t: "sfx"; action: "play" | "loop" | "stop" | "stopall"; id: string; name?: string; uri?: string; volume?: number }
  // "Look here" — a transient pulse at a world point, in the pinger's ink color.
  | { t: "vtt-ping"; x: number; y: number }
  // Curator's Play Mode: players' UI collapses to token movement + rolls, their
  // camera follows their token, zoom-out clamped to `range` (0.1..1 of normal).
  | { t: "play-mode"; on: boolean; range: number }
  // Cinematic Mode — the director's cut: lock every player's camera onto a
  // token (follows as it moves), shake the frame, and run a full-screen GLSL
  // effect (validated per client; bad bodies fall back to none).
  | { t: "cine"; on: boolean; tokenId?: string; glsl?: string; shake?: number };

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
  "vtt-ping",
  // Shared table state. These were missing, which meant a value changed by a
  // PLAYER only ever reached the host — the other players never converged, even
  // though bp and unit-note are documented as shared across the room. Anything
  // every client is meant to agree on has to be relayed.
  "bp",
  "unit-note",
  "purse",
  "inv",
]);
