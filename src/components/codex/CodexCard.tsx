import type { CodexEntity } from "../../game/codexEntity";
import type { Resolution } from "../../game/codexRegistry";
import { explain, resolveRule, type RuleLayer } from "../../game/ruleLayers";

interface Props {
  /** A resolved concept. Ambiguity is the caller's to handle — this card shows one
   *  definition, and quietly rendering the first of several would undo the
   *  resolver's refusal to guess. */
  resolution: Resolution;
  /** Layers affecting a numeric field, for the "why is this different?" breakdown. */
  layers?: RuleLayer[];
  onOpenPage: (stem: string, anchor?: string) => void;
  onClose: () => void;
  /** The Codex is still loading, so an override may yet arrive. Said out loud
   *  rather than showing a number that might change a second later. */
  pending?: boolean;
  /** Section to scroll to within the source page. The official corpus groups many
   *  abilities per page, so the stem alone lands you at the top of a long file. */
  anchor?: string;
}

/** What a definition's source is CALLED, per scope. "Modified by this campaign"
 *  on a character exception or a session effect was simply wrong. */
function sourceLabel(e: CodexEntity): string {
  switch (e.scope) {
    case "wte":
      return "Official W.T.E";
    case "pack":
      return "From a content pack";
    case "campaign":
      return "Modified by this campaign";
    case "character":
      return "An exception for this character";
    case "session":
      return "A temporary effect this session";
    default:
      return "Modified";
  }
}

interface Genusish {
  domain?: string;
  ss?: number;
  activation?: string;
  range?: string;
  target?: string;
  effect?: string;
  limit?: string;
}

const rows: { label: string; key: keyof Genusish }[] = [
  { label: "Domain", key: "domain" },
  { label: "Activation", key: "activation" },
  { label: "Range", key: "range" },
  { label: "Target", key: "target" },
  { label: "Limit", key: "limit" },
];

// The contextual card: what a term means HERE, where that meaning came from, and
// what it would have been officially. This is the first place the Codex answers a
// question rather than just storing an answer.
export function CodexCard({ resolution, layers, onOpenPage, onClose, pending, anchor }: Props) {
  const e: CodexEntity = resolution.resolvedDefinition;
  const official = resolution.officialDefinition;
  const data = (e.data ?? {}) as Genusish;
  const officialData = (official?.data ?? {}) as Genusish;
  const overridden = resolution.provenance.overridden;

  // The SS breakdown, when layers touch it.
  //
  // The base is the RESOLVED definition's value — the campaign's rule when there
  // is one. Starting from the official value applied the layers to a number
  // nobody was playing with, so an override and a numeric layer could not both be
  // honoured: whichever total you read, one of them had silently been dropped.
  const baseSs = typeof data.ss === "number" ? data.ss : (officialData.ss ?? 0);
  const resolved = layers && layers.length ? resolveRule(baseSs, layers) : null;
  const shownSs = resolved ? resolved.value : data.ss;
  // Name the base for what it is, so the arithmetic adds up on screen.
  const baseLabel = overridden ? sourceLabel(e) : "Base W.T.E rule";

  return (
    <div className="vtt2-sheet-overlay" onMouseDown={onClose}>
      <div className="codex-card" onMouseDown={(ev) => ev.stopPropagation()}>
        <div className="vtt2-insp-head">
          <span className="panel-title" style={{ margin: 0 }}>
            {e.name}
          </span>
          <button className="cdx-tab-x" onClick={onClose} title="Close">
            ×
          </button>
        </div>

        <div className="codex-card-badges">
          <span className={"codex-src " + (overridden ? "campaign" : "official")}>{sourceLabel(e)}</span>
          {pending && <span className="codex-alias">still loading — an override may yet apply</span>}
          {e.visibility === "curator" && <span className="codex-src gm">Curator only</span>}
          {e.aliases.length > 0 && (
            <span className="codex-alias" title={"Also known as: " + e.aliases.join(", ")}>
              also {e.aliases.join(", ")}
            </span>
          )}
        </div>

        <dl className="codex-card-grid">
          {typeof shownSs === "number" && (
            <>
              <dt>SS</dt>
              <dd>
                {shownSs}
                {typeof officialData.ss === "number" && officialData.ss !== shownSs && (
                  <span className="codex-was"> (officially {officialData.ss})</span>
                )}
              </dd>
            </>
          )}
          {rows.map(({ label, key }) =>
            data[key] ? (
              <div className="codex-row" key={key}>
                <dt>{label}</dt>
                <dd>
                  {String(data[key])}
                  {official && officialData[key] && officialData[key] !== data[key] && (
                    <span className="codex-was"> (officially {String(officialData[key])})</span>
                  )}
                </dd>
              </div>
            ) : null
          )}
        </dl>

        {data.effect && <p className="codex-effect">{data.effect}</p>}

        {/* Why is this different? The breakdown, only when there IS a difference. */}
        {resolved && resolved.trail.length > 0 && (
          <div className="codex-why">
            <div className="panel-title mt">Why is this different?</div>
            <table className="codex-why-table">
              <tbody>
                {explain(resolved, baseLabel).map((r, i) => (
                  <tr key={i} className={r.label === "Final" ? "final" : undefined}>
                    <td>{r.label}</td>
                    <td>{r.value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {overridden && official && (
          <p className="codex-why-note">
            This table replaced the official definition. The original is still on record and comes back if the override
            is removed.
          </p>
        )}

        <div className="codex-card-actions">
          {e.sourcePage && (
            <button className="primary-btn" onClick={() => onOpenPage(e.sourcePage, anchor)}>
              Open full Codex page
            </button>
          )}
          {overridden && official && official.sourcePage !== e.sourcePage && (
            <button className="ghost-btn" onClick={() => onOpenPage(official.sourcePage)}>
              Open the official page
            </button>
          )}
        </div>

        <p className="codex-card-id" title="This never changes, even when the page is renamed">
          {e.id}
        </p>
      </div>
    </div>
  );
}
