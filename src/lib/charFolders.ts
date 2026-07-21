// Character-vault folders: a nestable tree the player/Curator organizes their
// vault into (PCs, NPCs, creatures, bosses…). Lightweight metadata, stored in
// localStorage per campaign so it needs no SQLite migration — characters carry
// their `folderId` inside the sheet JSON. Pure tree logic is unit-tested; the
// localStorage wrappers live at the bottom.

export interface CharFolder {
  id: string;
  name: string;
  /** Parent folder id, or null for a top-level folder. */
  parentId: string | null;
}

function newId(): string {
  return "cf-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 6);
}

/** Add a folder under `parentId` (null = top level). */
export function addFolder(list: CharFolder[], name: string, parentId: string | null = null): CharFolder[] {
  const n = name.trim();
  if (!n) return list;
  return [...list, { id: newId(), name: n, parentId }];
}

export function renameFolder(list: CharFolder[], id: string, name: string): CharFolder[] {
  const n = name.trim();
  if (!n) return list;
  return list.map((f) => (f.id === id ? { ...f, name: n } : f));
}

/** Would moving `id` under `newParent` create a cycle (parent into its own descendant)? */
export function wouldCycle(list: CharFolder[], id: string, newParent: string | null): boolean {
  let cur = newParent;
  while (cur) {
    if (cur === id) return true;
    cur = list.find((f) => f.id === cur)?.parentId ?? null;
  }
  return false;
}

/** Move a folder to a new parent, refusing cycles (self / descendant). */
export function moveFolder(list: CharFolder[], id: string, newParent: string | null): CharFolder[] {
  if (id === newParent || wouldCycle(list, id, newParent)) return list;
  return list.map((f) => (f.id === id ? { ...f, parentId: newParent } : f));
}

/** All descendant folder ids of `id` (not including `id`). */
export function descendantIds(list: CharFolder[], id: string): string[] {
  const out: string[] = [];
  const walk = (pid: string) => {
    for (const f of list) if (f.parentId === pid) { out.push(f.id); walk(f.id); }
  };
  walk(id);
  return out;
}

/** Remove a folder and all its descendants; returns the trimmed list + the set
 *  of removed ids (so callers can re-home orphaned characters to the root). */
export function removeFolder(list: CharFolder[], id: string): { list: CharFolder[]; removed: string[] } {
  const removed = [id, ...descendantIds(list, id)];
  return { list: list.filter((f) => !removed.includes(f.id)), removed };
}

// ── localStorage wrappers ────────────────────────────────────────────────────

const key = (campaignId: string) => `wte-char-folders:${campaignId}`;

export function listFolders(campaignId: string): CharFolder[] {
  try {
    const raw = localStorage.getItem(key(campaignId));
    const list = raw ? (JSON.parse(raw) as CharFolder[]) : [];
    return Array.isArray(list) ? list.filter((f) => f && typeof f.id === "string" && typeof f.name === "string") : [];
  } catch {
    return [];
  }
}

export function saveFolders(campaignId: string, list: CharFolder[]): CharFolder[] {
  try {
    localStorage.setItem(key(campaignId), JSON.stringify(list.slice(0, 500)));
  } catch {
    /* storage unavailable — folders just aren't remembered */
  }
  return list;
}
