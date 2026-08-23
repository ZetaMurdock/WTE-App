// Wire protocol for W.T.E netplay. Transport-agnostic — the same envelopes ride
// WebRTC data channels (LAN via mDNS, internet via the signaling server) today, and
// could ride any future transport. See docs/NETPLAY.md.

import type { DeskNote } from "../lib/campaignDesk";
import type { InvItem } from "../game/tableInventory";

export const PROTOCOL_VERSION = 2;

export type Role = "host" | "player";

export interface Peer {
  id: string;
  name: string;
  role: Role;
}

/** Wire-safe roll posture. Kept here instead of importing the rules engine so
 * the transport protocol stays independent from game implementation details. */
export type NetRollMode = "normal" | "adv" | "dis" | "double-adv" | "double-dis";

export interface RollModeRequestMessage {
  t: "roll-mode-request";
  requestId: string;
  mode: Exclude<NetRollMode, "normal">;
  label: string;
  actorName?: string;
}

export interface RollModeDecisionMessage {
  t: "roll-mode-decision";
  requestId: string;
  accepted: boolean;
}

/** Stable actor identity carried with a completed roll. `peerId` is useful for
 * display, while character/token ids let the host verify that a requested roll
 * was answered by the character that actually owns it. */
export interface RollActorIdentity {
  peerId?: string;
  characterId?: string;
  tokenId?: string;
  name?: string;
}

export interface CompletedRollPayload {
  /** Stable across the local feed, SQLite row, request reply, and broadcast. */
  id?: string;
  label: string;
  /** Formula as displayed after resolution (may include posture details). */
  formula: string;
  /** Unresolved expression entered/derived before dice were rolled. */
  baseExpr?: string;
  result: number;
  detail?: unknown;
  mode?: NetRollMode;
  actor?: RollActorIdentity;
  at?: number;
  /** Present when this is the answer to a Curator-issued roll request. */
  requestId?: string;
}

/** Curator -> one player (using Envelope.to): ask that player's bound
 * character to make a save/check. A named stat is intentionally sent instead
 * of a precomputed modifier; the receiver resolves it from their current sheet. */
export interface RollRequestMessage {
  t: "roll-request";
  requestId: string;
  label: string;
  stat?: string;
  dc?: number;
  targetPeerId: string;
  targetCharacterId: string;
  targetTokenId?: string;
  sourceCharacterId?: string;
  sourceAbilityId?: string;
  sourceAbilityName?: string;
  createdAt: number;
  expiresAt?: number;
}

/** Legacy-compatible room roll. New senders attach stable identity and request
 * correlation; old senders/receivers can keep using the original fields. */
export interface RollMessage extends CompletedRollPayload {
  t: "roll";
}

/** Player -> host (using Envelope.to): proposed answer to a roll request. The
 * host validates correlation/ownership and then publishes a normal `roll` to
 * the room. This message is deliberately not in RELAYED. */
export interface RollResultMessage extends CompletedRollPayload {
  t: "roll-result";
  id: string;
  requestId: string;
  baseExpr: string;
  actor: RollActorIdentity & { characterId: string; tokenId?: string };
}

/** Convert the roll tray's completed message into a host-bound requested-roll
 * result only when all correlation/ownership fields are present. */
export function asRollResultMessage(message: RollMessage): RollResultMessage | null {
  if (!message.id || !message.requestId || !message.baseExpr || !message.actor?.characterId) return null;
  return {
    ...message,
    t: "roll-result",
    id: message.id,
    requestId: message.requestId,
    baseExpr: message.baseExpr,
    actor: { ...message.actor, characterId: message.actor.characterId },
  };
}

/** Player movement is intent-only. The host serializes and validates requests,
 * then distributes one authoritative commit or a targeted visual rejection. */
export interface VttMoveRequestMessage {
  t: "vtt-move-request";
  requestId: string;
  scope: string;
  tokenId: string;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
}

export interface VttMoveCommitMessage {
  t: "vtt-move-commit";
  requestId: string;
  scope: string;
  tokenId: string;
  x: number;
  y: number;
}

export interface VttMoveRejectMessage {
  t: "vtt-move-reject";
  requestId: string;
  scope: string;
  tokenId: string;
  x: number;
  y: number;
  attemptedX: number;
  attemptedY: number;
  reason: "not-owner" | "stale" | "wall" | "occupied" | "out-of-bounds" | "invalid" | "wrong-scene";
}

// The message set. VTT/sheet sync types are reserved now so the protocol stays
// stable as we wire them — we extend payloads, not the envelope.
export type NetMessage =
  | { t: "hello"; name: string; role: Role; protocol: number }
  | { t: "welcome"; you: string; host: string; peers: Peer[]; protocol: number }
  | { t: "protocol-mismatch"; expected: number; received: number }
  | { t: "room-locked" } // host refused the join — the room is locked
  // host → room: card info for saved rooms, plus WHICH CAMPAIGN this table is, so
  // a joining player's app points itself at the Curator's campaign.
  | { t: "room-info"; nextSession?: string; campaignId?: string; campaignName?: string; sceneName?: string }
  | { t: "peer-join"; peer: Peer }
  | { t: "peer-leave"; peerId: string }
  | { t: "presence"; status: string }
  | RollRequestMessage
  | RollModeRequestMessage
  | RollModeDecisionMessage
  | RollResultMessage
  | RollMessage
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
  | { t: "vtt-snapshot-request" } // player -> host recovery after the VTT listener is mounted
  | { t: "vtt-snapshot-error"; reason: "too-large"; size: number; limit: number }
  | VttMoveRequestMessage
  | VttMoveCommitMessage
  | VttMoveRejectMessage
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
  // Visual-novel dialogue box: the Curator puts a speaker portrait + line on
  // every screen at the table. Portrait rides as a data URL, same as sfx clips.
  | { t: "dialogue"; on: boolean; speaker?: string; portrait?: string; text?: string; kind?: "speech" | "beacon" }
  // Cinematic Mode — the director's cut: lock every player's camera onto a
  // token (follows as it moves), shake the frame, and run a full-screen GLSL
  // effect (validated per client; bad bodies fall back to none).
  | { t: "cine"; on: boolean; tokenId?: string; glsl?: string; shake?: number }
  // The Curator Atlas over the wire. Players have none of the host's campaign
  // data, so the host serves the world map itself: `atlas` carries the
  // role-FILTERED document (curator-only material never leaves the host;
  // receivers re-validate with parseAtlas like any untrusted input, and big
  // maps ride the chunked transport). `atlas-request` is a player's whisper to
  // the host on opening their Atlas. `atlas-focus` is BROADCAST VIEW: the
  // Curator flies one player's — or everyone's — Atlas camera to a place.
  | { t: "atlas"; doc: unknown }
  | { t: "atlas-request" }
  | { t: "atlas-focus"; x: number; y: number; zoom?: number; label?: string };

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
  "chat",
  "party",
  "sheet-patch",
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
