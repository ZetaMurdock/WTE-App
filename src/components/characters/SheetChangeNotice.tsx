import { useEffect, useState } from "react";
import {
  clearSheetNotices,
  dismissSheetNotice,
  noticeWhen,
  pendingSheetNotices,
  subscribeSheetNotices,
  type SheetNotice,
} from "../../lib/sheetNotices";

interface Props {
  characterId: string;
}

// The small notice at the top of a character sheet saying what someone else
// changed on it while you were not looking — a Curator adjusting rank, damage or
// gear between sessions, or doing it live in the room right now.
//
// THREE THINGS IT DELIBERATELY IS NOT:
//
//  - It is not a modal. The sheet is fully usable behind it; a player who does not
//    care can just play. A Curator edit is information, not an interruption.
//  - It does not take focus. Nothing here autofocuses, so a player mid-keystroke
//    in a stat box when an edit lands keeps their cursor where it was.
//  - It is not one merged summary. Each edit keeps its own author and time,
//    because "Curator, Friday: Rank 3 → 4" and "Curator, Monday: HP 40 → 12" are
//    two different pieces of news.
//
// It is subscribed rather than read once: an edit that arrives while the sheet is
// open must appear immediately, which is the live half of the same request.
export function SheetChangeNotice({ characterId }: Props) {
  const [notices, setNotices] = useState<SheetNotice[]>(() => pendingSheetNotices(characterId));
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setNotices(pendingSheetNotices(characterId));
    return subscribeSheetNotices((id) => {
      if (id === characterId) setNotices(pendingSheetNotices(characterId));
    });
  }, [characterId]);

  if (notices.length === 0) return null;

  const total = notices.reduce((n, x) => n + x.changes.length, 0);
  const latest = notices[notices.length - 1];
  // Collapsed, the banner still names the most recent editor and the newest
  // change, so the common case — one small edit — needs no click at all.
  const summary =
    notices.length === 1 && latest.changes.length === 1
      ? latest.changes[0]
      : `${total} change${total === 1 ? "" : "s"} across ${notices.length} edit${notices.length === 1 ? "" : "s"}`;

  return (
    <div className="sheet-notice" role="status" aria-live="polite">
      <div className="sheet-notice-head">
        <span className="sheet-notice-lede">
          <b>{latest.by}</b> changed your sheet · {noticeWhen(latest.at)}
        </span>
        <span className="sheet-notice-sum">{summary}</span>
        <button
          className="link-btn sheet-notice-toggle"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          title={open ? "Hide the details" : "Show what changed"}
        >
          {open ? "Hide" : "What changed?"}
        </button>
        <button
          className="link-btn"
          onClick={() => clearSheetNotices(characterId)}
          title="Dismiss — you have read these"
        >
          Got it
        </button>
      </div>

      {open && (
        <ul className="sheet-notice-list">
          {[...notices].reverse().map((n) => (
            <li key={n.id} className="sheet-notice-entry">
              <div className="sheet-notice-by">
                <b>{n.by}</b> · {noticeWhen(n.at)}
                <button
                  className="link-btn sheet-notice-drop"
                  onClick={() => dismissSheetNotice(characterId, n.id)}
                  title="Dismiss just this edit"
                >
                  Dismiss
                </button>
              </div>
              <ul className="sheet-notice-changes">
                {n.changes.map((c, i) => (
                  <li key={i}>{c}</li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
