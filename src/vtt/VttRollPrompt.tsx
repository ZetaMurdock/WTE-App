import { useEffect, useRef, useState } from "react";
import type { RollMode } from "../game/wte";
import { rollLockExpired, type RollLock } from "./rollCommit";

export type RollPromptSource = { label: string; expr: string; detail?: string };

interface Props {
  /** Every outstanding Curator request, in the same order the dice tray's lock
   *  queue holds them. Ability-armed locks are NOT prompts: the player pressed
   *  the ability themselves and is already looking at the tray. */
  requests: RollLock[];
  /** Roll it. `source` is null when the request has only one legal source. */
  onRoll: (lock: RollLock, source: RollPromptSource | null, mode: RollMode) => void;
  /** The player closed the card. The request STAYS in the tray's lock queue —
   *  see the component note. */
  onDismiss: (lock: RollLock) => void;
  /** An expired request is discarded outright: there is nothing left to answer. */
  onDrop: (lock: RollLock) => void;
  onOpenTray: () => void;
}

function modeFor(event: React.MouseEvent): RollMode {
  if (event.shiftKey) return "adv";
  if (event.ctrlKey || event.altKey) return "dis";
  return "normal";
}

function countdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

/**
 * Being asked for a roll ASKS you.
 *
 * Before this, a targeted save arrived as a queue entry inside the roll dock —
 * the request forced the dock open and the player had to notice a banner in a
 * side panel and operate the tray under it. This card says who asked, what for,
 * against what, and rolls it in one press.
 *
 * Three things it deliberately is not:
 *
 * - Not modal. No backdrop, no autofocus, no global key handler. The map stays
 *   live underneath and a player mid-way through typing a note keeps their
 *   caret. Escape only dismisses while focus is already inside a card.
 * - Not the only copy. Dismissing HIDES the card; the request stays in the
 *   tray's lock queue, so a closed prompt costs a click, not the roll.
 * - Not a second roll path. Every button here goes back out through the same
 *   `commitRoll` the tray uses, so the result is validated, logged, published
 *   and settles its Resolution Card exactly as a tray roll does.
 *
 * When a request offers two Roll Axis sources, the source buttons ARE the roll
 * buttons. Making the player pick attribute-or-specialty and then press Roll is
 * the two-step the dock already had.
 */
