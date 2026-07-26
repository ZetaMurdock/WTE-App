import { useMemo, useState } from "react";
import {
  addFolder,
  notesInFolder,
  notesUnderFolder,
  pathLabel,
  removeFolderKeepingNotes,
  renameFolder,
  type NoteFolder,
} from "../lib/noteFolders";

/** What the tree currently has selected: everything, the loose root, or a folder. */
export type NoteSel = "all" | "root" | string;

interface NoteLike {
  id: string;
  title: string;
  folderId?: string | null;
}

interface Props<T extends NoteLike> {
  folders: NoteFolder[];
  notes: T[];
  sel: NoteSel;
  onSel: (s: NoteSel) => void;
  onFolders: (next: NoteFolder[]) => void;
  /** Called when a folder is deleted — its notes come back re-homed to the root. */
  onRehome: (notes: T[]) => void;
  /** Jump straight to a note from the tree. */
  onOpenNote?: (id: string) => void;
}

// Nested folder tree for notes — the Obsidian shape. Deliberately built on the
// same vault-tree markup and CSS as the character vault, so the two trees in the
// app look and behave identically rather than being two inventions.
export function NoteTree<T extends NoteLike>({ folders, notes, sel, onSel, onFolders, onRehome, onOpenNote }: Props<T>) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const roots = folders.filter((f) => !f.parentId);
  const loose = notesInFolder(notes, null);

  function newFolder(parentId: string | null) {
    const name = prompt(parentId ? "New sub-folder name" : "New folder name");
    if (name?.trim()) onFolders(addFolder(folders, name, parentId));
  }
  function renamePrompt(f: NoteFolder) {
    const name = prompt("Rename folder", f.name);
    if (name?.trim()) onFolders(renameFolder(folders, f.id, name));
  }
  function deleteConfirm(f: NoteFolder) {
    const under = notesUnderFolder(folders, notes, f.id).length;
    const msg =
      `Delete folder "${f.name}"?\n\n` +
      (under
        ? `${under} note${under === 1 ? "" : "s"} inside will be kept — they move back to the root.`
        : "It's empty.");
    if (!confirm(msg)) return;
    const out = removeFolderKeepingNotes(folders, notes, f.id);
    onFolders(out.folders);
    onRehome(out.notes);
    if (sel === f.id || out.removed.includes(String(sel))) onSel("all");
  }

  function toggle(id: string) {
    setExpanded((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function FolderNode({ f, depth }: { f: NoteFolder; depth: number }) {
    const children = folders.filter((x) => x.parentId === f.id);
    const here = notesInFolder(notes, f.id);
    const total = notesUnderFolder(folders, notes, f.id).length;
    const hasContent = children.length > 0 || here.length > 0;
    const isOpen = expanded.has(f.id);
    return (
      <li>
        <div className={"vault-tree-row" + (sel === f.id ? " active" : "")} style={{ paddingLeft: 8 + depth * 14 }}>
          <button
            className="vault-tree-caret"
            onClick={() => hasContent && toggle(f.id)}
            style={{ visibility: hasContent ? "visible" : "hidden" }}
            title={isOpen ? "Collapse" : "Expand"}
          >
            {isOpen ? "▾" : "▸"}
          </button>
          <button className="vault-tree-name" onClick={() => onSel(f.id)}>
            {f.name} <span className="vault-tree-count">{total}</span>
          </button>
          <span className="vault-tree-tools">
            <button className="icon-btn xs" title="New sub-folder" onClick={() => newFolder(f.id)}>+</button>
            <button className="icon-btn xs" title="Rename" onClick={() => renamePrompt(f)}>✎</button>
            <button className="icon-btn xs" title="Delete folder" onClick={() => deleteConfirm(f)}>✕</button>
          </span>
        </div>
        {isOpen && (
          <ul className="vault-tree-sub">
            {children.map((c) => (
              <FolderNode key={c.id} f={c} depth={depth + 1} />
            ))}
            {here.map((n) => (
              <NoteLeaf key={n.id} n={n} depth={depth + 1} />
            ))}
          </ul>
        )}
      </li>
    );
  }

  function NoteLeaf({ n, depth }: { n: T; depth: number }) {
    return (
      <li>
        <div className="vault-tree-row leaf" style={{ paddingLeft: 8 + depth * 14 }}>
          <span className="vault-tree-caret" style={{ visibility: "hidden" }} />
          <button
            className="vault-tree-name char"
            onClick={() => onOpenNote?.(n.id)}
            title={onOpenNote ? "Open this note" : undefined}
          >
            <span className="vault-leaf-dot" aria-hidden />
            {n.title || "Untitled"}
          </button>
        </div>
      </li>
    );
  }

  return (
    <aside className="note-tree">
      <div className="vault-tree-head">
        <span>Folders</span>
        <button className="icon-btn xs" title="New folder" onClick={() => newFolder(null)}>+ New</button>
      </div>
      <ul className="vault-tree">
        <li>
          <div className={"vault-tree-row" + (sel === "all" ? " active" : "")}>
            <span className="vault-tree-caret" style={{ visibility: "hidden" }} />
            <button className="vault-tree-name" onClick={() => onSel("all")}>
              All notes <span className="vault-tree-count">{notes.length}</span>
            </button>
          </div>
        </li>
        {roots.map((f) => (
          <FolderNode key={f.id} f={f} depth={0} />
        ))}
        {loose.length > 0 && (
          <li>
            <div className={"vault-tree-row" + (sel === "root" ? " active" : "")}>
              <span className="vault-tree-caret" style={{ visibility: "hidden" }} />
              <button className="vault-tree-name" onClick={() => onSel("root")}>
                Unfiled <span className="vault-tree-count">{loose.length}</span>
              </button>
            </div>
          </li>
        )}
      </ul>
      {folders.length === 0 && (
        <p className="list-empty" style={{ fontSize: 11 }}>
          No folders yet. Add one to group notes — folders nest, so &ldquo;Act 2 › The Vault&rdquo; works.
        </p>
      )}
    </aside>
  );
}

/** Flat, tree-ordered folder list with full "Act 2 › The Vault" labels, for a
 *  move dropdown — so two same-named folders in different parents are told apart. */
export function useFolderOptions(folders: NoteFolder[]): { id: string; label: string }[] {
  return useMemo(() => {
    const out: { id: string; label: string }[] = [];
    const walk = (parentId: string | null) => {
      for (const f of folders.filter((x) => x.parentId === parentId)) {
        out.push({ id: f.id, label: pathLabel(folders, f.id) });
        walk(f.id);
      }
    };
    walk(null);
    return out;
  }, [folders]);
}

/** Which notes the current selection should show. */
export function visibleNotes<T extends NoteLike>(folders: NoteFolder[], notes: T[], sel: NoteSel): T[] {
  if (sel === "all") return notes;
  if (sel === "root") return notesInFolder(notes, null);
  // A folder shows its own notes AND everything beneath it, which is what people
  // expect when they click a parent.
  return notesUnderFolder(folders, notes, sel);
}
