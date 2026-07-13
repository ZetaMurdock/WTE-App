import type { VttScene } from "./types/scene";

interface Props {
  scenes: VttScene[];
  activeId: string | null;
  onSwitch: (id: string) => void;
  onCreate: () => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}

// VTT v2 (slice 7): the Scene Browser. Lists the active campaign's scenes and
// drives create/rename/delete/switch through VttScreen, which owns persistence.
export function VttSceneBrowser({ scenes, activeId, onSwitch, onCreate, onRename, onDelete, onClose }: Props) {
  function handleRename(s: VttScene) {
    const next = prompt("Rename scene", s.name);
    if (next && next.trim()) onRename(s.id, next.trim());
  }
  function handleDelete(s: VttScene) {
    if (confirm(`Delete "${s.name}"? This can't be undone.`)) onDelete(s.id);
  }

  return (
    <div className="vtt2-browser">
      <div className="vtt2-insp-head">
        <span className="panel-title" style={{ margin: 0 }}>
          Scenes
        </span>
        <button className="cdx-tab-x" onClick={onClose} title="Close">
          ×
        </button>
      </div>

      {scenes.length === 0 ? (
        <p className="list-empty" style={{ margin: "6px 0 10px" }}>
          No scenes yet.
        </p>
      ) : (
        <ul className="vtt2-scene-list">
          {scenes.map((s) => (
            <li key={s.id} className={"vtt2-scene-row" + (s.id === activeId ? " active" : "")}>
              <button className="vtt2-scene-open" onClick={() => onSwitch(s.id)} title="Switch to this scene">
                <span className="vtt2-scene-dot" />
                <span className="vtt2-scene-label">{s.name}</span>
                <span className="vtt2-scene-tokens">{s.data.tokens.length}</span>
              </button>
              <button className="icon-btn sm" onClick={() => handleRename(s)} title="Rename scene">
                ✎
              </button>
              {scenes.length > 1 && (
                <button className="icon-btn sm" onClick={() => handleDelete(s)} title="Delete scene">
                  ✕
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      <button className="vtt2-scene-new" onClick={onCreate}>
        + New scene
      </button>
    </div>
  );
}
