import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { canonicalRollExpr, createRollId, recentRolls, logRoll } from "../lib/rolls";
import { rollDiceExpr, type RollMode, type RollResult } from "../game/wte";
import { useNet } from "../net/NetContext";
import { addSessionRoll, getSessionRolls, hydrateSessionRolls, subscribeSessionRolls, type SessionRoll } from "./sync/rollSession";
import type { RollMessage } from "../net/protocol";

const DICE = [4, 6, 8, 10, 12, 20, 40, 100];
// Stable reference for the "no campaign" snapshot (useSyncExternalStore needs it).
const EMPTY_ROWS: readonly SessionRoll[] = [];

export interface RollLock {
  label: string;
  expr?: string;
  /** Correlates a player-made roll with the Curator request that armed it. */
  requestId?: string;
  requestedBy?: string;
  dc?: number;
}

export interface VttRollActor {
  characterId?: string | null;
  tokenId?: string;
  name?: string;
}

interface Props {
  campaignId: string | null;
  /** Optional table-qualified roll-session key. Defaults to campaignId for
   * compatibility; use rollSessionScope(campaignId, room) in connected play. */
  sessionKey?: string;
  actor?: VttRollActor;
  /** Overrides the default room broadcast. Requested-roll integrations use
   * this to whisper a `roll-result` to the host for validation first. */
  publishRoll?: (message: RollMessage) => void;
  /** Armed roll context from the Abilities panel (the legacy sheet's "Locked:
   *  X — press Roll" flow). Pre-fills the expression; Roll logs under the label. */
  lock: RollLock | null;
  onClearLock: () => void;
  onClose: () => void;
}

