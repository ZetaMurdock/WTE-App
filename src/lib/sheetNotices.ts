// Pending "someone else changed your sheet" notices, per character.
//
// WHERE THIS LIVES, AND WHY IT IS NOT ON THE RECORD:
//
// A notice is not a property of the character — it is a property of THIS reader's
// relationship to it ("here is what happened while you were not looking"). Put on
// the sheet, it would be serialized by sheetCodec, broadcast by the sheet-patch
// wiring, and land in everyone's copy: the Curator would receive a notice about
// their own edit, writing it would change the content hash and provoke another
// broadcast, and the player's acknowledgement would have to travel back over the
// wire to clear. Kept beside the record, on the device doing the reading, none of
// that arises — and it survives the app closing, which is the whole requirement.
//
// ONE KEY PER CHARACTER, not one blob for all of them: a damaged blob would be
// quarantined whole, losing every character's pending notices to fix one. It also
// means a busy sheet never rewrites another's bytes.
//
// A QUEUE, NOT A FLAG. A Curator may edit a sheet on Monday, Wednesday and
// Friday before the player next logs in. Collapsing that into "something changed"
// throws away the only part the player wanted — WHAT changed — so every edit is
// kept as its own attributed, timestamped entry.
import { isArray, readJson, removeJson, writeJson } from "./localJson";
import type { CharacterRecord } from "./characters";
import { diffSheetRecords } from "./sheetDiff";

/** One edit made to a character by someone other than the reader. */
export interface SheetNotice {
  /** Unique per entry, so the surface can key a list and drop one by identity. */
  id: string;
  /** Display name of whoever made the edit ("Curator", a player's table name). */
  by: string;
  /** When it was applied on this device. */
  at: number;
  /** The changes, already phrased for a player — see sheetDiff. */
  changes: string[];
}

/** Keep the queue bounded. A sync fault that re-applied a record in a loop would
 *  otherwise grow this key until localStorage refuses every write in the app. */
export const MAX_NOTICES = 30;
/** And bound one entry, so a mass edit cannot make a single notice enormous. */
export const MAX_CHANGES_PER_NOTICE = 20;

const key = (characterId: string) => `wte-sheet-notices:${characterId}`;

const subs = new Set<(characterId: string) => void>();

function notify(characterId: string): void {
  for (const cb of subs) cb(characterId);
}

function validNotice(v: unknown): v is SheetNotice {
  if (typeof v !== "object" || v === null) return false;
  const n = v as Record<string, unknown>;
  return (
    typeof n.id === "string" &&
    typeof n.by === "string" &&
    typeof n.at === "number" &&
    Array.isArray(n.changes) &&
    n.changes.every((c) => typeof c === "string")
  );
}

/** Everything this character's owner has not acknowledged yet, oldest first. */
export function pendingSheetNotices(characterId: string): SheetNotice[] {
  const raw = readJson<unknown[]>(key(characterId), [], { validate: isArray, label: "sheet change notices" }).value;
  // Entries are re-validated rather than trusted: this key is hand-editable and a
  // malformed entry would crash the sheet it is meant to annotate.
  return raw.filter(validNotice);
}

/** Drop everything pending for a character — the player has read it. */
export function clearSheetNotices(characterId: string): void {
  removeJson(key(characterId));
  notify(characterId);
}

/** Drop ONE notice, leaving the rest of the queue intact. */
export function dismissSheetNotice(characterId: string, noticeId: string): void {
  const rest = pendingSheetNotices(characterId).filter((n) => n.id !== noticeId);
  if (rest.length === 0) removeJson(key(characterId));
  else writeJson(key(characterId), rest, { label: "sheet change notices" });
  notify(characterId);
}

function newId(now: number): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `sn-${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export interface RemoteEditArgs {
  /** The record as this device held it before the incoming version was applied. */
  before: CharacterRecord;
  /** The record that just arrived. */
  after: CharacterRecord;
  /** Who sent it — peer id decides authorship, name is what the player reads. */
  by: { id: string; name: string };
  /** This device's own peer id. */
  selfId: string;
  /** Table policy that moves the derived pools, so the HP in the notice matches
   *  the HP on the sheet. */
  poolCompensation?: boolean;
  now?: number;
}

/**
 * Queue a notice for an edit that arrived from SOMEONE ELSE.
 *
 * The "someone else" test lives here and nowhere else, deliberately: a sheet is
 * broadcast on every save and the sender receives its own echo back, so a caller
 * that forgot this check would notify a player about every keystroke they just
 * made — and would notify the Curator about the Curator's own edits.
 *
 * Returns the notice, or null when there was nothing to say: our own edit, or a
 * record that carries no semantic change (a re-save, a codec normalisation).
 */
export function recordRemoteSheetEdit(args: RemoteEditArgs): SheetNotice | null {
  const { before, after, by, selfId } = args;
  if (by.id === selfId) return null;
  if (before.id !== after.id) return null;
  const changes = diffSheetRecords(before, after, { poolCompensation: args.poolCompensation });
  if (changes.length === 0) return null;

  const now = args.now ?? Date.now();
  const trimmed =
    changes.length > MAX_CHANGES_PER_NOTICE
      ? [...changes.slice(0, MAX_CHANGES_PER_NOTICE), `…and ${changes.length - MAX_CHANGES_PER_NOTICE} more changes`]
      : changes;
  const notice: SheetNotice = { id: newId(now), by: by.name.trim() || "Someone at the table", at: now, changes: trimmed };
  // Oldest first, and the OLDEST is what gets dropped at the cap: the newest edits
  // are the ones a returning player still needs.
  const queue = [...pendingSheetNotices(after.id), notice].slice(-MAX_NOTICES);
  writeJson(key(after.id), queue, { label: "sheet change notices" });
  notify(after.id);
  return notice;
}

/** When an edit happened, said the way a person would say it.
 *
 *  Coarse on purpose: the useful fact is "this is new" versus "this happened
 *  while you were away", and a to-the-second timestamp on a week-old edit reads
 *  as precision the player has no use for. Past a day it becomes a real date,
 *  because "9 days ago" stops being something anyone can place. */
export function noticeWhen(at: number, now: number = Date.now()): string {
  const secs = Math.max(0, Math.round((now - at) / 1000));
  if (secs < 45) return "just now";
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins} minute${mins === 1 ? "" : "s"} ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  return new Date(at).toLocaleDateString();
}

/** Watch for notices arriving or being cleared, so an OPEN sheet shows a Curator
 *  edit the moment it lands rather than only on the next visit. */
export function subscribeSheetNotices(cb: (characterId: string) => void): () => void {
  subs.add(cb);
  return () => {
    subs.delete(cb);
  };
}
