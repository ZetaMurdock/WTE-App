import { useMemo, useRef, useState } from "react";
import type { Campaign } from "../../models/campaign";
import type { CharacterRecord } from "../../lib/characters";
import { deleteCharacter, updateCharacter, patchCharacterSheet } from "../../lib/characters";
import { getSpecies, getParadigm } from "../../game/wte";
import { ConfirmButton } from "../ui/ConfirmButton";
import { PortraitFrame } from "./PortraitFrame";
import { CharacterNotes } from "./CharacterNotes";
import { downloadCharacter } from "../../lib/charShare";
import {
  type CharFolder,
  listFolders,
  saveFolders,
  addFolder,
  renameFolder,
  removeFolder,
  descendantIds,
} from "../../lib/charFolders";

interface Props {
  campaign: Campaign;
  characters: CharacterRecord[];
  loading: boolean;
  onNew: () => void;
  onRandomize: () => void;
  onImportFiles: (files: File[]) => void;
  onMigrateLegacy: () => void;
  onOpen: (id: string) => void;
  onEditInCreator: (id: string) => void;
  onChanged: () => void;
}

/** Suggested starter tags the Curator/player can apply — plus any they name. */
const SUGGESTED_TAGS = ["PC", "NPC", "Ally", "Creature", "Boss", "Faction"];
type Sel = "all" | "unfiled" | string;

