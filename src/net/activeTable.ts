// The player's link to the Curator's table.
//
// A Curator's campaign lives in the CURATOR's database — a player who joins the
// room cannot own that row. What they get instead is a link: the campaign's id
// and name, which character of theirs is in use at that table, and their share
// of the table's money and notes. Keyed by room code, so rejoining a room
// restores the character you were playing without asking again.

import { clampShrives } from "../game/money";
import { parseInventory, type InvItem } from "../game/tableInventory";

export interface TableLink {
  room: string;
  /** The Curator's campaign id — identity only; the data stays on their machine. */
  campaignId: string;
  campaignName: string;
  /** Which of MY characters I am playing at this table. */
  inUseCharacterId?: string;
  /** This character's personal purse, in Shrives. */
  purse: number;
  /** Carried items at this table (not sheet equipment — see game/tableInventory). */
  inventory: InvItem[];
  joinedAt: number;
  lastSeen: number;
}

const KEY = "wte-table-links";

function readAll(): TableLink[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || "[]");
    return Array.isArray(raw) ? raw.filter((t) => t && typeof t.room === "string") : [];
  } catch {
    return [];
  }
}

function writeAll(list: TableLink[]): TableLink[] {
  try {
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, 40)));
  } catch {
    /* storage unavailable — the link just isn't remembered */
  }
  return list;
}

/** Normalise one record, so a hand-edited or older blob still loads. */
export function parseLink(raw: unknown): TableLink | null {
  const o = (raw && typeof raw === "object" ? raw : {}) as Partial<TableLink>;
  const room = String(o.room ?? "").trim();
  if (!room) return null;
  return {
    room,
    campaignId: String(o.campaignId ?? ""),
    campaignName: String(o.campaignName ?? ""),
    inUseCharacterId: typeof o.inUseCharacterId === "string" && o.inUseCharacterId ? o.inUseCharacterId : undefined,
    purse: clampShrives(Number(o.purse) || 0),
    inventory: parseInventory(o.inventory),
    joinedAt: Number(o.joinedAt) || Date.now(),
    lastSeen: Number(o.lastSeen) || Date.now(),
  };
}

/** Upsert by room. Fields not supplied keep their previous value, so a room-info
 *  message carrying only the campaign never wipes the chosen character. */
export function mergeLink(
  list: TableLink[],
  patch: Partial<TableLink> & { room: string },
  now = Date.now()
): TableLink[] {
  const room = patch.room.trim();
  if (!room) return list;
  const cur = list.find((t) => t.room === room);
  const next: TableLink = {
    room,
    campaignId: patch.campaignId ?? cur?.campaignId ?? "",
    campaignName: patch.campaignName ?? cur?.campaignName ?? "",
    inUseCharacterId:
      patch.inUseCharacterId !== undefined ? patch.inUseCharacterId || undefined : cur?.inUseCharacterId,
    purse: patch.purse !== undefined ? clampShrives(patch.purse) : cur?.purse ?? 0,
    inventory: patch.inventory !== undefined ? parseInventory(patch.inventory) : cur?.inventory ?? [],
    joinedAt: cur?.joinedAt ?? now,
    lastSeen: now,
  };
  return [next, ...list.filter((t) => t.room !== room)];
}

// ── storage wrappers ─────────────────────────────────────────────────────────

export function listTableLinks(): TableLink[] {
  return readAll()
    .map(parseLink)
    .filter((t): t is TableLink => !!t);
}

export function getTableLink(room: string): TableLink | null {
  if (!room) return null;
  return listTableLinks().find((t) => t.room === room) ?? null;
}

export function saveTableLink(patch: Partial<TableLink> & { room: string }): TableLink | null {
  const list = mergeLink(listTableLinks(), patch);
  writeAll(list);
  return list[0] ?? null;
}

export function forgetTableLink(room: string): TableLink[] {
  return writeAll(listTableLinks().filter((t) => t.room !== room));
}
