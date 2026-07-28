// Nested folders for notes — the Obsidian shape: folders inside folders, notes
// filed anywhere in the tree, and a breadcrumb that reads "Act 2 › The Vault".
//
// The tree LOGIC is not reimplemented here. lib/charFolders.ts already solved
// exactly this for the character vault — add, rename, reparent-without-cycles,
// descendants, path labels — and every one of those functions is pure and takes
// the list as an argument. So this module is only the storage: a different key,
// scoped per campaign AND per note kind, since a player's own notes and the
// party's shared notes are separate trees.

import {
  addFolder,
  descendantIds,
  folderPath,
  moveFolder,
  pathLabel,
  removeFolder,
  renameFolder,
  wouldCycle,
  type CharFolder,
} from "./charFolders";
import type { DeskNoteKind } from "./campaignDesk";
import { isArray, readJson, writeJson } from "./localJson";

/** A note folder is the same shape as a vault folder — id, name, parent. */
export type NoteFolder = CharFolder;

// Re-exported so callers need only one import to work with note trees.
export { addFolder, renameFolder, moveFolder, removeFolder, descendantIds, folderPath, pathLabel, wouldCycle };

const key = (campaignId: string, kind: DeskNoteKind) => `wte-note-folders:${kind}:${campaignId}`;

export function listNoteFolders(campaignId: string, kind: DeskNoteKind): NoteFolder[] {
  const list = readJson<NoteFolder[]>(key(campaignId, kind), [], {
    validate: isArray,
    label: "note folders",
  }).value;
  return list.filter((f) => f && typeof f.id === "string" && typeof f.name === "string");
}

export function saveNoteFolders(campaignId: string, kind: DeskNoteKind, list: NoteFolder[]): NoteFolder[] {
  writeJson(key(campaignId, kind), list.slice(0, 200), { label: "note folders" });
  return list;
}

/** Notes filed directly in one folder (null = the loose ones at the root). */
export function notesInFolder<T extends { folderId?: string | null }>(notes: T[], folderId: string | null): T[] {
  return notes.filter((n) => (n.folderId ?? null) === folderId);
}

/** Notes in a folder OR anywhere beneath it — what a collapsed folder's count
 *  should say, otherwise a folder full of sub-folders reads as empty. */
export function notesUnderFolder<T extends { folderId?: string | null }>(
  folders: NoteFolder[],
  notes: T[],
  folderId: string
): T[] {
  const ids = new Set([folderId, ...descendantIds(folders, folderId)]);
  return notes.filter((n) => n.folderId && ids.has(n.folderId));
}

/** Remove a folder and re-home its notes to the root rather than deleting them —
 *  losing writing because a folder went away would be unforgivable. */
export function removeFolderKeepingNotes<T extends { folderId?: string | null }>(
  folders: NoteFolder[],
  notes: T[],
  folderId: string
): { folders: NoteFolder[]; notes: T[]; removed: string[] } {
  const { list, removed } = removeFolder(folders, folderId);
  const gone = new Set(removed);
  return {
    folders: list,
    notes: notes.map((n) => (n.folderId && gone.has(n.folderId) ? { ...n, folderId: null } : n)),
    removed,
  };
}
