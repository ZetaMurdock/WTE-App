import { useEffect, useState } from "react";
import { useNet } from "../net/NetContext";

// The visual-novel dialogue box: speaker portrait on the left, the Curator's line
// underneath. Sits over the VTT canvas on EVERY screen at the table — the Curator
// pushes it, players receive it. Purely presentational; the content and lifetime
// are decided by the controller.
export function VttDialogue() {
  const net = useNet();
  const d = net.dialogue;
  const isCurator = net.role === "host";
  // Type the line on rather than dumping it, which reads as speech instead of a
  // status dump. Skipped for beacons, which are announcements, not talking.
  const full = d?.text ?? "";
  const typed = useTypewriter(full, d?.kind !== "beacon");

  if (!d) return null;
  const beacon = d.kind === "beacon";

  return (
    <div className={"vtt-dlg" + (beacon ? " beacon" : "")} role="status" aria-live="polite">
      {!beacon && (
        <div className="vtt-dlg-portrait">
          {d.portrait ? (
            <img src={d.portrait} alt={d.speaker || "Speaker"} />
          ) : (
            <div className="vtt-dlg-noface" aria-hidden>
              {(d.speaker || "?").slice(0, 1).toUpperCase()}
            </div>
          )}
        </div>
      )}
      <div className="vtt-dlg-body">
        {d.speaker && <div className="vtt-dlg-speaker">{d.speaker}</div>}
        <div className="vtt-dlg-text">
          {typed}
          {typed.length < full.length && <span className="vtt-dlg-caret" aria-hidden />}
        </div>
      </div>
      {isCurator && (
        <button className="vtt-dlg-close" title="Clear this from every screen" onClick={() => net.setDialogue(null)}>
          ×
        </button>
      )}
    </div>
  );
}

/** Reveal `text` a character at a time. Re-runs whenever the text changes, and
 *  returns the whole string immediately when disabled. */
function useTypewriter(text: string, enabled: boolean): string {
  const [n, setN] = useState(text.length);
  useEffect(() => {
    if (!enabled) {
      setN(text.length);
      return;
    }
    setN(0);
    if (!text) return;
    const id = window.setInterval(() => {
      setN((cur) => {
        if (cur >= text.length) {
          window.clearInterval(id);
          return cur;
        }
        return cur + 1;
      });
    }, 18);
    return () => window.clearInterval(id);
  }, [text, enabled]);
  return text.slice(0, n);
}
