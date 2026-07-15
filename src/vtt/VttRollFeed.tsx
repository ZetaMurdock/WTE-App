import { useCallback, useEffect, useSyncExternalStore } from "react";
import { recentRolls, logRoll } from "../lib/rolls";
import { useNet } from "../net/NetContext";
import { addSessionRoll, getSessionRolls, hydrateSessionRolls, subscribeSessionRolls } from "./sync/rollSession";

const DICE = [4, 6, 8, 10, 12, 20, 100];
// Stable reference for the "no campaign" snapshot (useSyncExternalStore needs it).
const EMPTY_ROWS: readonly { id: string; who: string; label: string; formula: string; result: number; at: number }[] = [];

interface Props {
  campaignId: string | null;
  onClose: () => void;
}

function newRollId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return "r-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
}

// VTT v2 (slice 9): shared roll feed. The rows live in the durable per-campaign
// session store (see rollSession.ts) so the tray never loses history when it is
// closed/reopened. History hydrates from the SQLite `rolls` table once; live
// rolls arrive over the netplay `roll` message (captured at the VttScreen level).
export function VttRollFeed({ campaignId, onClose }: Props) {
  const net = useNet();
  const rows = useSyncExternalStore(subscribeSessionRolls, () => (campaignId ? getSessionRolls(campaignId) : EMPTY_ROWS));

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

  // The VTT dice tray: roll a die here, record it in the durable store, persist
  // it, and publish to the party (with a stable id so peers/self don't double-log).
  const rollDie = useCallback(
    (sides: number) => {
      const result = 1 + Math.floor(Math.random() * sides);
      const formula = `1d${sides}`;
      const label = `d${sides}`;
      const id = newRollId();
      if (campaignId) addSessionRoll(campaignId, { id, who: "You", label, formula, result, at: Date.now() });
      if (campaignId) void logRoll(campaignId, null, { formula, result, detail: { die: sides, roll: result, modifier: 0, label } });
      if (net.status === "connected") net.publish({ t: "roll", label, formula, result, id });
    },
    [campaignId, net]
  );

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
      <div className="vtt2-dicetray">
        {DICE.map((d) => (
          <button key={d} className="vtt2-die" onClick={() => rollDie(d)} title={`Roll 1d${d}`}>
            d{d}
          </button>
        ))}
      </div>
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
