import { useCallback, useEffect, useRef, useState } from "react";
import type { RollResult } from "../../game/wte";

export interface FeedItem {
  id: string;
  label: string;
  formula: string;
  result: number;
  born: number;
  leaving: boolean;
}

const FEED_DURATION = 8000; // ms an entry stays before it starts leaving
const LEAVE_MS = 480; // must match the CSS leave transition duration

let feedSeq = 0;

// Ephemeral, self-clearing roll feed. Newest is unshifted to the top; the oldest
// entry crosses FEED_DURATION first, so removals cascade from the bottom up.
export function useRollFeed() {
  const [items, setItems] = useState<FeedItem[]>([]);
  const timer = useRef<number | undefined>(undefined);

  const push = useCallback((roll: RollResult) => {
    const item: FeedItem = {
      id: "f" + Date.now().toString(36) + "-" + feedSeq++,
      label: roll.detail.label,
      formula: roll.formula,
      result: roll.result,
      born: Date.now(),
      leaving: false,
    };
    setItems((cur) => [item, ...cur]);
  }, []);

  useEffect(() => {
    timer.current = window.setInterval(() => {
      const now = Date.now();
      setItems((cur) => {
        if (cur.length === 0) return cur;
        let changed = false;
        const next = cur
          .map((it) => {
            if (!it.leaving && now - it.born > FEED_DURATION) {
              changed = true;
              return { ...it, leaving: true };
            }
            return it;
          })
          .filter((it) => {
            const gone = it.leaving && now - it.born > FEED_DURATION + LEAVE_MS;
            if (gone) changed = true;
            return !gone;
          });
        return changed ? next : cur;
      });
    }, 200);
    return () => window.clearInterval(timer.current);
  }, []);

  return { items, push };
}

export function RollFeed({ items }: { items: FeedItem[] }) {
  if (items.length === 0) {
    return <p className="list-empty">No rolls yet — hit a d20 or d40 button.</p>;
  }
  return (
    <ul className="roll-feed">
      {items.map((r) => (
        <li className={"roll-item" + (r.leaving ? " leaving" : "")} key={r.id}>
          <span className="roll-label">{r.label}</span>
          <span className="roll-formula">{r.formula}</span>
          <span className="roll-result">{r.result}</span>
        </li>
      ))}
    </ul>
  );
}
