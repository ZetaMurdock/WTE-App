// Table inventory — the loot, consumables and oddments a party accumulates.
//
// Deliberately NOT game/inventory.ts, which is anatomy slots for equipped gear
// carrying stat mods. This is the other kind of possession: 3 ration packs, a
// severed access key, 40 rounds of something. One item shape serves both the
// PERSONAL list (one player) and the UNIT list (shared), so moving an item
// between them is a single function rather than two models that drift apart.

import { clampShrives, formatMoney } from "./money";

export interface InvItem {
  id: string;
  name: string;
  qty: number;
  /** Free text — condition, provenance, what it is for. */
  note?: string;
  /** Unit value in Shrives, when it is worth anything. */
  value?: number;
}

export const INV_NAME_MAX = 60;
export const INV_NOTE_MAX = 240;

function uid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return "inv-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 7);
}

/** Normalise anything read off disk or the wire — a hand-edited blob still loads. */
export function parseInventory(raw: unknown): InvItem[] {
  if (!Array.isArray(raw)) return [];
  const out: InvItem[] = [];
  for (const r of raw) {
    if (!r || typeof r !== "object") continue;
    const o = r as Partial<InvItem>;
    const name = String(o.name ?? "").trim().slice(0, INV_NAME_MAX);
    if (!name) continue; // an unnamed item is noise
    const item: InvItem = {
      id: typeof o.id === "string" && o.id ? o.id : uid(),
      name,
      qty: Math.max(0, Math.round(Number(o.qty) || 0)),
    };
    const note = String(o.note ?? "").trim().slice(0, INV_NOTE_MAX);
    if (note) item.note = note;
    const value = clampShrives(Number(o.value) || 0);
    if (value) item.value = value;
    out.push(item);
  }
  return out;
}

/** Add an item. Stacks by name (case-insensitive) rather than making duplicates —
 *  two separate "Ration pack" rows is how an inventory becomes unreadable. */
export function addItem(
  list: InvItem[],
  name: string,
  qty = 1,
  extra: { note?: string; value?: number } = {}
): InvItem[] {
  const clean = name.trim().slice(0, INV_NAME_MAX);
  if (!clean) return list;
  const n = Math.max(1, Math.round(qty) || 1);
  const i = list.findIndex((x) => x.name.toLowerCase() === clean.toLowerCase());
  if (i >= 0) {
    const next = list.slice();
    next[i] = { ...next[i], qty: next[i].qty + n };
    return next;
  }
  const item: InvItem = { id: uid(), name: clean, qty: n };
  if (extra.note) item.note = extra.note.trim().slice(0, INV_NOTE_MAX);
  if (extra.value) item.value = clampShrives(extra.value);
  return [...list, item];
}

/** Set an exact quantity. Zero REMOVES the row — an inventory listing 0 ration
 *  packs is just clutter. */
export function setQty(list: InvItem[], id: string, qty: number): InvItem[] {
  const n = Math.max(0, Math.round(qty) || 0);
  if (n === 0) return list.filter((x) => x.id !== id);
  return list.map((x) => (x.id === id ? { ...x, qty: n } : x));
}

export function stepQty(list: InvItem[], id: string, by: number): InvItem[] {
  const cur = list.find((x) => x.id === id);
  return cur ? setQty(list, id, cur.qty + by) : list;
}

export function patchItem(
  list: InvItem[],
  id: string,
  patch: Partial<Pick<InvItem, "name" | "note" | "value">>
): InvItem[] {
  return list.map((x) => {
    if (x.id !== id) return x;
    const next = { ...x };
    if (patch.name !== undefined) {
      const clean = patch.name.trim().slice(0, INV_NAME_MAX);
      if (clean) next.name = clean;
    }
    if (patch.note !== undefined) {
      const clean = patch.note.trim().slice(0, INV_NOTE_MAX);
      if (clean) next.note = clean;
      else delete next.note;
    }
    if (patch.value !== undefined) {
      const v = clampShrives(patch.value);
      if (v) next.value = v;
      else delete next.value;
    }
    return next;
  });
}

export function removeItem(list: InvItem[], id: string): InvItem[] {
  return list.filter((x) => x.id !== id);
}

/** Move `qty` of an item from one list to the other — the personal↔Unit handoff.
 *  Returns both new lists, or null when the source cannot cover the amount, so a
 *  caller must handle the shortfall rather than silently moving less. */
export function moveItem(
  from: InvItem[],
  to: InvItem[],
  id: string,
  qty = 1
): { from: InvItem[]; to: InvItem[] } | null {
  const item = from.find((x) => x.id === id);
  if (!item) return null;
  const n = Math.max(1, Math.round(qty) || 1);
  if (item.qty < n) return null;
  return {
    from: setQty(from, id, item.qty - n),
    to: addItem(to, item.name, n, { note: item.note, value: item.value }),
  };
}

/** Total worth of a list, in Shrives. Items with no value count as nothing. */
export function inventoryValue(list: InvItem[]): number {
  return clampShrives(list.reduce((t, x) => t + (x.value || 0) * x.qty, 0));
}

/** How many things are in here, counting stacks. */
export function itemCount(list: InvItem[]): number {
  return list.reduce((t, x) => t + x.qty, 0);
}

/** One-line summary for a card: "12 items · 3 Cr". */
export function summarizeInventory(list: InvItem[]): string {
  const n = itemCount(list);
  const worth = inventoryValue(list);
  const items = `${n} item${n === 1 ? "" : "s"}`;
  return worth ? `${items} · ${formatMoney(worth)}` : items;
}
