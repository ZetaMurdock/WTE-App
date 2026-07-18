import { useEffect, useRef, useState } from "react";
import { getSessionRolls, subscribeSessionRolls, type SessionRoll } from "./sync/rollSession";

// How long a roll stays on screen before it fades out (matches the CSS animation).
const DURATION = 4600;

interface Props {
  campaignId: string;
}

// Active roll UI: whenever a roll lands (your dice tray, an ability, or a peer's
// roll — all flow through the durable session store), it pops up centre-top and
// fades away after a few seconds. The persistent Roll feed still keeps history.
export function VttRollToast({ campaignId }: Props) {
  const [toasts, setToasts] = useState<SessionRoll[]>([]);
  const seen = useRef<Set<string>>(new Set());
  const timers = useRef<number[]>([]);

  useEffect(() => {
    // Seed with existing rolls so hydrated history doesn't all pop on open.
    seen.current = new Set(getSessionRolls(campaignId).map((r) => r.id));
    const off = subscribeSessionRolls(() => {
      const cur = getSessionRolls(campaignId);
      // Only toast rolls that actually just happened. The SQLite history
      // hydrates ASYNC after mount, so the seed above misses it — without the
      // recency gate the whole session history sprayed as toasts on first roll.
      const cutoff = Date.now() - 8000;
      const fresh = cur.filter((r) => !seen.current.has(r.id) && r.at >= cutoff);
      for (const r of cur) seen.current.add(r.id);
      if (!fresh.length) return;
      setToasts((t) => [...fresh, ...t].slice(0, 3));
      for (const r of fresh) {
        const id = window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== r.id)), DURATION);
        timers.current.push(id);
      }
    });
    return () => {
      off();
      for (const id of timers.current) clearTimeout(id);
      timers.current = [];
    };
  }, [campaignId]);

  if (!toasts.length) return null;
  return (
    <div className="vtt2-roll-toasts">
      {toasts.map((r) => (
        <div key={r.id} className="vtt2-roll-toast">
          <span className="vtt2-rt-die">{r.result}</span>
          <span className="vtt2-rt-body">
            <span className="vtt2-rt-label">{r.label || r.formula || "Roll"}</span>
            <span className="vtt2-rt-meta">
              {r.who}
              {r.formula ? " · " + r.formula : ""}
            </span>
          </span>
        </div>
      ))}
    </div>
  );
}
