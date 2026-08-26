// The Curator's DURABLE party roster: which characters belong to this table, who
// shared each one, and when it was last seen.
//
// Why this is a separate store from partySheets: that one is the LIVE room, and
// pruneOwners empties it the moment a peer disconnects — correctly, because a
// disconnected peer has no live sheet to control. The player's record itself is
// already sitting in the Curator's database (the sheet-patch subscriber upserts
// every record it accepts), but with the live store emptied the Curator had no
// way to know the record existed or whose it was, so a player's sheet became
// unreachable the instant they closed the app. This roster is the memory of that
// fact. It is persisted per campaign, so it also survives the room closing and
// the app restarting.
//
// OWNERSHIP HERE IS LOAD-BEARING, AND IT IS WEAK. It began as a display label,
// but VttScreen's recognisedOwner now matches a reconnecting peer's name against
// `ownerName` to decide whether that peer may reclaim a sheet the Curator edited
// while they were away (partySheets' `ownerClaim`). Peer names arrive in the
// joiner's own `hello` message — they are self-declared and not authenticated —
// so a peer who types another player's table name passes that check. Closing it
// needs a durable player identity in the netplay handshake; until then, treat
// every value in this module as an untrusted claim, and do not add any further
// authorization that leans on `ownerName`.
//
// Peer ids are regenerated per session, so `ownerId` is a last-known handle used
// to match a returning player against the live room, never a permission.
import { kvGet, kvSet } from "../../lib/campaignStore";

export interface RosterMember {
  /** The character record's id — the same id the local DB row is keyed by. */
  charId: string;
  name: string;
  /** Last-known peer id of the sharer. Ephemeral; for matching a live peer only. */
  ownerId: string;
  /** The sharer's DEVICE key — their peer id with the per-session suffix removed
   *  (see `peerDeviceKey`). Durable across reconnects, and the only thing here
   *  fit to decide whether a returning peer is who they say they are. */
  ownerKey?: string;
  /** Durable, human-readable owner label. Display only — a name is typed by the
   *  peer who joins, so it can never gate a write. */
  ownerName: string;
  /** Epoch ms of the last time this sheet was received or shared. */
  lastSeen: number;
}

/**
 * The stable half of a peer id.
 *
 * `discovery.ts` mints an id as `<device base>-<6 random chars>`: the base lives
 * in localStorage and outlives sessions, the suffix keeps two tabs on one
 * machine apart. Reunion has to key on the base — the full id changes every
 * session, and a display name is typed by whoever joins.
 */
/**
 * Can this peer be recognised as the owner of a roster entry?
 *
 * An entry written before `ownerKey` existed has none, and the strict answer —
 * "no key, no reclaim" — locked real players out of their own characters: the
 * Curator opening a sheet rebinds it to the host, and the reclaim that hands it
 * back needs a credential the entry never stored. That shipped in v0.8.86 and
 * denied three of one table's characters on sight.
 *
 * So a keyless entry is adopted by the first peer to claim it, and the key is
 * written on the spot. It is trust-on-first-use, and it is bounded: it happens
 * once per entry, only for entries that predate the field, and only for a peer
 * the room already accepted. Every entry written since carries a key and is
 * matched exactly — a name is never a credential again.
 */
export function ownerMatches(member: { ownerKey?: string } | null | undefined, peerId: string): boolean {
  const key = member?.ownerKey?.trim();
  if (!key) return true; // legacy entry: unclaimed, adopt on first sight
  return !!peerId && peerDeviceKey(peerId) === key;
}

/** Does this entry still need a device key written to it? */
export function needsOwnerKey(member: { ownerKey?: string } | null | undefined): boolean {
  return !member?.ownerKey?.trim();
}

export function peerDeviceKey(peerId: string | null | undefined): string {
  const id = String(peerId ?? "").trim();
  if (!id) return "";
  return id.replace(/-[a-z0-9]{6}$/i, "");
}

const SCOPE = "misc" as const;
const KEY = "party-roster";

const EMPTY: readonly RosterMember[] = Object.freeze([]);
let snapshot: readonly RosterMember[] = EMPTY;
/** Which campaign `snapshot` belongs to; null before the first load. */
let loadedFor: string | null = null;
const subs = new Set<() => void>();

