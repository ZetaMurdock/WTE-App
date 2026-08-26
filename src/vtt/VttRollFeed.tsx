import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { canonicalRollExpr, recentRolls } from "../lib/rolls";
import { rollDiceExpr, type RollMode, type RollResult } from "../game/wte";
import { useNet } from "../net/NetContext";
import { getSessionRolls, hydrateSessionRolls, subscribeSessionRolls, type SessionRoll } from "./sync/rollSession";
import { commitRoll, rollLockExpired, rollLockLabel, type RollLock, type VttRollActor } from "./rollCommit";
import type { RollMessage } from "../net/protocol";

const DICE = [4, 6, 8, 10, 12, 20, 40, 100];
// Stable reference for the "no campaign" snapshot (useSyncExternalStore needs it).
const EMPTY_ROWS: readonly SessionRoll[] = [];

export type { RollLock, VttRollActor } from "./rollCommit";

interface Props {
  campaignId: string | null;
  /** Optional table-qualified roll-session key. Defaults to campaignId for
   * compatibility; use rollSessionScope(campaignId, room) in connected play. */
  sessionKey?: string;
  actor?: VttRollActor;
  /** Overrides the default room broadcast. Requested-roll integrations use
   * this to whisper a `roll-result` to the host for validation first. */
  publishRoll?: (message: RollMessage) => void;
  /** Connected players ask the Curator before any non-normal posture is rolled. */
  authorizeMode?: (mode: Exclude<RollMode, "normal">, label: string) => Promise<boolean>;
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
export function VttRollFeed({ campaignId, sessionKey, actor, publishRoll, authorizeMode, lock, onClearLock, onClose }: Props) {
  const net = useNet();
  const feedKey = sessionKey ?? campaignId;
  const rows = useSyncExternalStore(subscribeSessionRolls, () => (feedKey ? getSessionRolls(feedKey) : EMPTY_ROWS));
  const [expr, setExpr] = useState("1d20");
  const [exprBad, setExprBad] = useState(false);
  const [choiceLabel, setChoiceLabel] = useState<string | null>(null);
  const [lockDead, setLockDead] = useState(false);
  const requested = !!lock?.requestId;

  // A newly-armed lock always takes over the expression box. Clearing it when
  // an ability has no suggested dice prevents a previous ability's formula from
  // being submitted under the new label.
  useEffect(() => {
    if (lock) setExpr(lock.choices?.length ? "" : lock.expr ?? "");
    setChoiceLabel(null);
    setExprBad(false);
    setLockDead(false);
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
      commitRoll(roll, baseExpr, context, {
        campaignId,
        feedKey,
        selfId: net.selfId,
        actor,
        publishRoll,
        broadcast: net.status === "connected" ? net.publish : null,
      });
      if (context) onClearLock();
    },
    [actor, campaignId, feedKey, lock, net, onClearLock, publishRoll]
  );

  // Mouse/keyboard shortcuts remain, while the visible DIS / ADV buttons make
  // every posture available to touch-only players too.
  async function rollNow(mode: RollMode = "normal") {
    // The host deletes its `pendingRollRequests` slot at the deadline, so a
    // `roll-result` that arrives afterwards finds no pending entry and is
    // dropped without a word. Rolling here anyway would still write the row to
    // THIS player's session feed and campaign log, so the table would see
    // nothing while the roller saw a perfectly normal result — the exact
    // "requested rolls that quietly do nothing" failure. The prompt refuses an
    // expired request; the tray is its documented fallback and must too.
    if (lock && rollLockExpired(lock)) {
      setLockDead(true);
      return;
    }
    const baseExpr = canonicalRollExpr(expr);
    if (!baseExpr) {
      setExprBad(true);
      return;
    }
    const label = lock ? rollLockLabel(lock, choiceLabel) : expr;
    if (mode !== "normal" && authorizeMode && !(await authorizeMode(mode, label))) return;
    const roll = rollDiceExpr(label, baseExpr, mode);
    if (!roll) return; // canonicalRollExpr and rollDiceExpr share the same parser.
    setExprBad(false);
    commit(roll, baseExpr);
  }
  function rollClick(e: React.MouseEvent) {
    void rollNow(e.shiftKey ? "adv" : e.ctrlKey || e.altKey ? "dis" : "normal");
  }

  // Re-read every render rather than stored: the deadline passes on wall-clock
  // time, not on a state change. `lockDead` only forces the render that a press
  // against an already-dead request needs in order to say so.
  const lockExpired = !!lock && (lockDead || rollLockExpired(lock));

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
            {lockExpired ? " · expired" : ""}
          </span>
          <button className="cdx-tab-x" onClick={onClearLock} title="Unlock — back to freeform rolling">
            ×
          </button>
        </div>
      )}
      {lockExpired && (
        <p className="equip-warn vtt2-roll-lock-dead">
          This request timed out, so the Curator's table would never receive it. Clear it with × and roll freely, or ask
          them to send it again.
        </p>
      )}

      {!!lock?.choices?.length && (
        <div className="vtt2-axis-choices vtt2-requested-axis-choices" role="group" aria-label="Choose Roll Axis source">
          {lock.choices.map((choice) => (
            <button
              key={`${choice.label}|${choice.expr}`}
              type="button"
              className={`ghost-btn${choiceLabel === choice.label ? " active" : ""}`}
              aria-pressed={choiceLabel === choice.label}
              onClick={() => {
                setChoiceLabel(choice.label);
                setExpr(choice.expr);
                setExprBad(false);
              }}
            >
              {choice.label}
              <small>{choice.detail || choice.expr}</small>
            </button>
          ))}
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
          placeholder={lock?.choices?.length ? "Choose Attribute or Specialty above" : "2d6+3"}
          readOnly={requested}
          title={requested ? "This formula comes from your selected character's current sheet" : undefined}
          onChange={(e) => { setExpr(e.target.value); setExprBad(false); }}
          onKeyDown={(e) => e.key === "Enter" && void rollNow(e.shiftKey ? "adv" : e.ctrlKey || e.altKey ? "dis" : "normal")}
        />
        <div className="vtt2-roll-actions" role="group" aria-label="Roll mode">
          <button className="ghost-btn vtt2-roll-mode" onClick={() => void rollNow("double-dis")} title="Roll three times and keep the lowest">
            2× Dis
          </button>
          <button className="ghost-btn vtt2-roll-mode" onClick={() => void rollNow("dis")} title="Roll with Disadvantage">
            Dis
          </button>
          <button
            className="primary-btn vtt2-roll-go"
            onClick={rollClick}
            onContextMenu={(e) => {
              e.preventDefault();
              void rollNow("dis");
            }}
            title="Roll normally · Shift-click: Advantage · Right-click: Disadvantage"
          >
            Roll{lock ? " · " + lock.label : ""}
          </button>
          <button className="ghost-btn vtt2-roll-mode" onClick={() => void rollNow("adv")} title="Roll with Advantage">
            Adv
          </button>
          <button className="ghost-btn vtt2-roll-mode" onClick={() => void rollNow("double-adv")} title="Roll three times and keep the highest">
            2× Adv
          </button>
        </div>
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