// The dice tray, legacy-sheet style: NOTHING auto-rolls. Die chips and the
// Abilities panel fill the expression box (abilities also LOCK their name over
// the roller); the one big Roll button rolls it, records it in the durable
// store, persists it, and publishes to the party.
export function VttRollFeed({ campaignId, sessionKey, actor, publishRoll, lock, onClearLock, onClose }: Props) {
  const net = useNet();
  const feedKey = sessionKey ?? campaignId;
  const rows = useSyncExternalStore(subscribeSessionRolls, () => (feedKey ? getSessionRolls(feedKey) : EMPTY_ROWS));
  const [expr, setExpr] = useState("1d20");
  const [exprBad, setExprBad] = useState(false);
  const requested = !!lock?.requestId;

  // A newly-armed lock always takes over the expression box. Clearing it when
  // an ability has no suggested dice prevents a previous ability's formula from
  // being submitted under the new label.
  useEffect(() => {
    if (lock) setExpr(lock.expr ?? "");
    setExprBad(false);
  }, [lock]);

  // Seed the session store from SQLite history the first time this campaign opens.
  const reload = useCallback(async () => {
    if (!campaignId || !feedKey) return;
    const recent = await recentRolls(campaignId, 30).catch(() => []);
    hydrateSessionRolls(
      feedKey,
      recent.map((r) => ({
        id: r.id,
        who: r.actorName || "History",
        label: r.label,
        formula: r.formula,
        result: r.result,
        at: r.at,
        characterId: r.characterId,
        tokenId: r.tokenId,
        requestId: r.requestId,
        baseExpr: r.baseExpr,
        mode: r.mode,
        detail: r.detail,
      }))
    );
  }, [campaignId, feedKey]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const commit = useCallback(
    (roll: RollResult, baseExpr: string, context: RollLock | null = lock) => {
      const id = createRollId();
      const at = Date.now();
      const mode = roll.detail.mode ?? "normal";
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
          peerId: net.selfId,
          characterId: actor?.characterId ?? undefined,
          tokenId: actor?.tokenId,
          name: actor?.name,
        },
      };
      if (feedKey) {
        addSessionRoll(feedKey, {
          id,
          who: actor?.name || "You",
          label: message.label,
          formula: message.formula,
          result: message.result,
          at,
          characterId: actor?.characterId,
          tokenId: actor?.tokenId,
          requestId: message.requestId,
          baseExpr,
          mode,
          detail: roll.detail,
        });
      }
      if (campaignId) {
        void logRoll(campaignId, actor?.characterId ?? null, roll, {
          id,
          at,
          baseExpr,
          actorName: actor?.name || "You",
          tokenId: actor?.tokenId,
          requestId: context?.requestId,
          mode,
        });
      }
      if (publishRoll) publishRoll(message);
      else if (net.status === "connected") net.publish(message);
      if (context?.requestId) onClearLock();
    },
    [actor, campaignId, feedKey, lock, net, onClearLock, publishRoll]
  );

  // Shift-click = Advantage, ctrl/alt-click or right-click = Disadvantage —
  // the roll message names the posture and shows both totals.
  function rollNow(mode: RollMode = "normal") {
    const baseExpr = canonicalRollExpr(expr);
    if (!baseExpr) {
      setExprBad(true);
      return;
    }
    const roll = rollDiceExpr(lock?.label ?? expr, baseExpr, mode);
    if (!roll) return; // canonicalRollExpr and rollDiceExpr share the same parser.
    setExprBad(false);
    commit(roll, baseExpr);
  }
  function rollClick(e: React.MouseEvent) {
    rollNow(e.shiftKey ? "adv" : e.ctrlKey || e.altKey ? "dis" : "normal");
  }

  function reroll(baseExpr: string, label: string, mode: RollMode = "normal") {
    const canonical = canonicalRollExpr(baseExpr);
    if (!canonical) return;
    const roll = rollDiceExpr(label || canonical, canonical, mode);
    if (!roll) return;
    onClearLock();
    setExpr(canonical);
    commit(roll, canonical, null);
  }

  return (
    <div className="vtt2-rollfeed">
      <div className="vtt2-insp-head">
        <span className="panel-title" style={{ margin: 0 }}>
          Rolls
        </span>
        <div style={{ display: "flex", gap: 4 }}>
          <button className="icon-btn sm" onClick={() => void reload()} title="Reload history">
            ⟳
          </button>
          <button className="cdx-tab-x" onClick={onClose} title="Close">
            ×
          </button>
        </div>
      </div>

      {lock && (
        <div className="vtt2-roll-lock">
          <span className="vtt2-roll-lock-name">
            {lock.requestId ? "Requested: " : "Rolling: "}
            {lock.label}
            {lock.dc != null ? ` (DC ${lock.dc})` : ""}
            {lock.requestedBy ? ` · ${lock.requestedBy}` : ""}
          </span>
          <button className="cdx-tab-x" onClick={onClearLock} title="Unlock — back to freeform rolling">
            ×
          </button>
        </div>
      )}

      <div className="vtt2-dicetray">
        {DICE.map((d) => (
          <button key={d} className="vtt2-die" disabled={requested} onClick={() => { setExpr(`1d${d}`); setExprBad(false); }} title={requested ? "The Curator's request fixes this roll formula" : `Set the roll to 1d${d}`}>
            d{d}
          </button>
        ))}
      </div>
      <div className="vtt2-roll-exprrow">
        <input
          className={"bg-select vtt2-roll-expr" + (exprBad ? " bad" : "")}
          value={expr}
          placeholder="2d6+3"
          readOnly={requested}
          title={requested ? "This formula comes from your selected character's current sheet" : undefined}
          onChange={(e) => { setExpr(e.target.value); setExprBad(false); }}
          onKeyDown={(e) => e.key === "Enter" && rollNow(e.shiftKey ? "adv" : e.ctrlKey || e.altKey ? "dis" : "normal")}
        />
        <button
          className="primary-btn vtt2-roll-go"
          onClick={rollClick}
          onContextMenu={(e) => {
            e.preventDefault();
            rollNow("dis");
          }}
          title="Shift-click: Advantage · Right-click (or Ctrl-click): Disadvantage"
        >
          Roll{lock ? " · " + lock.label : ""}
        </button>
      </div>
      {exprBad && <p className="equip-warn" style={{ margin: "4px 0" }}>Invalid dice — e.g. 2d6+3</p>}

      {rows.length === 0 ? (
        <p className="list-empty" style={{ margin: "6px 0" }}>
          No rolls yet.
        </p>
      ) : (
        <ul className="vtt2-roll-list">
          {rows.map((r) => (
            <li key={r.id} className="vtt2-roll-row">
              <span className="vtt2-roll-who">{r.who}</span>
              <span className="vtt2-roll-label">{r.label || r.formula}</span>
              <span className="vtt2-roll-result">{r.result}</span>
              {r.baseExpr && (
                <button className="chip" onClick={() => reroll(r.baseExpr!, r.label, r.mode ?? "normal")} title="Roll this again with your own dice">
                  Roll again
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