function notify(): void {
  for (const cb of subs) cb();
}

function sanitize(raw: unknown): RosterMember[] {
  if (!Array.isArray(raw)) return [];
  const out: RosterMember[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const m = item as Partial<RosterMember>;
    // A damaged or half-written entry must not crash the Actors panel, and must
    // not resurrect as an unopenable ghost row: an entry with no charId cannot
    // load a record, so it is dropped rather than rendered.
    // An EMPTY charId is as unopenable as a missing one, and worse: it matches
    // nothing in the vault, so the row renders, does nothing when clicked, and
    // cannot even be told apart from a second blank entry by Remove.
    if (typeof m.charId !== "string" || !m.charId) continue;
    out.push({
      charId: m.charId,
      name: typeof m.name === "string" && m.name ? m.name : "Unnamed",
      ownerId: typeof m.ownerId === "string" ? m.ownerId : "",
      ownerName: typeof m.ownerName === "string" && m.ownerName ? m.ownerName : "player",
      lastSeen: typeof m.lastSeen === "number" && Number.isFinite(m.lastSeen) ? m.lastSeen : 0,
    });
  }
  return out;
}

/** Most recently seen first, so the players at tonight's table sort to the top. */
function order(list: RosterMember[]): readonly RosterMember[] {
  return list.length === 0 ? EMPTY : Object.freeze([...list].sort((a, b) => b.lastSeen - a.lastSeen));
}

async function persist(campaignId: string, list: readonly RosterMember[]): Promise<void> {
  await kvSet(campaignId, SCOPE, KEY, list);
}

/** The roster as last loaded (stable reference between mutations, for
 *  useSyncExternalStore). Empty until loadPartyRoster resolves. */
export function getPartyRoster(): readonly RosterMember[] {
  return snapshot;
}

export function subscribePartyRoster(cb: () => void): () => void {
  subs.add(cb);
  return () => {
    subs.delete(cb);
  };
}

/** Read this campaign's roster from the database into the snapshot. Safe to call
 *  repeatedly; switching campaigns replaces the snapshot rather than merging, so
 *  one table's players can never leak into another's Actors panel. */
export async function loadPartyRoster(campaignId: string): Promise<readonly RosterMember[]> {
  if (!campaignId) {
    loadedFor = null;
    snapshot = EMPTY;
    notify();
    return snapshot;
  }
  // A read that throws must still COMMIT to this campaign. Leaving `loadedFor`
  // behind would keep the previous table's members on screen and make the next
  // remember() append this campaign's player to that list and persist it —
  // turning a transient database error into a permanent cross-campaign leak.
  const stored = await kvGet<unknown>(campaignId, SCOPE, KEY).catch(() => null);
  loadedFor = campaignId;
  snapshot = order(sanitize(stored));
  notify();
  return snapshot;
}

/** Ensure the snapshot belongs to `campaignId` before a read-modify-write, so a
 *  remember() that races the initial load cannot persist a roster built on top of
 *  the previous campaign's list. */
async function ensureLoaded(campaignId: string): Promise<void> {
  if (loadedFor !== campaignId) await loadPartyRoster(campaignId);
}

export interface RosterSighting {
  charId: string;
  name: string;
  ownerId: string;
  /** The sharer's device key. Written on the first sighting, and backfilled the
   *  first time a legacy entry is claimed. */
  ownerKey?: string;
  ownerName: string;
  /** Defaults to now; injectable so tests are not clock-dependent. */
  at?: number;
}

/** Record that this character was shared into the table — the call that makes a
 *  player permanently reachable. Upserts by charId: a returning player refreshes
 *  their name, their new peer id and lastSeen without duplicating the row. */
