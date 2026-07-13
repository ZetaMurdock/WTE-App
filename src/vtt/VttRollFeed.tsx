import { useCallback, useEffect, useRef, useState } from "react";
import { recentRolls } from "../lib/rolls";
import { useNet } from "../net/NetContext";
import type { NetMessage } from "../net/protocol";

type RollMsg = Extract<NetMessage, { t: "roll" }>;

interface Row {
  id: string;
  who: string;
  label: string;
  formula: string;
  result: number;
}

interface Props {
  campaignId: string | null;
  onClose: () => void;
}

// VTT v2 (slice 9): shared roll feed. History comes from the SQLite `rolls` table;
// live rolls arrive over the netplay `roll` message while in a room.
export function VttRollFeed({ campaignId, onClose }: Props) {
  const net = useNet();
  const [rows, setRows] = useState<Row[]>([]);
  const peersRef = useRef(net.peers);
  peersRef.current = net.peers;
  const nameOf = useCallback(
    (id: string) => (id === net.selfId ? "You" : peersRef.current.find((p) => p.id === id)?.name || id.slice(0, 6)),
    [net.selfId]
  );

  const reload = useCallback(async () => {
    if (!campaignId) return;
    const recent = await recentRolls(campaignId, 30).catch(() => []);
    setRows(
      recent.map((r) => ({ id: r.id, who: "log", label: r.label, formula: r.formula, result: r.result }))
    );
  }, [campaignId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  // Live rolls from the room, prepended.
  useEffect(() => {
    const off = net.subscribe("roll", (m, from) => {
      const r = m as RollMsg;
      setRows((cur) =>
        [{ id: "live-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), who: nameOf(from), label: r.label, formula: r.formula, result: r.result }, ...cur].slice(0, 60)
      );
    });
    return off;
  }, [net.subscribe, nameOf]);

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
