// Durable, per-campaign roll log that OUTLIVES the roll tray's mount cycle.
//
// The VTT roll panel is only rendered while open (`rollsOpen && <VttRollFeed/>`),
// so its component-local state — and its `net.subscribe("roll")` listener — died
// every time the tray closed. Reopening it showed only this client's own SQLite
// history; every live roll (and every peer's roll, which is never written to this
// client's DB) was lost. Across a session of opening/closing the tray it looked
// like the dice roller "reset over time".
//
// This module keeps the shared roll history in a module-level store that lives
// as long as the app session. VttScreen subscribes to the netplay `roll` message
// at an always-mounted level so peer rolls are captured even while the tray is
// closed; the tray just renders from here. DB history is merged idempotently so
// a manual reload can discover new durable rows without clobbering live rolls.

import type { NetRollMode } from "../../net/protocol";

export interface SessionRoll {
  id: string;
  who: string;
  label: string;
  formula: string;
  result: number;
  at: number;
  characterId?: string | null;
  tokenId?: string;
  requestId?: string;
  baseExpr?: string;
  mode?: NetRollMode;
  detail?: unknown;
}

const store = new Map<string, SessionRoll[]>();
const subs = new Set<() => void>();
const CAP = 100;
// Shared empty result so getSessionRolls returns a STABLE reference when a
// campaign has no rolls yet — required by useSyncExternalStore's getSnapshot.
const EMPTY: readonly SessionRoll[] = Object.freeze([]);

function notify(): void {
  for (const cb of subs) cb();
}

export function getSessionRolls(campaignId: string): readonly SessionRoll[] {
  return store.get(campaignId) ?? EMPTY;
}

/** Campaigns can be opened in more than one table over an app lifetime. Use a
 * room-qualified scope while connected so rolls from those tables do not leak
 * into each other; solo/offline callers retain the legacy campaign-only key. */
export function rollSessionScope(campaignId: string, room?: string | null): string {
  const table = room?.trim();
  return table ? `${campaignId}::table:${encodeURIComponent(table)}` : campaignId;
}

function sameOptionalFields(a: SessionRoll, b: SessionRoll): boolean {
  return (
    a.who === b.who &&
    a.label === b.label &&
    a.formula === b.formula &&
    a.result === b.result &&
    a.at === b.at &&
    a.characterId === b.characterId &&
    a.tokenId === b.tokenId &&
    a.requestId === b.requestId &&
    a.baseExpr === b.baseExpr &&
    a.mode === b.mode &&
    a.detail === b.detail
  );
}

/** Keep the first-seen result immutable (a repeated wire packet must not alter
 * dice), while filling display/identity fields absent from a legacy copy. */
function mergeDuplicate(current: SessionRoll, incoming: SessionRoll): SessionRoll {
  const merged: SessionRoll = {
    ...current,
    who: current.who || incoming.who,
    label: current.label || incoming.label,
    characterId: current.characterId ?? incoming.characterId,
    tokenId: current.tokenId ?? incoming.tokenId,
    requestId: current.requestId ?? incoming.requestId,
    baseExpr: current.baseExpr ?? incoming.baseExpr,
    mode: current.mode ?? incoming.mode,
    detail: current.detail ?? incoming.detail,
  };
  return sameOptionalFields(current, merged) ? current : merged;
}

function newestFirst(a: SessionRoll, b: SessionRoll): number {
  // Array#sort is stable: equal timestamps retain insertion order, so a live
  // roll prepended in the same millisecond still appears ahead of the prior one.
  return b.at - a.at;
}

/** Append a live roll (local or peer). De-duped by id so a self-echoed publish
 *  can't double-count. */
export function addSessionRoll(campaignId: string, roll: SessionRoll): void {
  const cur = store.get(campaignId) ?? [];
  const duplicate = cur.findIndex((r) => r.id === roll.id);
  if (duplicate >= 0) {
    const merged = mergeDuplicate(cur[duplicate], roll);
    if (merged === cur[duplicate]) return;
    const next = cur.slice();
    next[duplicate] = merged;
    store.set(campaignId, next);
    notify();
    return;
  }
  store.set(campaignId, [roll, ...cur].sort(newestFirst).slice(0, CAP));
  notify();
}

/** Merge SQLite history beneath/among captured live rolls. Stable ids make this
 * safe to repeat from the Reload button, and first-seen live results win when a
 * durable row represents the same roll. */
export function hydrateSessionRolls(campaignId: string, rolls: SessionRoll[]): void {
  const cur = store.get(campaignId) ?? [];
  const byId = new Map(cur.map((r) => [r.id, r]));
  for (const incoming of rolls) {
    const existing = byId.get(incoming.id);
    byId.set(incoming.id, existing ? mergeDuplicate(existing, incoming) : incoming);
  }
  const next = [...byId.values()].sort(newestFirst).slice(0, CAP);
  if (next.length === cur.length && next.every((r, i) => r === cur[i])) return;
  store.set(campaignId, next);
  notify();
}

/** Clear one table/campaign scope on leave, or every scope in tests/logout. */
export function clearSessionRolls(campaignId?: string): void {
  const changed = campaignId ? store.delete(campaignId) : store.size > 0;
  if (!campaignId) store.clear();
  if (changed) notify();
}

export function subscribeSessionRolls(cb: () => void): () => void {
  subs.add(cb);
  return () => {
    subs.delete(cb);
  };
}