export async function rememberPartyMember(campaignId: string, m: RosterSighting): Promise<void> {
  if (!campaignId || !m.charId) return;
  await ensureLoaded(campaignId);
  const at = m.at ?? Date.now();
  const next = snapshot.filter((e) => e.charId !== m.charId);
  // The key is written explicitly rather than spread, so a field added to the
  // sighting can never reach the stored roster unnoticed. It was DROPPED here
  // when it was introduced, which meant no entry ever carried one — and the
  // reclaim that hands a returning player their sheet back needs it, so every
  // player whose sheet the Curator had opened was refused on sight.
  const held = snapshot.find((e) => e.charId === m.charId);
  const ownerKey = m.ownerKey?.trim() || held?.ownerKey?.trim();
  next.push({
    charId: m.charId,
    name: m.name,
    ownerId: m.ownerId,
    ...(ownerKey ? { ownerKey } : {}),
    ownerName: m.ownerName,
    lastSeen: at,
  });
  snapshot = order(next);
  notify();
  await persist(campaignId, snapshot);
}

/** Drop a member from the roster. This is a ROSTER removal only — the character
 *  record stays in the database untouched, because the Curator dismissing a
 *  player who left the campaign must never destroy that player's character. */
export async function forgetPartyMember(campaignId: string, charId: string): Promise<void> {
  if (!campaignId || !charId) return;
  await ensureLoaded(campaignId);
  if (!snapshot.some((e) => e.charId === charId)) return;
  snapshot = order(snapshot.filter((e) => e.charId !== charId));
  notify();
  await persist(campaignId, snapshot);
}

export interface SightingCredit {
  ownerId: string;
  /** Derived from `ownerId`, so the roster never has to trust a typed name to
   *  recognise this player again. */
  ownerKey: string;
  ownerName: string;
}

/**
 * Decide WHOSE character an accepted record is, before it is filed on the roster.
 *
 * This lives here rather than at the call site because it is the rule that keeps
 * the roster honest, and it is not obvious: the sender is NOT the owner. When the
 * Curator edits an offline player's sheet, that record comes back through the
 * same path stamped with the Curator's own peer id — crediting `from` would file
 * every player's character under the Curator, and the moment it did, the panel
 * would stop being able to say whose sheet is whose. So the live partySheets
 * binding wins, and `from` is only the fallback for a genuine first share.
 *
 * Returns null when the record is this device's own, which is not a roster entry:
 * the Curator's vault is already the Curator's vault.
 */
export function creditSighting(input: {
  /** Peer the record arrived from. */
  from: string;
  /** This device's peer id. */
  selfId: string;
  /** Owner the live store has bound this character to. Blank or absent means the
   *  binding is gone — the sharer disconnected — so `from` is all there is. */
  boundOwnerId?: string | null;
  /** Peers in the room right now, for a display name. */
  peers: readonly { id: string; name: string }[];
  /** Owner name already recorded for this character, if any. */
  knownName?: string | null;
}): SightingCredit | null {
  const ownerId = input.boundOwnerId || input.from;
  if (!ownerId || ownerId === input.selfId) return null;
  // A sheet can arrive before the peer list has caught up, and a returning player
  // must not be demoted to "player" just because their row landed first — the
  // name already on the roster is a better answer than the placeholder.
  const live = input.peers.find((p) => p.id === ownerId)?.name;
  return { ownerId, ownerKey: peerDeviceKey(ownerId), ownerName: live || input.knownName || "player" };
}

/** How long ago this member was last at the table, in words. Removal is
 *  destructive to the roster and easy to misfire, so the Curator needs to tell a
 *  player who was here an hour ago from one who left the campaign months back
 *  BEFORE clicking it — a bare timestamp does not read that way at a glance. */
export function lastSeenLabel(lastSeen: number, now = Date.now()): string {
  if (!lastSeen || lastSeen <= 0) return "last seen unknown";
  const secs = Math.max(0, Math.round((now - lastSeen) / 1000));
  if (secs < 90) return "seen just now";
  const mins = Math.round(secs / 60);
  if (mins < 60) return `seen ${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `seen ${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `seen ${days} ${days === 1 ? "day" : "days"} ago`;
  return `seen ${new Date(lastSeen).toLocaleDateString()}`;
}

/** Test seam: forget everything held in memory, so a suite can simulate the app
 *  restarting and prove the roster comes back from the database. */
export function __resetPartyRoster(): void {
  loadedFor = null;
  snapshot = EMPTY;
}
