// Live character-sheet sharing over netplay (item: "when a player joins, the
// Curator has full control over the sheets"). Players push their full character
// record into the room; the Curator (and the owner) apply incoming records to
// their local DB and can open/edit them, with edits flowing back the same way.
//
// This module is the transport-agnostic core: a per-character registry of the
// latest shared record plus a content hash. The hash is the loop-breaker — a
// received record is remembered by hash, so re-saving it (e.g. when an open
// sheet remounts and normalizes on load) will NOT re-broadcast an echo. The
// netplay wiring lives in VttScreen; this part is unit-testable on its own.
import type { CharacterRecord } from "../../lib/characters";

export interface PartySheetEntry {
  record: CharacterRecord;
  ownerId: string;
  hash: string;
}

const store = new Map<string, PartySheetEntry>();
const subs = new Set<() => void>();
const EMPTY: readonly PartySheetEntry[] = Object.freeze([]);
let snapshot: readonly PartySheetEntry[] = EMPTY;

function hashOf(rec: CharacterRecord): string {
  // Records are small; a stable JSON of the mutable parts is enough to detect
  // "did anything actually change" without a real hashing dependency.
  return JSON.stringify([rec.id, rec.name, rec.sheet]);
}

function rebuildSnapshot(): void {
  snapshot = store.size === 0 ? EMPTY : Object.freeze([...store.values()]);
}

function notify(): void {
  rebuildSnapshot();
  for (const cb of subs) cb();
}

/** All shared party sheets (stable reference between mutations). */
export function getPartySheets(): readonly PartySheetEntry[] {
  return snapshot;
}

/** Apply a record received from a peer. Records the content hash so a later
 *  shouldBroadcast() for the same content returns false (no echo). */
export function applyRemoteSheet(rec: CharacterRecord, ownerId: string): void {
  store.set(rec.id, { record: rec, ownerId, hash: hashOf(rec) });
  notify();
}

/** Decide whether a locally-saved record is new information worth broadcasting.
 *  Returns false when it matches what we last sent/received for that character
 *  (which is exactly the echo we must not rebroadcast). Updates the stored hash
 *  when it returns true. `selfId` marks us as the owner for local-origin records. */
export function shouldBroadcastSheet(rec: CharacterRecord, selfId: string): boolean {
  const h = hashOf(rec);
  const cur = store.get(rec.id);
  if (cur && cur.hash === h) return false;
  store.set(rec.id, { record: rec, ownerId: cur?.ownerId ?? selfId, hash: h });
  notify();
  return true;
}

/** Drop sheets owned by peers who have left the room. */
export function pruneOwners(livingOwnerIds: Set<string>, selfId: string): void {
  let changed = false;
  for (const [id, entry] of store) {
    if (entry.ownerId !== selfId && !livingOwnerIds.has(entry.ownerId)) {
      store.delete(id);
      changed = true;
    }
  }
  if (changed) notify();
}

export function subscribePartySheets(cb: () => void): () => void {
  subs.add(cb);
  return () => {
    subs.delete(cb);
  };
}
