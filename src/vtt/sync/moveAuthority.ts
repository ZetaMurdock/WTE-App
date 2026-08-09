import type { Role } from "../../net/protocol";
import { canOccupy } from "../data/occupancy";
import { pathBlocked } from "../engine/systems/VisionSystem";
import type { VttGrid, VttToken, VttWall } from "../types/scene";
import { canControlToken } from "./tokenPermissions";

/** Stable wire-safe reasons for rejecting a movement intent. */
export type MoveRejectionReason =
  | "not-owner"
  | "stale"
  | "wall"
  | "occupied"
  | "out-of-bounds"
  | "invalid";

export interface MoveAuthorityPrincipal {
  peerId: string;
  role: Role;
  administrative?: boolean;
}

/** The host-owned subset of scene state needed to serialize movement. */
export interface MoveAuthorityState {
  grid: VttGrid;
  tokens: readonly VttToken[];
  walls: readonly VttWall[];
  /** Incremented only when an intent is committed. */
  revision: number;
}

/** A client intent. `expectedRevision` is optional for legacy request senders. */
export interface MoveAuthorityIntent {
  tokenId: string;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  expectedRevision?: number;
}

export interface MoveAccepted {
  ok: true;
  tokenId: string;
  previousX: number;
  previousY: number;
  x: number;
  y: number;
  revision: number;
}

export interface MoveRejected {
  ok: false;
  tokenId: string;
  /** Current authoritative position, if the token exists. */
  x: number;
  y: number;
  attemptedX: number;
  attemptedY: number;
  reason: MoveRejectionReason;
  revision: number;
  blockingTokenId?: string;
}

export type MoveAuthorityDecision = MoveAccepted | MoveRejected;

const ORIGIN_EPSILON = 0.01;

function rejected(
  state: MoveAuthorityState,
  intent: MoveAuthorityIntent,
  reason: MoveRejectionReason,
  token?: VttToken,
  blockingTokenId?: string
): MoveRejected {
  return {
    ok: false,
    tokenId: intent.tokenId,
    x: token?.x ?? intent.fromX,
    y: token?.y ?? intent.fromY,
    attemptedX: intent.toX,
    attemptedY: intent.toY,
    reason,
    revision: state.revision,
    ...(blockingTokenId ? { blockingTokenId } : {}),
  };
}

/**
 * Validate one movement intent against the host's current state.
 *
 * This function never mutates its inputs. Callers must validate and apply in
 * one serialized host turn; `applyAuthorizedMove` supplies that pure state
 * transition for tests and non-renderer consumers.
 */
export function validateMoveAuthority(
  state: MoveAuthorityState,
  principal: MoveAuthorityPrincipal,
  intent: MoveAuthorityIntent
): MoveAuthorityDecision {
  if (
    !intent.tokenId ||
    ![intent.fromX, intent.fromY, intent.toX, intent.toY].every(Number.isFinite) ||
    (intent.expectedRevision !== undefined && (!Number.isSafeInteger(intent.expectedRevision) || intent.expectedRevision < 0))
  ) {
    return rejected(state, intent, "invalid");
  }

  const token = state.tokens.find((candidate) => candidate.id === intent.tokenId);
  if (!token) return rejected(state, intent, "invalid");
  // Check ownership before stale coordinates so unauthorized peers cannot use
  // movement responses as a position oracle for someone else's actor.
  if (!canControlToken(principal, token, "move")) return rejected(state, intent, "not-owner", token);

  if (
    (intent.expectedRevision !== undefined && intent.expectedRevision !== state.revision) ||
    Math.abs(token.x - intent.fromX) > ORIGIN_EPSILON ||
    Math.abs(token.y - intent.fromY) > ORIGIN_EPSILON
  ) {
    return rejected(state, intent, "stale", token);
  }

  if (pathBlocked([...state.walls], token.x, token.y, intent.toX, intent.toY)) {
    return rejected(state, intent, "wall", token);
  }

  const occupancy = canOccupy(
    state.grid,
    state.tokens,
    { x: intent.toX, y: intent.toY, size: token.size },
    { ignoreTokenId: token.id }
  );
  if (!occupancy.ok) {
    const reason: MoveRejectionReason = occupancy.reason === "invalid-position" ? "invalid" : occupancy.reason;
    return rejected(state, intent, reason, token, occupancy.blockingTokenId);
  }

  return {
    ok: true,
    tokenId: token.id,
    previousX: token.x,
    previousY: token.y,
    x: intent.toX,
    y: intent.toY,
    revision: state.revision + 1,
  };
}

export interface AppliedMove {
  state: MoveAuthorityState;
  decision: MoveAuthorityDecision;
}

/** Pure, atomic validation + state transition used to model host arbitration. */
export function applyAuthorizedMove(
  state: MoveAuthorityState,
  principal: MoveAuthorityPrincipal,
  intent: MoveAuthorityIntent
): AppliedMove {
  const decision = validateMoveAuthority(state, principal, intent);
  if (!decision.ok) return { state, decision };

  const dx = decision.x - decision.previousX;
  const dy = decision.y - decision.previousY;
  const tokens = state.tokens.map((token) => {
    if (token.id !== decision.tokenId) return token;
    return {
      ...token,
      x: decision.x,
      y: decision.y,
      ...(Math.hypot(dx, dy) > 2 ? { facing: Math.atan2(dy, dx) } : {}),
    };
  });
  return {
    state: { ...state, tokens, revision: decision.revision },
    decision,
  };
}
