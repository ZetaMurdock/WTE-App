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
  const handouts = character.sheet.handouts ?? [];
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

        {/* WHAT THE CURATOR HANDED YOU, above your own writing and never mixed
            into it. A handout is someone else's words with someone else's name
            on them; folding it into `notesMd` would make it indistinguishable
            from something you wrote and forgot — and would put the Curator's
            paragraph and yours in one field for sheetMerge to have to choose
            between. Read-only here on purpose: taking one back is the Curator's
            act, from the party synopsis. */}
        {handouts.length > 0 && (
          <div className="char-handouts">
            <div className="panel-title">Handed to you</div>
            {handouts.map((h) => (
              <div className="char-handout" key={h.id}>
                <div className="char-handout-head">
                  <b>{h.title}</b>
                  <span>{h.by} · {new Date(h.at).toLocaleDateString()}</span>
                </div>
                {h.text.trim() && (
                  <div className="cdx-content" dangerouslySetInnerHTML={{ __html: renderCodexHtml(h.text) }} />
                )}
              </div>
            ))}
          </div>
        )}

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
