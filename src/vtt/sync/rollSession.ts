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
// closed; the tray just renders from here. DB history hydrates the store once.

export interface SessionRoll {
  id: string;
  who: string;
  label: string;
  formula: string;
  result: number;
  at: number;
}

const store = new Map<string, SessionRoll[]>();
const hydrated = new Set<string>();
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

/** Append a live roll (local or peer). De-duped by id so a self-echoed publish
 *  can't double-count. */
export function addSessionRoll(campaignId: string, roll: SessionRoll): void {
  const cur = store.get(campaignId) ?? [];
  if (cur.some((r) => r.id === roll.id)) return;
  store.set(campaignId, [roll, ...cur].slice(0, CAP));
  notify();
}

/** Seed the store from SQLite history the first time this campaign is opened in
 *  the session; a no-op afterwards so it never clobbers captured live rolls. */
export function hydrateSessionRolls(campaignId: string, rolls: SessionRoll[]): void {
  if (hydrated.has(campaignId)) return;
  hydrated.add(campaignId);
  const cur = store.get(campaignId) ?? [];
  const seen = new Set(cur.map((r) => r.id));
  store.set(campaignId, [...cur, ...rolls.filter((r) => !seen.has(r.id))].slice(0, CAP));
  notify();
}

export function subscribeSessionRolls(cb: () => void): () => void {
  subs.add(cb);
  return () => {
    subs.delete(cb);
  };
}
