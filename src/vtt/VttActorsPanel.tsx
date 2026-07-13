import type { CharacterRecord } from "../lib/characters";

interface Props {
  characters: CharacterRecord[];
  loading: boolean;
  onSpawn: (rec: CharacterRecord) => void;
  onRefresh: () => void;
  onClose: () => void;
}

// VTT v2 (slice 8): the Actors panel. Spawns vault characters as HP/stat-linked
// tokens. Codex creatures arrive over the wte-spawn-creature bridge (see
// VttScreen) rather than from here — the hint at the bottom points that out.
export function VttActorsPanel({ characters, loading, onSpawn, onRefresh, onClose }: Props) {
  return (
    <div className="vtt2-actors">
      <div className="vtt2-insp-head">
        <span className="panel-title" style={{ margin: 0 }}>
          Actors
        </span>
        <div style={{ display: "flex", gap: 4 }}>
          <button className="icon-btn sm" onClick={onRefresh} title="Reload the vault">
            ⟳
          </button>
          <button className="cdx-tab-x" onClick={onClose} title="Close">
            ×
          </button>
        </div>
      </div>

      {loading ? (
        <p className="list-empty" style={{ margin: "6px 0 10px" }}>
          Loading vault…
        </p>
      ) : characters.length === 0 ? (
        <p className="list-empty" style={{ margin: "6px 0 10px" }}>
          No characters in this campaign's vault yet.
        </p>
      ) : (
        <ul className="vtt2-actor-list">
          {characters.map((c) => (
            <li key={c.id} className="vtt2-actor-row">
              <span className="vtt2-actor-label">{c.name}</span>
              <button className="chip" onClick={() => onSpawn(c)} title="Spawn a linked token at the view centre">
                Spawn
              </button>
            </li>
          ))}
        </ul>
      )}

      <p className="vtt2-actor-hint">Codex creatures spawn here via the Codex's “Spawn in VTT”.</p>
    </div>
  );
}
