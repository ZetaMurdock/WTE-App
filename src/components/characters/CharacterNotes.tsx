import { useEffect, useState } from "react";
import { renderCodexHtml } from "../../lib/md";
import { patchCharacterSheet, type CharacterRecord } from "../../lib/characters";

interface Props {
  character: CharacterRecord;
  /** Curator or the owner may edit; others (a shared/opened sheet) read-only. */
  editable?: boolean;
  onClose: () => void;
  onSaved: () => void;
}

// Full-Markdown notes attached to a character — lore, session logs, secrets.
// Split editor (write) / preview (rendered) with a live toggle; saves into
// sheet.notesMd. Rendering reuses the Codex markdown renderer (bold/italic/
// headings/lists/tables/links + raw-HTML passthrough).
export function CharacterNotes({ character, editable = true, onClose, onSaved }: Props) {
  const [md, setMd] = useState(character.sheet.notesMd ?? "");
  const [tab, setTab] = useState<"write" | "preview">(editable ? "write" : "preview");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onEsc);
    return () => window.removeEventListener("keydown", onEsc);
  }, [onClose]);

  async function save() {
    if (!dirty) return onClose();
    setSaving(true);
    await patchCharacterSheet(character.id, { notesMd: md });
    setSaving(false);
    setDirty(false);
    onSaved();
    onClose();
  }

  return (
    <div className="vtt2-sheet-overlay" onMouseDown={onClose}>
      <div className="char-notes" onMouseDown={(e) => e.stopPropagation()}>
        <div className="vtt2-insp-head">
          <span className="panel-title" style={{ margin: 0 }}>Notes · {character.name}</span>
          <div style={{ display: "flex", gap: 4 }}>
            {editable && (
              <div className="chip-row">
                <button className={"chip" + (tab === "write" ? " active" : "")} onClick={() => setTab("write")}>Write</button>
                <button className={"chip" + (tab === "preview" ? " active" : "")} onClick={() => setTab("preview")}>Preview</button>
              </div>
            )}
            <button className="cdx-tab-x" onClick={onClose} title="Close">×</button>
          </div>
        </div>

        {tab === "write" && editable ? (
          <textarea
            className="char-notes-editor"
            placeholder="Markdown supported — **bold**, *italic*, # headings, - lists, [links](url), tables…"
            value={md}
            autoFocus
            onChange={(e) => { setMd(e.target.value); setDirty(true); }}
          />
        ) : (
          <div className="char-notes-preview cdx-content" dangerouslySetInnerHTML={{ __html: md.trim() ? renderCodexHtml(md) : "<p class='list-empty'>No notes yet.</p>" }} />
        )}

        {editable && (
          <div className="char-notes-foot">
            <button className="ghost-btn" onClick={onClose}>Cancel</button>
            <button className="primary-btn" onClick={() => void save()} disabled={saving}>
              {saving ? "Saving…" : dirty ? "Save notes" : "Done"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
