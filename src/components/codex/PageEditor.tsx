import { useState } from "react";

export interface PageDraft {
  title: string;
  content: string;
  label: string;
}

interface Props {
  /** Existing page being edited (title locked), or undefined for a new page. */
  initial?: PageDraft;
  /** Base pull targets + any custom labels already in use, offered in the picker. */
  labels: string[];
  onSave: (draft: PageDraft) => void;
  onCancel: () => void;
}

// Author or edit a Codex page: title, section label (base pull target or a new
// custom label that spawns its own section), and markdown body. Engineer-only.
export function PageEditor({ initial, labels, onSave, onCancel }: Props) {
  const editing = !!initial;
  const [title, setTitle] = useState(initial?.title ?? "");
  const [content, setContent] = useState(initial?.content ?? "");
  const [label, setLabel] = useState(initial?.label ?? labels[0] ?? "");
  const [newLabel, setNewLabel] = useState("");
  const [creatingLabel, setCreatingLabel] = useState(false);

  const effectiveLabel = creatingLabel ? newLabel.trim() : label;
  const canSave = title.trim().length > 0 && effectiveLabel.length > 0;

  function save() {
    if (!canSave) return;
    onSave({ title: title.trim(), content, label: effectiveLabel });
  }

  return (
    <div className="page-editor-scrim" onClick={onCancel}>
      <div className="page-editor" onClick={(e) => e.stopPropagation()}>
        <div className="vtt2-insp-head">
          <span className="panel-title" style={{ margin: 0 }}>
            {editing ? "Edit page" : "New page"}
          </span>
          <button className="cdx-tab-x" onClick={onCancel} title="Close">
            ×
          </button>
        </div>

        <label className="lobby-field">
          <span>Title</span>
          <input
            className="bg-select full"
            value={title}
            disabled={editing}
            placeholder="Page title…"
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>

        <div className="lobby-field mt">
          <span>Section label</span>
          {creatingLabel ? (
            <div className="pe-label-row">
              <input
                className="bg-select full"
                autoFocus
                placeholder="New section name (e.g. Vehicles)…"
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
              />
              <button className="chip" onClick={() => setCreatingLabel(false)} title="Pick an existing label instead">
                ↩
              </button>
            </div>
          ) : (
            <div className="pe-label-row">
              <select className="bg-select full" value={label} onChange={(e) => setLabel(e.target.value)}>
                {labels.map((l) => (
                  <option key={l} value={l}>
                    {l}
                  </option>
                ))}
              </select>
              <button className="chip" onClick={() => setCreatingLabel(true)} title="Create a new section label">
                ＋ New
              </button>
            </div>
          )}
          <p className="pe-hint">
            A base target (Creature/Weapon/…) links the page into that catalog; a new label spawns its own Codex section.
          </p>
        </div>

        <label className="lobby-field mt">
          <span>Content (Markdown)</span>
          <textarea
            className="bg-select full pe-content"
            value={content}
            placeholder="# Heading&#10;&#10;Write the page…"
            onChange={(e) => setContent(e.target.value)}
          />
        </label>

        <div className="pe-actions">
          <button className="ghost-btn" onClick={onCancel}>
            Cancel
          </button>
          <button className="primary-btn" disabled={!canSave} onClick={save}>
            {editing ? "Save changes" : "Create page"}
          </button>
        </div>
      </div>
    </div>
  );
}
