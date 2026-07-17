// Persistent lobby rooms: every room you host or join is remembered, so next
// time it's ONE CLICK — the Curator sets the signaling server once, players
// type the code once. Cards also carry table info (next session). The merge
// logic is pure (unit-tested); localStorage wrappers live at the bottom.

export interface SavedRoom {
  code: string;
  /** How I last used it: "host" = my room, "player" = a room I joined. */
  role: "host" | "player";
  /** Free-text shown on the card — e.g. "Next session: Sat 8pm". Hosts set it;
   *  it syncs to everyone in the room via the room-info message. */
  nextSession?: string;
  lastUsed: number;
}

/** Upsert by code — role/nextSession update only when given; newest first. */
export function mergeRoom(list: SavedRoom[], patch: { code: string; role?: SavedRoom["role"]; nextSession?: string }, now = Date.now()): SavedRoom[] {
  const code = patch.code.trim();
  if (!code) return list;
  const cur = list.find((r) => r.code === code);
  const next: SavedRoom = {
    code,
    role: patch.role ?? cur?.role ?? "player",
    nextSession: patch.nextSession !== undefined ? patch.nextSession || undefined : cur?.nextSession,
    lastUsed: now,
  };
  return [next, ...list.filter((r) => r.code !== code)];
}

export function withoutRoom(list: SavedRoom[], code: string): SavedRoom[] {
  return list.filter((r) => r.code !== code);
}

// ── localStorage wrappers ────────────────────────────────────────────────────

const KEY = "wte-saved-rooms";

export function listSavedRooms(): SavedRoom[] {
  try {
    const raw = localStorage.getItem(KEY);
    const list = raw ? (JSON.parse(raw) as SavedRoom[]) : [];
    return Array.isArray(list) ? list.filter((r) => r && typeof r.code === "string") : [];
  } catch {
    return [];
  }
}

function write(list: SavedRoom[]): SavedRoom[] {
  try {
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, 30)));
  } catch {
    /* storage unavailable — rooms just aren't remembered */
  }
  return list;
}

export function upsertSavedRoom(patch: { code: string; role?: SavedRoom["role"]; nextSession?: string }): SavedRoom[] {
  return write(mergeRoom(listSavedRooms(), patch));
}

export function deleteSavedRoom(code: string): SavedRoom[] {
  return write(withoutRoom(listSavedRooms(), code));
}
