import { useCallback, useEffect, useState } from "react";
import { CodexLookup } from "./CodexLookup";
import { codexRegistry, codexStatus } from "../../game/codexService";
import { codexCtx } from "../../game/resolvedGenus";
import { openCodexPage } from "../../lib/openCodexPage";
import type { RuleLayer } from "../../game/ruleLayers";

interface Props {
  campaignId?: string | null;
  characterId?: string | null;
  layers?: RuleLayer[];
}

/** Longer than this is prose, not a term. Shorter is a fragment of a word. */
const MIN = 2;
const MAX = 80;

interface Pending {
  x: number;
  y: number;
  text: string;
}

// Select a term ANYWHERE, ask what it means here.
//
// This is the Codex's central promise, and it only works if it works everywhere:
// on a character sheet, in a scene description, in a note, in the reader. So the
// listener is global rather than owned by one panel, and it is deliberately
// quiet — the chip appears only when the selection actually resolves to
// something, so highlighting an ordinary sentence does not litter the screen
// with an offer that would go nowhere.
//
// Resolution runs through the same registry and the same context as the sheet
// and the VTT, which is what makes visibility hold: a player selecting the name
// of a Curator-only ability gets no chip at all, because as far as the resolver
// is concerned there is nothing there.
export function LookUpSelection({ campaignId, characterId, layers }: Props) {
  const [pending, setPending] = useState<Pending | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const status = codexStatus();

  const resolves = useCallback(
    (term: string): boolean => {
      const r = codexRegistry().resolveTerm(term, codexCtx(campaignId, characterId));
      // An ambiguity counts: "this means two things here" is a real answer, and
      // arguably the most useful one to be offered.
      return !!r;
    },
    [campaignId, characterId]
  );

  useEffect(() => {
    function onUp(e: MouseEvent) {
      // Never steal the click that opens the card, or a click inside it.
      const t = e.target as HTMLElement | null;
      if (t?.closest?.(".codex-lookup-chip, .codex-card")) return;

      const sel = window.getSelection();
      const text = sel ? sel.toString().trim() : "";
      if (text.length < MIN || text.length > MAX || !resolves(text)) {
        setPending(null);
        return;
      }
      setPending({ x: e.clientX, y: e.clientY, text });
    }
    // Any new selection invalidates the offer.
    function onDown(e: MouseEvent) {
      const t = e.target as HTMLElement | null;
      if (t?.closest?.(".codex-lookup-chip")) return;
      setPending(null);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setPending(null);
        setOpen(null);
      }
    }
    document.addEventListener("mouseup", onUp);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mouseup", onUp);
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
    // status is a dependency because a term that resolved to nothing while the
    // Codex was loading may resolve once it is ready.
  }, [resolves, status]);

  return (
    <>
      {pending && !open && (
        <button
          className="codex-lookup-chip"
          style={{ left: pending.x, top: pending.y + 14 }}
          onClick={() => {
            setOpen(pending.text);
            setPending(null);
            window.getSelection()?.removeAllRanges();
          }}
        >
          Look up “{pending.text.length > 24 ? pending.text.slice(0, 24) + "…" : pending.text}”
        </button>
      )}

      {open && (
        <CodexLookup
          storedRef={open}
          campaignId={campaignId}
          characterId={characterId}
          layers={layers}
          onOpenPage={(stem, anchor) => {
            openCodexPage(stem, anchor);
            setOpen(null);
          }}
          onClose={() => setOpen(null)}
        />
      )}
    </>
  );
}
