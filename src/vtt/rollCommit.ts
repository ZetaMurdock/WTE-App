import { canonicalRollExpr, createRollId, logRoll } from "../lib/rolls";
import { rollDiceExpr, type RollMode, type RollResult } from "../game/wte";
import { addSessionRoll } from "./sync/rollSession";
import type { RollMessage } from "../net/protocol";

export interface VttRollActor {
  characterId?: string | null;
  tokenId?: string;
  name?: string;
}

export interface RollLock {
  label: string;
  expr?: string;
  /** Roll Axis requests preserve the normal attribute-vs-specialty choice. */
  choices?: { label: string; expr: string; detail?: string }[];
  /** Correlates a player-made roll with the Curator request that armed it. */
  requestId?: string;
  requestedBy?: string;
  dc?: number;
  /** Wall-clock deadline copied off the wire request. The host frees its
   *  `pendingRollRequests` slot at this moment and will reject anything that
   *  arrives afterwards, so a prompt past it must say so rather than throwing
   *  dice nobody will ever read. A request the Curator rolls locally has no
   *  slot and no peer, so it carries no deadline. */
  expiresAt?: number;
  /** Who ANSWERS this roll, when that is not the tray's own actor. A Curator
   *  rolling a target's save on their own machine files it under the TARGET;
   *  attributing it to the caster would put the defender's save in the feed,
   *  and in the campaign's roll history, under the wrong character. */
  actor?: VttRollActor;
}

export interface RollCommitDeps {
  campaignId: string | null;
  /** Table-qualified roll-session key; the campaign id in solo play. */
  feedKey: string | null;
  selfId: string;
  /** The tray's own actor, used when the lock does not name one. */
  actor?: VttRollActor;
  /** Requested-roll integrations whisper a `roll-result` to the host for
   *  validation instead of broadcasting. */
  publishRoll?: (message: RollMessage) => void;
  /** The plain room broadcast, used only when there is no `publishRoll`. */
  broadcast?: ((message: RollMessage) => void) | null;
}

/** `Physical Save — Evasion · Balance` — the lock's own name plus whichever
 *  Roll Axis source actually answered it. */
export function rollLockLabel(lock: RollLock, choiceLabel?: string | null): string {
  return `${lock.label}${choiceLabel ? ` · ${choiceLabel}` : ""}`;
}

/** A request is dead once the host has dropped its correlation slot. */
export function rollLockExpired(lock: RollLock, now: number = Date.now()): boolean {
  return lock.expiresAt != null && lock.expiresAt <= now;
}

/** Parse-then-throw, in that order, sharing ONE parser with the tray:
 *  `canonicalRollExpr` and `rollDiceExpr` must agree or the host's
 *  `expectedBaseExprs` comparison can never match what was rolled. */
export function prepareRoll(
  label: string,
  expr: string,
  mode: RollMode = "normal"
): { roll: RollResult; baseExpr: string } | null {
  const baseExpr = canonicalRollExpr(expr);
  if (!baseExpr) return null;
  const roll = rollDiceExpr(label, baseExpr, mode);
  if (!roll) return null;
  return { roll, baseExpr };
}

/**
 * The one place a rolled result becomes real: recorded in the session store,
 * written to the campaign's durable history, and published.
 *
 * Extracted from the dice tray so the roll PROMPT is the same path rather than
 * a second one. A prompt that assembled its own `RollMessage` would be a roll
 * that skipped `publishVttRoll` — meaning no host validation on the wire, no
 * Resolution Card settled locally, and no row in the campaign log — and the
 * only symptom would be requested rolls that quietly do nothing.
 */
export function commitRoll(
  roll: RollResult,
  baseExpr: string,
  context: RollLock | null,
  deps: RollCommitDeps
): RollMessage {
  const id = createRollId();
  const at = Date.now();
  const mode = roll.detail.mode ?? "normal";
  const who = context?.actor ?? deps.actor;
  const message: RollMessage = {
    t: "roll",
    id,
    label: roll.detail.label,
    formula: roll.formula,
    baseExpr,
    result: roll.result,
    detail: roll.detail,
    mode,
    at,
    requestId: context?.requestId,
    actor: {
      peerId: deps.selfId,
      characterId: who?.characterId ?? undefined,
      tokenId: who?.tokenId,
      name: who?.name,
    },
  };
  if (deps.feedKey) {
    addSessionRoll(deps.feedKey, {
      id,
      who: who?.name || "You",
      label: message.label,
      formula: message.formula,
      result: message.result,
      at,
      characterId: who?.characterId,
      tokenId: who?.tokenId,
      requestId: message.requestId,
      baseExpr,
      mode,
      detail: roll.detail,
    });
  }
  if (deps.campaignId) {
    void logRoll(deps.campaignId, who?.characterId ?? null, roll, {
      id,
      at,
      baseExpr,
      actorName: who?.name || "You",
      tokenId: who?.tokenId,
      requestId: context?.requestId,
      mode,
    });
  }
  if (deps.publishRoll) deps.publishRoll(message);
  else if (deps.broadcast) deps.broadcast(message);
  return message;
}
