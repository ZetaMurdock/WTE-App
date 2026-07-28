// Campaign "desk": notes (Inquisitor / Unit / Curator) + a campaign calendar.
// Stored per-campaign in localStorage so it works everywhere and needs no schema
// migration; a future SQLite/netplay mirror can adopt the same shapes.

import { isArray, readJson, writeJson } from "./localJson";

export type DeskNoteKind = "inquisitor" | "unit" | "curator";
export interface DeskNote {
  id: string;
  kind: DeskNoteKind;
  title: string;
  body: string;
  updatedAt: number;
  /** Which note folder it sits in (null = loose at the root). Folders nest — see
   *  lib/noteFolders.ts, which reuses the character-vault folder logic. */
  folderId?: string | null;
}
export type CalKind = "session" | "event" | "deadline";
export interface CalEvent {
  id: string;
  /** Real calendar date (YYYY-MM-DD) for scheduling; "" if in-world only. */
  date: string;
  /** In-world date label (e.g. "Year 3261 · Cycle 4"). */
  inWorld: string;
  title: string;
  body: string;
  kind: CalKind;
}

function uid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return "d-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}
// Guarded: the old pair returned [] on a parse error and then wrote over the
// original bytes on the very next edit, so one malformed byte destroyed every desk
// note and the whole campaign calendar with nothing shown to the user.
function read<T>(key: string, label: string): T[] {
  return readJson<T[]>(key, [], { validate: isArray, label }).value;
}
function write<T>(key: string, list: T[], label: string): void {
  writeJson(key, list, { label });
}

const NOTES_LABEL = "campaign notes";
const CAL_LABEL = "campaign calendar";
const notesKey = (cid: string) => `wte-desk-notes:${cid}`;
const calKey = (cid: string) => `wte-desk-cal:${cid}`;

// ── Notes ──
export function listDeskNotes(campaignId: string, kind: DeskNoteKind): DeskNote[] {
  return read<DeskNote>(notesKey(campaignId), NOTES_LABEL)
    .filter((n) => n.kind === kind)
    .sort((a, b) => b.updatedAt - a.updatedAt);
}
export function newDeskNote(campaignId: string, kind: DeskNoteKind): DeskNote {
  const note: DeskNote = { id: uid(), kind, title: "", body: "", updatedAt: Date.now() };
  write(notesKey(campaignId), [note, ...read<DeskNote>(notesKey(campaignId), NOTES_LABEL)], NOTES_LABEL);
  return note;
}
export function saveDeskNote(campaignId: string, note: DeskNote): void {
  const list = read<DeskNote>(notesKey(campaignId), NOTES_LABEL);
  const i = list.findIndex((n) => n.id === note.id);
  const next = { ...note, updatedAt: Date.now() };
  if (i >= 0) list[i] = next;
  else list.unshift(next);
  write(notesKey(campaignId), list, NOTES_LABEL);
}
export function deleteDeskNote(campaignId: string, id: string): void {
  write(notesKey(campaignId), read<DeskNote>(notesKey(campaignId), NOTES_LABEL).filter((n) => n.id !== id), NOTES_LABEL);
}
export function countDeskNotes(campaignId: string): number {
  return read<DeskNote>(notesKey(campaignId), NOTES_LABEL).length;
}
/** Replace the whole Unit-kind subset (used to persist netplay-synced party notes). */
export function setUnitNotesLocal(campaignId: string, unit: DeskNote[]): void {
  const others = read<DeskNote>(notesKey(campaignId), NOTES_LABEL).filter((n) => n.kind !== "unit");
  write(notesKey(campaignId), [...unit.map((n) => ({ ...n, kind: "unit" as const })), ...others], NOTES_LABEL);
}

// ── Calendar ──
/** All events, chronological: dated events first (by date), then undated. */
export function listCalEvents(campaignId: string): CalEvent[] {
  return read<CalEvent>(calKey(campaignId), CAL_LABEL).sort((a, b) => {
    if (a.date && b.date) return a.date.localeCompare(b.date);
    if (a.date) return -1;
    if (b.date) return 1;
    return a.title.localeCompare(b.title);
  });
}
export function saveCalEvent(campaignId: string, ev: CalEvent): void {
  const list = read<CalEvent>(calKey(campaignId), CAL_LABEL);
  const i = list.findIndex((e) => e.id === ev.id);
  if (i >= 0) list[i] = ev;
  else list.push(ev);
  write(calKey(campaignId), list, CAL_LABEL);
}
export function newCalEvent(campaignId: string): CalEvent {
  const ev: CalEvent = { id: uid(), date: "", inWorld: "", title: "", body: "", kind: "event" };
  saveCalEvent(campaignId, ev);
  return ev;
}
export function deleteCalEvent(campaignId: string, id: string): void {
  write(calKey(campaignId), read<CalEvent>(calKey(campaignId), CAL_LABEL).filter((e) => e.id !== id), CAL_LABEL);
}
/** The soonest upcoming session (date ≥ today), for the dashboard shortcut. */
export function nextSession(campaignId: string): CalEvent | null {
  const today = new Date().toISOString().slice(0, 10);
  return (
    listCalEvents(campaignId)
      .filter((e) => e.kind === "session" && e.date && e.date >= today)
      .sort((a, b) => a.date.localeCompare(b.date))[0] ?? null
  );
}
