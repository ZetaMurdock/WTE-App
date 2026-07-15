// Campaign "desk": notes (Inquisitor / Unit / Curator) + a campaign calendar.
// Stored per-campaign in localStorage so it works everywhere and needs no schema
// migration; a future SQLite/netplay mirror can adopt the same shapes.

export type DeskNoteKind = "inquisitor" | "unit" | "curator";
export interface DeskNote {
  id: string;
  kind: DeskNoteKind;
  title: string;
  body: string;
  updatedAt: number;
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
function read<T>(key: string): T[] {
  try {
    return (JSON.parse(localStorage.getItem(key) || "[]") as T[]) || [];
  } catch {
    return [];
  }
}
function write<T>(key: string, list: T[]): void {
  try {
    localStorage.setItem(key, JSON.stringify(list));
  } catch {
    /* quota / unavailable — ignore */
  }
}

const notesKey = (cid: string) => `wte-desk-notes:${cid}`;
const calKey = (cid: string) => `wte-desk-cal:${cid}`;

// ── Notes ──
export function listDeskNotes(campaignId: string, kind: DeskNoteKind): DeskNote[] {
  return read<DeskNote>(notesKey(campaignId))
    .filter((n) => n.kind === kind)
    .sort((a, b) => b.updatedAt - a.updatedAt);
}
export function newDeskNote(campaignId: string, kind: DeskNoteKind): DeskNote {
  const note: DeskNote = { id: uid(), kind, title: "", body: "", updatedAt: Date.now() };
  write(notesKey(campaignId), [note, ...read<DeskNote>(notesKey(campaignId))]);
  return note;
}
export function saveDeskNote(campaignId: string, note: DeskNote): void {
  const list = read<DeskNote>(notesKey(campaignId));
  const i = list.findIndex((n) => n.id === note.id);
  const next = { ...note, updatedAt: Date.now() };
  if (i >= 0) list[i] = next;
  else list.unshift(next);
  write(notesKey(campaignId), list);
}
export function deleteDeskNote(campaignId: string, id: string): void {
  write(notesKey(campaignId), read<DeskNote>(notesKey(campaignId)).filter((n) => n.id !== id));
}
export function countDeskNotes(campaignId: string): number {
  return read<DeskNote>(notesKey(campaignId)).length;
}

// ── Calendar ──
/** All events, chronological: dated events first (by date), then undated. */
export function listCalEvents(campaignId: string): CalEvent[] {
  return read<CalEvent>(calKey(campaignId)).sort((a, b) => {
    if (a.date && b.date) return a.date.localeCompare(b.date);
    if (a.date) return -1;
    if (b.date) return 1;
    return a.title.localeCompare(b.title);
  });
}
export function saveCalEvent(campaignId: string, ev: CalEvent): void {
  const list = read<CalEvent>(calKey(campaignId));
  const i = list.findIndex((e) => e.id === ev.id);
  if (i >= 0) list[i] = ev;
  else list.push(ev);
  write(calKey(campaignId), list);
}
export function newCalEvent(campaignId: string): CalEvent {
  const ev: CalEvent = { id: uid(), date: "", inWorld: "", title: "", body: "", kind: "event" };
  saveCalEvent(campaignId, ev);
  return ev;
}
export function deleteCalEvent(campaignId: string, id: string): void {
  write(calKey(campaignId), read<CalEvent>(calKey(campaignId)).filter((e) => e.id !== id));
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
