import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { recentRolls, logRoll } from "../lib/rolls";
import { rollDiceExpr, type RollResult } from "../game/wte";
import { useNet } from "../net/NetContext";
import { addSessionRoll, getSessionRolls, hydrateSessionRolls, subscribeSessionRolls } from "./sync/rollSession";

const DICE = [4, 6, 8, 10, 12, 20, 40, 100];
// Stable reference for the "no campaign" snapshot (useSyncExternalStore needs it).
const EMPTY_ROWS: readonly { id: string; who: string; label: string; formula: string; result: number; at: number }[] = [];

export interface RollLock {
  label: string;
  expr?: string;
}

interface Props {
  campaignId: string | null;
  /** Armed roll context from the Abilities panel (the legacy sheet's "Locked:
   *  X — press Roll" flow). Pre-fills the expression; Roll logs under the label. */
  lock: RollLock | null;
  onClearLock: () => void;
  onClose: () => void;
}

function newRollId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return "r-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
}

// The dice tray, legacy-sheet style: NOTHING auto-rolls. Die chips and the
// Abilities panel fill the expression box (abilities also LOCK their name over
// the roller); the one big Roll button rolls it, records it in the durable
// store, persists it, and publishes to the party.
export function VttRollFeed({ campaignId, lock, onClearLock, onClose }: Props) {
  const net = useNet();
  const rows = useSyncExternalStore(subscribeSessionRolls, () => (campaignId ? getSessionRolls(campaignId) : EMPTY_ROWS));
  const [expr, setExpr] = useState("1d20");
  const [exprBad, setExprBad] = useState(false);

  // A newly-armed lock takes over the expression box (when it suggests dice).
  useEffect(() => {
    if (lock?.expr) setExpr(lock.expr);
    setExprBad(false);
  }, [lock]);

  // Seed the session store from SQLite history the first time this campaign opens.
  const reload = useCallback(async () => {
    if (!campaignId) return;
    const recent = await recentRolls(campaignId, 30).catch(() => []);
    hydrateSessionRolls(
      campaignId,
      recent.map((r) => ({ id: r.id, who: "", label: r.label, formula: r.formula, result: r.result, at: r.at }))
    );
  }, [campaignId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const commit = useCallback(
    (roll: RollResult) => {
      const id = newRollId();
      if (campaignId) {
        addSessionRoll(campaignId, { id, who: "You", label: roll.detail.label, formula: roll.formula, result: roll.result, at: Date.now() });
        void logRoll(campaignId, null, roll);
      }
      if (net.status === "connected") net.publish({ t: "roll", label: roll.detail.label, formula: roll.formula, result: roll.result, id });
    },
    [campaignId, net]
  );

  function rollNow() {
    const roll = rollDiceExpr(lock?.label ?? expr, expr);
    if (!roll) {
      setExprBad(true);
      return;
    }
    setExprBad(false);
    commit(roll);
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
          <span className="vtt2-roll-lock-name">Rolling: {lock.label}</span>
          <button className="cdx-tab-x" onClick={onClearLock} title="Unlock — back to freeform rolling">
            ×
          </button>
        </div>
      )}

      <div className="vtt2-dicetray">
        {DICE.map((d) => (
          <button key={d} className="vtt2-die" onClick={() => { setExpr(`1d${d}`); setExprBad(false); }} title={`Set the roll to 1d${d}`}>
            d{d}
          </button>
        ))}
      </div>
      <div className="vtt2-roll-exprrow">
        <input
          className={"bg-select vtt2-roll-expr" + (exprBad ? " bad" : "")}
          value={expr}
          placeholder="2d6+3"
          onChange={(e) => { setExpr(e.target.value); setExprBad(false); }}
          onKeyDown={(e) => e.key === "Enter" && rollNow()}
        />
        <button className="primary-btn vtt2-roll-go" onClick={rollNow}>
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
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
