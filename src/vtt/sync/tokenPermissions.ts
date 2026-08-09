import type { Role } from "../../net/protocol";
import type { VttToken } from "../types/scene";

/** The identity used for every local and remote token-control decision. */
export interface TokenPrincipal {
  peerId: string;
  role: Role;
  /** Explicit recovery/migration mode. Ordinary Curator input leaves this off. */
  administrative?: boolean;
}

export type TokenControlAction = "move" | "customize" | "remove";

/** Read legacy `ownerPeer` tokens without making them public during migration. */
export function tokenOwnerId(token: VttToken): string | null {
  return token.owner || token.ownerPeer || null;
}

/**
 * One strict token-control rule for pointer, keyboard, inspector, and sync code.
 *
 * - A player controls only a non-prop token explicitly assigned to that peer.
 * - Unassigned actors and props belong to the Curator, never to every player.
 * - A Curator does not ordinarily manipulate a player's token. The explicit
 *   administrative flag exists for recovery and migration workflows.
 */
export function canControlToken(principal: TokenPrincipal, token: VttToken, _action: TokenControlAction = "move"): boolean {
  const owner = tokenOwnerId(token);
  if (principal.role === "player") return !token.prop && owner === principal.peerId;
  if (owner && owner !== principal.peerId) return principal.administrative === true;
  return true;
}

/** Snapshots are authoritative host state: hosts never adopt them from players. */
export function canAcceptSnapshot(localRole: Role, senderId: string, hostId: string | null, selfId: string): boolean {
  if (senderId === selfId || localRole === "host") return false;
  return hostId != null && senderId === hostId;
}
