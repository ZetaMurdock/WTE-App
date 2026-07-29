import { useMemo } from "react";
import { CodexCard } from "./CodexCard";
import { codexManifest, codexRegistry, codexStatus } from "../../game/codexService";
import { useCodex } from "../../game/useCodex";
import { codexCtx } from "../../game/resolvedGenus";
import { layersFor, type RuleLayer } from "../../game/ruleLayers";
import type { CodexEntity } from "../../game/codexEntity";

interface Props {
  /** What the character stores — a stable id or a legacy name. */
  storedRef: string;
  campaignId?: string | null;
  characterId?: string | null;
  sessionId?: string | null;
  /** The reader's role, stated rather than read from local storage. */
  role?: "player" | "curator";
  /** Every layer known for this campaign; filtered here against the full context. */
  layers?: RuleLayer[];
  onOpenPage: (stem: string, anchor?: string) => void;
  onClose: () => void;
}

// The contextual card, resolved.
//
// CodexCard itself only ever renders ONE definition — deliberately, so nothing
// can quietly show the first of several. That makes the ambiguous and not-found
// cases this component's job, and they are the interesting ones: a term the
// Codex cannot decide about must produce a question, not a guess.
export function CodexLookup({
  storedRef,
  campaignId,
  characterId,
  sessionId,
  layers,
  role,
  onOpenPage,
  onClose,
}: Props) {
  const ctx = { ...codexCtx(campaignId, characterId, role), sessionId: sessionId ?? undefined };
  // Keyed on the REVISION, not the status: a ready -> ready reload changes every
  // answer while the status string stays "ready", so an open card kept showing
  // the definition that was in force when it opened.
  const { revision } = useCodex();
  const status = codexStatus();
  const result = useMemo(
    () => codexRegistry().resolveReference(storedRef, ctx),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [storedRef, campaignId, characterId, sessionId, role, revision]
  );

  // Layers are filtered against the WHOLE context — campaign, character and
  // session — not just the target id. An exception written for one character
  // would otherwise show up on everyone's card.
  const applicable = useMemo(() => {
    if (!result || result.ambiguous) return [];
    return layersFor(layers ?? [], result.conceptId, {
      campaignId: campaignId ?? undefined,
      characterId: characterId ?? undefined,
      sessionId: sessionId ?? undefined,
    });
  }, [layers, result, campaignId, characterId, sessionId]);

  if (result && !result.ambiguous) {
    return (
      <CodexCard
        resolution={result}
        layers={applicable}
        onOpenPage={onOpenPage}
        onClose={onClose}
        pending={status === "loading"}
        anchor={codexManifest().pages.get(result.conceptId)?.anchor}
      />
    );
  }

  return (
    <div className="vtt2-sheet-overlay" onMouseDown={onClose}>
      <div className="codex-card" onMouseDown={(ev) => ev.stopPropagation()}>
        <div className="vtt2-insp-head">
          <span className="panel-title" style={{ margin: 0 }}>
            {result ? "Which one do you mean?" : storedRef}
          </span>
          <button className="cdx-tab-x" onClick={onClose} title="Close">
            ×
          </button>
        </div>

        {result && result.ambiguous ? (
          <>
            <p className="codex-why-note">
              {result.conflictingId
                ? `Two Codex records both claim the id ${result.conflictingId}. Until one of them is changed, nothing can say which this refers to.`
                : `“${result.term}” names more than one thing here.`}
            </p>
            <ul className="diag-list">
              {result.candidates.map((c: CodexEntity) => (
                <li key={c.id}>
                  <b>{c.name}</b> <span className="diag-dim">({c.kind})</span>
                  {c.sourcePage && (
                    <>
                      {" — "}
                      <button className="ghost-btn xs" onClick={() => onOpenPage(c.sourcePage)}>
                        open its page
                      </button>
                    </>
                  )}
                  <div className="codex-card-id">{c.id}</div>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p className="codex-why-note">
            {status === "loading"
              ? "The Codex is still loading. This may resolve in a moment."
              : "Nothing in the Codex answers to this. It is kept on the character exactly as written — the page it came from may simply not be installed here."}
          </p>
        )}

        <div className="codex-card-actions">
          <button className="primary-btn" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
