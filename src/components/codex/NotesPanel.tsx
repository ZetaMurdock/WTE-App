import { useState } from "react";
import type { CodexNote } from "../../models/note";

// Inline note list + editors. Used on every Codex page (attached notes) and by the
// wte://notes index (all notes, with backlinks to their pages).

interface Props {
  notes: CodexNote[];
  curator: boolean;
  onSave: (n: CodexNote) => void;
  onDelete: (id: string) => void;
  /** Present on the all-notes index — renders a backlink to the attached page. */
  onOpenPage?: (stem: string) => void;
}

export function NotesPanel({ notes, curator, onSave, onDelete, onOpenPage }: Props) {
  const [tagDrafts, setTagDrafts] = useState<Record<string, string>>({});

  const visible = notes.filter((n) => curator || n.visibility !== "gm");
  if (visible.length === 0) return <p className="list-empty">No notes yet.</p>;

  function addTag(n: CodexNote) {
    const t = (tagDrafts[n.id] || "").trim();
    if (!t || n.tags.includes(t)) return;
    onSave({ ...n, tags: [...n.tags, t] });
    setTagDrafts((d) => ({ ...d, [n.id]: "" }));
  }

  return (
    <div className="notes-list">
      {visible.map((n) => (
        <div className={"note-card" + (n.visibility === "gm" ? " gm" : "")} key={n.id}>
          <div className="note-head">
            <input
              className="note-title"
              placeholder="Note title…"
              value={n.title}
              onChange={(e) => onSave({ ...n, title: e.target.value })}
            />
            {n.attachedTo && onOpenPage && (
              <button className="link-btn" onClick={() => onOpenPage(n.attachedTo!)}>
                {n.attachedTo.replace(/_/g, " ")}
              </button>
            )}
            {curator && (
              <button
                className={"chip" + (n.visibility === "gm" ? " active" : "")}
                title="GM-only notes stay hidden from players"
                onClick={() => onSave({ ...n, visibility: n.visibility === "gm" ? "player" : "gm" })}
              >
                {n.visibility === "gm" ? "GM only" : "Player visible"}
              </button>
            )}
            <button className="cdx-tab-x" title="Delete note" onClick={() => onDelete(n.id)}>
              ×
            </button>
          </div>
          {n.quote && <blockquote className="note-quote">“{n.quote}”</blockquote>}
          <textarea
            className="note-body"
            placeholder="Write the note…"
            value={n.body}
            onChange={(e) => onSave({ ...n, body: e.target.value })}
          />
          <div className="note-tags">
            {n.tags.map((t) => (
              <button key={t} className="chip" title="Remove tag" onClick={() => onSave({ ...n, tags: n.tags.filter((x) => x !== t) })}>
                {t} ×
              </button>
            ))}
            <input
              className="note-tag-input"
              placeholder="+ tag (session, clue, npc…)"
              value={tagDrafts[n.id] || ""}
              onChange={(e) => setTagDrafts((d) => ({ ...d, [n.id]: e.target.value }))}
              onKeyDown={(e) => {
                if (e.key === "Enter") addTag(n);
              }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