export function CharacterVault({ campaign, characters, loading, onNew, onRandomize, onImportFiles, onMigrateLegacy, onOpen, onEditInCreator, onChanged }: Props) {
  const importRef = useRef<HTMLInputElement>(null);
  const [folders, setFolders] = useState<CharFolder[]>(() => listFolders(campaign.id));
  const [sel, setSel] = useState<Sel>("all");
  const [selTag, setSelTag] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [notesFor, setNotesFor] = useState<CharacterRecord | null>(null);

  const persistFolders = (next: CharFolder[]) => setFolders(saveFolders(campaign.id, next));

  // union of every tag currently in use, for the filter bar
  const allTags = useMemo(() => {
    const s = new Set<string>();
    for (const c of characters) for (const t of c.sheet.tags ?? []) s.add(t);
    return [...s].sort((a, b) => a.localeCompare(b));
  }, [characters]);

  // which characters are visible for the current folder + tag selection
  const visible = useMemo(() => {
    let scope: (c: CharacterRecord) => boolean;
    if (sel === "all") scope = () => true;
    else if (sel === "unfiled") scope = (c) => !c.sheet.folderId;
    else {
      const ids = new Set([sel, ...descendantIds(folders, sel)]);
      scope = (c) => !!c.sheet.folderId && ids.has(c.sheet.folderId);
    }
    return characters.filter((c) => scope(c) && (!selTag || (c.sheet.tags ?? []).includes(selTag)));
  }, [characters, folders, sel, selTag]);

  const countIn = (id: Sel) => {
    if (id === "all") return characters.length;
    if (id === "unfiled") return characters.filter((c) => !c.sheet.folderId).length;
    const ids = new Set([id, ...descendantIds(folders, id)]);
    return characters.filter((c) => c.sheet.folderId && ids.has(c.sheet.folderId)).length;
  };

  // ── folder ops ──
  function newFolder(parentId: string | null) {
    const name = prompt(parentId ? "New sub-folder name" : "New folder name");
    if (name?.trim()) persistFolders(addFolder(folders, name, parentId));
  }
  function renameFolderPrompt(f: CharFolder) {
    const name = prompt("Rename folder", f.name);
    if (name?.trim()) persistFolders(renameFolder(folders, f.id, name));
  }
  function deleteFolderConfirm(f: CharFolder) {
    const kids = descendantIds(folders, f.id).length;
    const msg = `Delete folder "${f.name}"${kids ? ` and its ${kids} sub-folder${kids === 1 ? "" : "s"}` : ""}?\nCharacters inside are kept — they move to Unfiled.`;
    if (!confirm(msg)) return;
    const { list, removed } = removeFolder(folders, f.id);
    persistFolders(list);
    // re-home any characters that lived in a removed folder
    void Promise.all(
      characters.filter((c) => c.sheet.folderId && removed.includes(c.sheet.folderId)).map((c) => patchCharacterSheet(c.id, { folderId: null }))
    ).then(() => onChanged());
    if (sel === f.id || (typeof sel === "string" && removed.includes(sel))) setSel("all");
  }

  // ── character ops ──
  async function moveTo(c: CharacterRecord, folderId: string | null) {
    await patchCharacterSheet(c.id, { folderId });
    onChanged();
  }
  async function addTag(c: CharacterRecord) {
    const name = prompt(`Add a tag to ${c.name}\n(suggested: ${SUGGESTED_TAGS.join(", ")})`);
    const t = name?.trim();
    if (!t) return;
    const tags = [...new Set([...(c.sheet.tags ?? []), t])];
    await patchCharacterSheet(c.id, { tags });
    onChanged();
  }
  async function removeTag(c: CharacterRecord, tag: string) {
    await patchCharacterSheet(c.id, { tags: (c.sheet.tags ?? []).filter((t) => t !== tag) });
    onChanged();
  }
  async function handleRename(c: CharacterRecord) {
    const next = prompt("Rename character", c.name);
    if (next?.trim()) { await updateCharacter(c.id, { name: next.trim() }); onChanged(); }
  }
  async function handleDelete(c: CharacterRecord) { await deleteCharacter(c.id); onChanged(); }

  function subtitle(c: CharacterRecord): string {
    return [getSpecies(c.sheet.speciesId)?.name, getParadigm(c.sheet.paradigmId)?.name].filter(Boolean).join(" · ") || "No species / paradigm set";
  }

  // recursive folder tree row
  function FolderNode({ f, depth }: { f: CharFolder; depth: number }) {
    const children = folders.filter((x) => x.parentId === f.id);
    const isOpen = expanded.has(f.id);
    return (
      <li>
        <div className={"vault-tree-row" + (sel === f.id ? " active" : "")} style={{ paddingLeft: 8 + depth * 14 }}>
          <button
            className="vault-tree-caret"
            onClick={() => setExpanded((s) => { const n = new Set(s); n.has(f.id) ? n.delete(f.id) : n.add(f.id); return n; })}
            style={{ visibility: children.length ? "visible" : "hidden" }}
          >
            {isOpen ? "▾" : "▸"}
          </button>
          <button className="vault-tree-name" onClick={() => setSel(f.id)}>
            {f.name} <span className="vault-tree-count">{countIn(f.id)}</span>
          </button>
          <span className="vault-tree-tools">
            <button className="icon-btn xs" title="New sub-folder" onClick={() => newFolder(f.id)}>+</button>
            <button className="icon-btn xs" title="Rename" onClick={() => renameFolderPrompt(f)}>✎</button>
            <button className="icon-btn xs" title="Delete folder" onClick={() => deleteFolderConfirm(f)}>✕</button>
          </span>
        </div>
        {isOpen && children.length > 0 && <ul className="vault-tree-sub">{children.map((c) => <FolderNode key={c.id} f={c} depth={depth + 1} />)}</ul>}
      </li>
    );
  }

  const roots = folders.filter((f) => !f.parentId);

  return (
    <div className="dashboard vault-layout">
      <div className="dash-header">
        <div>
          <div className="dash-eyebrow">{campaign.name}</div>
          <h1 className="dash-title">Character Vault</h1>
        </div>
        <div className="vault-new-wrap">
          <button className="vault-new" onClick={onNew}>
            <span className="vault-new-plus" aria-hidden>+</span>
            New Character
            <span className="vault-new-caret" aria-hidden>›</span>
          </button>
          <div className="vault-new-menu">
            <button onClick={onNew}><span className="vault-menu-ico" aria-hidden>+</span>Build from scratch</button>
            <button onClick={onRandomize}><span className="vault-menu-ico" aria-hidden>⟳</span>Randomize an Inquisitor</button>
            <button onClick={() => importRef.current?.click()} title="Import shared or legacy .json characters"><span className="vault-menu-ico" aria-hidden>⇪</span>Import character JSON…</button>
            <button onClick={onMigrateLegacy} title="Copy characters the old sheet saved on this computer into the vault"><span className="vault-menu-ico" aria-hidden>⇉</span>Migrate legacy sheet characters</button>
          </div>
        </div>
      </div>
      <input ref={importRef} type="file" accept=".json,application/json" multiple hidden onChange={(e) => { const files = Array.from(e.target.files ?? []); e.target.value = ""; if (files.length) onImportFiles(files); }} />

      <div className="vault-body">
        <aside className="vault-sidebar">
          <div className="vault-tree-head">
            <span>Folders</span>
            <button className="icon-btn xs" title="New folder" onClick={() => newFolder(null)}>+ New</button>
          </div>
          <ul className="vault-tree">
            <li>
              <div className={"vault-tree-row" + (sel === "all" ? " active" : "")} style={{ paddingLeft: 8 }}>
                <span className="vault-tree-caret" style={{ visibility: "hidden" }} />
                <button className="vault-tree-name" onClick={() => setSel("all")}>All characters <span className="vault-tree-count">{countIn("all")}</span></button>
              </div>
            </li>
            {roots.map((f) => <FolderNode key={f.id} f={f} depth={0} />)}
            <li>
              <div className={"vault-tree-row" + (sel === "unfiled" ? " active" : "")} style={{ paddingLeft: 8 }}>
                <span className="vault-tree-caret" style={{ visibility: "hidden" }} />
                <button className="vault-tree-name" onClick={() => setSel("unfiled")}>Unfiled <span className="vault-tree-count">{countIn("unfiled")}</span></button>
              </div>
            </li>
          </ul>

          {allTags.length > 0 && (
            <>
              <div className="vault-tree-head" style={{ marginTop: 12 }}><span>Tags</span></div>
              <div className="chip-row" style={{ flexWrap: "wrap", padding: "0 8px" }}>
                <button className={"chip" + (selTag === null ? " active" : "")} onClick={() => setSelTag(null)}>Any</button>
                {allTags.map((t) => (
                  <button key={t} className={"chip" + (selTag === t ? " active" : "")} onClick={() => setSelTag(selTag === t ? null : t)}>{t}</button>
                ))}
              </div>
            </>
          )}
        </aside>

        <section className="vault-main">
          {loading ? (
            <p className="list-empty">Loading…</p>
          ) : visible.length === 0 ? (
            <p className="list-empty">{characters.length === 0 ? "No characters yet — create your first Inquisitor." : "Nothing here — try a different folder or tag."}</p>
          ) : (
            <div className="char-grid">
              {visible.map((c) => (
                <div className="char-card" key={c.id}>
                  <button className="char-open" onClick={() => onOpen(c.id)}>
                    <PortraitFrame src={c.sheet.portrait} size="sm" />
                    <div className="char-open-text">
                      <div className="char-name">{c.name}</div>
                      <div className="char-meta">{subtitle(c)}</div>
                    </div>
                  </button>
                  <div className="char-tags">
                    {(c.sheet.tags ?? []).map((t) => (
                      <button key={t} className="char-tag" title="Remove tag" onClick={() => void removeTag(c, t)}>{t} <span aria-hidden>×</span></button>
                    ))}
                    <button className="char-tag add" title="Add a tag" onClick={() => void addTag(c)}>+ tag</button>
                  </div>
                  <div className="char-actions">
                    <button className="icon-btn" onClick={() => onOpen(c.id)} title="Open & edit">Edit</button>
                    <button className="icon-btn" onClick={() => onEditInCreator(c.id)} title="Reopen in the step-by-step creator">Rebuild</button>
                    <button className="icon-btn" onClick={() => setNotesFor(c)} title="Markdown notes for this character">Notes</button>
                    <button className="icon-btn" onClick={() => downloadCharacter(c)} title="Export this character as a shareable .json">Share</button>
                    <button className="icon-btn" onClick={() => handleRename(c)}>Rename</button>
                    <ConfirmButton label="Delete" confirmLabel="Delete forever" title="Delete this character" onConfirm={() => void handleDelete(c)} />
                    <select
                      className="char-move"
                      title="Move to folder"
                      value={c.sheet.folderId ?? ""}
                      onChange={(e) => void moveTo(c, e.target.value || null)}
                    >
                      <option value="">Unfiled</option>
                      {folders.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                    </select>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      {notesFor && <CharacterNotes character={notesFor} onClose={() => setNotesFor(null)} onSaved={onChanged} />}
    </div>
  );
}