export function VttRollPrompt({ requests, onRoll, onDismiss, onDrop, onOpenTray }: Props) {
  const [hidden, setHidden] = useState<string[]>([]);
  const [now, setNow] = useState(() => Date.now());

  // A dismissed id is only meaningful while its request is still outstanding.
  // Without this the list grows for the whole session, and a request the
  // Curator sends again would stay silently hidden if an id were ever reused.
  useEffect(() => {
    setHidden((current) => {
      const kept = current.filter((id) => requests.some((lock) => lock.requestId === id));
      return kept.length === current.length ? current : kept;
    });
  }, [requests]);

  const visible = requests.filter((lock) => !!lock.requestId && !hidden.includes(lock.requestId));
  const timed = visible.some((lock) => lock.expiresAt != null);

  // The deadline has to run down on screen. Ticking only while a timed request
  // is showing keeps an idle table from re-rendering this once a second forever.
  useEffect(() => {
    if (!timed) return;
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [timed]);

  // Publish how tall this lane is, so the roll toasts can sit BELOW it instead
  // of underneath it. Both lanes are centred at the same top, and this one's
  // ground is opaque — every result at the table was invisible while a question
  // was up, including the answer to the roll just made.
  const laneRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = laneRef.current;
    const clear = () => document.documentElement.style.removeProperty("--roll-prompt-lane");
    if (!node || visible.length === 0) {
      clear();
      return clear;
    }
    const publish = () =>
      document.documentElement.style.setProperty("--roll-prompt-lane", `${Math.ceil(node.offsetHeight) + 10}px`);
    publish();
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(publish) : null;
    observer?.observe(node);
    return () => {
      observer?.disconnect();
      clear();
    };
  }, [visible.length, now]);

  if (visible.length === 0) return null;

  return (
    <div ref={laneRef} className="vtt2-rollprompts" role="region" aria-label="Rolls asked of you" aria-live="polite">
      {visible.length > 1 && (
        <div className="vtt2-rollprompt-count">{visible.length} rolls are waiting on you</div>
      )}
      {visible.map((lock) => {
        const expired = rollLockExpired(lock, now);
        const sources = lock.choices?.length ? lock.choices : null;
        // A Curator answering for an NPC on their own machine: the lock names
        // the body that rolls, and nobody "asked" them but themselves.
        const asker = lock.actor?.name
          ? `You are rolling for ${lock.actor.name}`
          : `${lock.requestedBy || "The Curator"} asks you to roll`;
        return (
          <div
            key={lock.requestId}
            className={"vtt2-rollprompt" + (expired ? " expired" : "")}
            onKeyDown={(event) => {
              if (event.key !== "Escape") return;
              event.stopPropagation();
              if (expired) onDrop(lock);
              else {
                setHidden((current) => [...current, lock.requestId!]);
                onDismiss(lock);
              }
            }}
          >
            <div className="vtt2-rollprompt-head">
              <span className="vtt2-rollprompt-from">{asker}</span>
              <button
                className="cdx-tab-x"
                aria-label={expired ? "Discard this expired request" : "Close — the roll stays in the dice tray"}
                title={expired ? "Discard this expired request" : "Close — the roll stays in the dice tray"}
                onClick={() => {
                  if (expired) onDrop(lock);
                  else {
                    setHidden((current) => [...current, lock.requestId!]);
                    onDismiss(lock);
                  }
                }}
              >
                ×
              </button>
            </div>

            <div className="vtt2-rollprompt-label">{lock.label}</div>

            <div className="vtt2-rollprompt-meta">
              {lock.dc != null && <span className="vtt2-rollprompt-dv">vs DV {lock.dc}</span>}
              {lock.expiresAt != null && (
                <span className={"vtt2-rollprompt-clock" + (expired ? " out" : "")}>
                  {expired ? "expired" : `${countdown(lock.expiresAt - now)} left`}
                </span>
              )}
            </div>

            {expired ? (
              <>
                <p className="equip-warn vtt2-rollprompt-dead">
                  This request timed out — nothing was rolled, and the Curator's table has already let it go. Ask them
                  to send it again.
                </p>
                <button className="ghost-btn vtt2-rollprompt-go" onClick={() => onDrop(lock)}>
                  Discard
                </button>
              </>
            ) : sources ? (
              <div className="vtt2-axis-choices vtt2-rollprompt-choices" role="group" aria-label="Roll it with">
                {sources.map((source) => (
                  <button
                    key={`${source.label}|${source.expr}`}
                    type="button"
                    className="ghost-btn"
                    title={`Roll ${source.expr} · Shift-click: Advantage · Right-click: Disadvantage`}
                    onClick={(event) => onRoll(lock, source, modeFor(event))}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      onRoll(lock, source, "dis");
                    }}
                  >
                    Roll {source.label}
                    <small>{source.detail || source.expr}</small>
                  </button>
                ))}
              </div>
            ) : lock.expr ? (
              <button
                className="primary-btn vtt2-rollprompt-go"
                title={`Roll ${lock.expr} · Shift-click: Advantage · Right-click: Disadvantage`}
                onClick={(event) => onRoll(lock, null, modeFor(event))}
                onContextMenu={(event) => {
                  event.preventDefault();
                  onRoll(lock, null, "dis");
                }}
              >
                Roll {lock.expr}
              </button>
            ) : (
              <p className="equip-warn vtt2-rollprompt-dead">
                This request arrived without dice. Roll it by hand in the dice tray.
              </p>
            )}
          </div>
        );
      })}
      <button className="chip vtt2-rollprompt-tray" onClick={onOpenTray}>
        Open the dice tray
      </button>
    </div>
  );
}
