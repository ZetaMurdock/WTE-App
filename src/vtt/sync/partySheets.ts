// Live character-sheet sharing over netplay (item: "when a player joins, the
// Curator has full control over the sheets"). Players push their full character
// record into the room; the Curator (and the owner) apply incoming records to
// their local DB and can open/edit them, with edits flowing back the same way.
//
// This module is the transport-agnostic core, and it holds two different things:
//
//  1. THE LIVE ROOM — a per-character registry of the latest shared record, its
//     owner, and a content digest. The digest is the loop-breaker: a received
//     record is remembered by it, so re-saving that record (e.g. when an open
//     sheet remounts and normalises on load) will NOT re-broadcast an echo.
//     pruneOwners empties this when a peer leaves, because a peer who is gone has
//     no live sheet to control.
//
//  2. THE AGREEMENT — a per-character, per-FIELD fingerprint of the last content
//     this device and the room are known to have both held. Unlike the live room
//     it is written to disk, because the case it exists for spans disconnections
//     and app restarts: the Curator edits an offline player's HP on Tuesday, the
//     player levels up on Wednesday, and on Friday they reconnect. With no memory
//     of where the two copies last agreed, "who wrote last" is the only available
//     answer and one side's week is destroyed silently. With it, sheetMerge can
//     say which side moved which field, take both, and REPORT the fields that
//     genuinely disagree instead of picking a winner.
//
// The agreement advances in exactly two situations, and this is the whole
// correctness argument: when we RECEIVE content (they demonstrably have what they
// sent), and when we hand content to the wire (they will have it unless they
// refuse it). It never advances for a local edit, which is precisely why an edit
// made while disconnected is still visible as a divergence days later.
//
// One localStorage key per character rather than one blob for the party: a
// damaged blob would be quarantined whole, losing every character's agreement to
// fix one, and a busy sheet would rewrite every other character's bytes.
import type { CharacterRecord } from "../../lib/characters";
import { readJson, writeJson } from "../../lib/localJson";
import {
  advanceFingerprint,
  digestRecord,
  fingerprintRecord,
  mergeSheetRecords,
  type SheetConflictField,
  type SheetField,
  type SheetFingerprint,
} from "./sheetMerge";

export interface PartySheetEntry {
  record: CharacterRecord;
  ownerId: string;
  hash: string;
}

const store = new Map<string, PartySheetEntry>();
const subs = new Set<() => void>();
const EMPTY: readonly PartySheetEntry[] = Object.freeze([]);
let snapshot: readonly PartySheetEntry[] = EMPTY;

const AGREEMENT_PREFIX = "wte-sheet-agreed:";

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

// ── The agreement ledger ──────────────────────────────────────────────────────

interface StoredAgreement {
  keys: Record<string, string>;
  at: number;
  /** Whether this device is the sheet's own machine. Peer ids die with the
   *  session, so this outlives them as the only durable answer to "is this one of
   *  mine, or one the table shared with me". */
  mine: boolean;
}

function validAgreement(v: unknown): boolean {
  if (typeof v !== "object" || v === null) return false;
  const keys = (v as { keys?: unknown }).keys;
  if (typeof keys !== "object" || keys === null || Array.isArray(keys)) return false;
  return Object.values(keys as Record<string, unknown>).every((d) => typeof d === "string");
}

function readLedger(charId: string): StoredAgreement | null {
  const read = readJson<StoredAgreement | null>(AGREEMENT_PREFIX + charId, null, {
    validate: validAgreement,
    label: "sheet sync history",
  });
  if (!read.value) return null;
  return { keys: read.value.keys, at: read.value.at ?? 0, mine: read.value.mine !== false };
}

/** Where this device and the room last agreed this character stood, or null if
 *  they never have. Exported because a record that is held back while its owner
 *  is typing must be reconciled against the agreement as it stood when the record
 *  ARRIVED, not against one the typist's own save has since moved. */
export function agreedSheetBase(charId: string): SheetFingerprint | null {
  const stored = readLedger(charId);
  return stored ? { keys: stored.keys } : null;
}

function writeAgreement(charId: string, fp: SheetFingerprint, mine: boolean): void {
  // Silent: a full disk here costs conflict detection on one sheet, and a toast
  // per received record during a sync storm would bury the ones that matter.
  writeJson(AGREEMENT_PREFIX + charId, { keys: fp.keys, at: Date.now(), mine }, { silent: true });
}

/** The characters THIS machine has shared into a room. That is what a
 *  reconnecting player announces: the sheets it has shared before are exactly the
 *  ones the Curator may have edited in the meantime, and announcing them is what
 *  lets the Curator's offline edits come back down the wire.
 *
 *  Sheets the room shared with US are excluded. Announcing those would have a
 *  player pushing other people's characters around the table on every connection
 *  — traffic that can only carry a stale copy, since this device is not where
 *  those sheets are edited. */
export function ownSharedSheetIds(): string[] {
  const out: string[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || !k.startsWith(AGREEMENT_PREFIX)) continue;
      const id = k.slice(AGREEMENT_PREFIX.length);
      if (readLedger(id)?.mine) out.push(id);
    }
  } catch {
    /* storage unavailable — nothing has been shared from this device */
  }
  return out;
}

// ── Applying what arrives ─────────────────────────────────────────────────────

export interface SheetAuthCtx {
  selfId: string;
  /** The room host's peer id (the Curator) — null when unknown. */
  hostId: string | null;
  /** The record this device's vault already holds under that id. Pass `null` for
   *  "there is no such row"; leaving it undefined falls back to the live room. */
  local?: CharacterRecord | null;
  /** Reconcile against this agreement instead of the stored one. */
  base?: SheetFingerprint | null;
  /** The caller has matched this sender against the record's DURABLE owner — the
   *  Curator's roster, which remembers a player by table name across sessions.
   *
   *  Peer ids are regenerated every session, so a player who reconnects is a
   *  stranger to the live room: without something durable to check them against,
   *  the only choices are to lock them out of their own character or to let ANY
   *  peer write a sheet whose owner is not currently connected. This is the
   *  third choice, and it is the caller's to make because only the host keeps a
   *  roster. Absent means "not established", and the answer to that is no. */
  ownerClaim?: boolean;
}

export interface SheetApplyOutcome {
  /** denied    — the sender may not touch this record; nothing was read or written.
   *  unchanged — our copy already says this, or ours is ahead of theirs.
   *  applied   — `record` is what the vault should now hold.
   *  conflict  — the two copies disagree; `record` is the uncontested part, if any. */
  kind: "denied" | "unchanged" | "applied" | "conflict";
  /** Write this to the vault (kinds "applied" and sometimes "conflict"). */
  record?: CharacterRecord;
  /** Publish this back to the sender: our side holds something theirs lacks. */
  reply?: CharacterRecord;
  /** Fields both sides moved differently — for kind "conflict". */
  conflicts?: SheetConflictField[];
  /** Fields adopted from the sender, for a change notice. */
  took?: SheetField[];
  /** Why a "denied" was denied, when the answer is worth showing a person.
   *  "not-owner" is the one case a HUMAN may need to act on: a record this vault
   *  holds, offered by someone we cannot tell is its owner. That is usually an
   *  intruder and correctly ignored, but it is also what a returning player looks
   *  like when the table has forgotten their name — and silently dropping their
   *  sheet forever is not something to do without saying so. */
  reason?: "not-owner";
}

const DENIED: SheetApplyOutcome = { kind: "denied" };
const NOT_OWNER: SheetApplyOutcome = { kind: "denied", reason: "not-owner" };

function remember(rec: CharacterRecord, ownerId: string): void {
  store.set(rec.id, { record: rec, ownerId, hash: digestRecord(rec) });
  notify();
}

/** Apply a record received from a peer, enforcing OWNERSHIP:
 *  - the host (Curator) may update any sheet — full control;
 *  - a peer may create (first share) or update only records THEY own;
 *  - our own echo is always allowed;
 *  - an id this room has never shared, which collides with a row already in this
 *    vault, is refused unless it comes from the host — so a forged "first share"
 *    can never overwrite a character the Curator never put on the table;
 *  - the ownerId binding is first-writer-wins and PRESERVED across host edits
 *    and echoes (a host edit must not rebind the player's sheet to the host).
 *
 *  What survives that check is then RECONCILED rather than copied over the local
 *  row — see sheetMerge. The caller writes `record`, publishes `reply` to the
 *  sender, and surfaces `conflicts`; nothing here writes to the vault itself. */
export function applyRemoteSheet(rec: CharacterRecord, from: string, ctx: SheetAuthCtx): SheetApplyOutcome {
  const cur = store.get(rec.id);
  const isHost = ctx.hostId != null && from === ctx.hostId;
  const isSelf = from === ctx.selfId;
  const ledger = readLedger(rec.id);
  // ON A PLAYER'S MACHINE, ONLY THE CURATOR AND WE OURSELVES MAY WRITE ANYTHING.
  // A player has no business accepting a record from another player: they never
  // display one (every consumer of this store is behind a host check), so the
  // only thing such a message can do is overwrite their character or plant a
  // stranger's in their vault. Fail closed while the host is unknown — a peer
  // who arrives before the host is identified is exactly the one to distrust.
  if (ctx.hostId !== ctx.selfId && !isHost && !isSelf) return DENIED;
  // The live room forgets who owns a sheet when its owner disconnects, so a
  // Curator edit made while they were away re-creates the entry under the
  // CURATOR's id. That is bookkeeping, not ownership: left to stand, it answers
  // the returning player's own record with "you may not write that sheet" and
  // locks them out of their character for good. A sheet the ledger knows to be
  // one of OURS is never reclaimable this way.
  // ...but the reclaim is only for the player it belongs to. Without the durable
  // owner check it read as "any peer may seize any sheet the Curator has touched",
  // which is the opposite of what it was written for.
  const reclaimable = !!cur && cur.ownerId === ctx.selfId && ledger?.mine === false && ctx.ownerClaim === true;
  if (cur && cur.ownerId !== from && !isHost && !isSelf && !reclaimable) return NOT_OWNER;
  // A record that could not be read on the sender's machine is a blank
  // placeholder wearing the right name. Applying one would destroy a good local
  // copy of the sheet on every other device in the room.
  if (rec.corrupt) return DENIED;

  const local = ctx.local !== undefined ? ctx.local : (cur?.record ?? null);
  const agreed = ctx.base !== undefined ? ctx.base : (ledger ? { keys: ledger.keys } : null);
  // A row already in this vault, and no LIVE binding saying this sender owns it.
  // The agreement ledger cannot stand in for that binding: it remembers that the
  // character was shared, never by whom, so treating its presence as permission
  // turned every sheet whose owner had merely disconnected into one any peer in
  // the room could rewrite. Only a durable owner match reopens it.
  if (!cur && local && !isHost && !isSelf && !ctx.ownerClaim) return NOT_OWNER;
  // Never write over bytes this device could not read, nor over a record a newer
  // build wrote: both are rows whose only good copy is the one already on disk.
  if (local && (local.corrupt || local.futureVersion)) return DENIED;

  const ownerId = reclaimable || !cur ? from : cur.ownerId;
  // Whoever introduced the character decides whose machine it lives on, once and
  // for good. Recomputing it per message would mean that the Curator editing a
  // player's sheet re-files it as the Curator's, and that the Curator's own NPC
  // stopped being theirs the moment they let a player see it.
  const mine = ledger ? ledger.mine : isSelf;

  if (!local) {
    // First contact: there is no local work to protect, so their record IS the
    // record, and the two sides now agree on all of it.
    remember(rec, ownerId);
    writeAgreement(rec.id, fingerprintRecord(rec), mine);
    return { kind: "applied", record: rec };
  }

  const merged = mergeSheetRecords(agreed, local, rec);
  switch (merged.status) {
    case "identical":
      remember(merged.record, ownerId);
      writeAgreement(rec.id, fingerprintRecord(merged.record), mine);
      return { kind: "unchanged" };
    case "theirs":
      remember(merged.record, ownerId);
      writeAgreement(rec.id, advanceFingerprint(agreed, merged.record, merged.agreed), mine);
      return { kind: "applied", record: merged.record, took: merged.took };
    case "ours":
      // Their copy is behind ours and carries no edit of its own. Send ours back;
      // this is the delivery of an edit made while they were away.
      remember(local, ownerId);
      writeAgreement(rec.id, fingerprintRecord(local), mine);
      return { kind: "unchanged", reply: local };
    case "merged":
      remember(merged.record, ownerId);
      writeAgreement(rec.id, fingerprintRecord(merged.record), mine);
      return { kind: "applied", record: merged.record, reply: merged.record, took: merged.took };
    case "conflict":
    default:
      // Nothing contested is written and nothing is sent: a reply here would be
      // answered by their own conflict, and the two machines would trade whole
      // sheets forever. The uncontested fields still move, so a disagreement
      // about Rank does not also hold up the Curator's HP adjustment.
      if (merged.took.length > 0) {
        remember(merged.record, ownerId);
        writeAgreement(rec.id, advanceFingerprint(agreed, merged.record, merged.agreed), mine);
        return { kind: "conflict", record: merged.record, took: merged.took, conflicts: merged.conflicts };
      }
      return { kind: "conflict", conflicts: merged.conflicts };
  }
}

/** Decide whether a locally-saved record is new information worth broadcasting.
 *  Returns false when it matches what we last sent/received for that character
 *  (which is exactly the echo we must not rebroadcast). `selfId` marks us as the
 *  owner for local-origin records.
 *
 *  Handing content to the wire also moves the agreement: the room will hold this
 *  unless it refuses it, and an agreement that lags what we have already sent
 *  turns every ordinary live edit that follows into a phantom conflict. */
export function shouldBroadcastSheet(rec: CharacterRecord, selfId: string): boolean {
  const h = digestRecord(rec);
  const cur = store.get(rec.id);
  if (cur && cur.hash === h) return false;
  store.set(rec.id, { record: rec, ownerId: cur?.ownerId ?? selfId, hash: h });
  // Saving a sheet the table shared with us does not make it ours — the Curator
  // editing an absent player's character is the ordinary case, not a claim on it.
  const mine = readLedger(rec.id)?.mine ?? true;
  // Handing content to the wire only counts as an agreement if the machine this
  // sheet belongs to is IN the room to hear it. Broadcasting a player's sheet
  // while that player is offline is precisely the edit that has to still read as
  // a divergence when they come back on Friday — treat it as agreed and the
  // reunion hands the Curator's work back to the stale copy and erases it.
  if (mine || (cur && cur.ownerId !== selfId)) writeAgreement(rec.id, fingerprintRecord(rec), mine);
  notify();
  return true;
}

/**
 * The peer whose machine this character LIVES on, if that machine is in the room
 * right now. Null for our own characters and for an owner who is offline.
 *
 * WHY A SEND NEEDS THIS: a host publish with no target reaches every player in
 * the room, and a sheet-patch is accepted from the host unconditionally. So the
 * Curator merely OPENING a player's sheet pushed that player's whole character
 * record onto every other player's machine, where the subscriber wrote it into
 * their vault — one player's character silently appearing in another's Characters
 * list, and a copy they could then push back at the table. Nothing player-facing
 * reads another player's sheet, so the answer is not to send it: a sheet's only
 * audiences are its own machine and the Curator.
 *
 * Null is not a failure. The Curator's edit to an absent player's sheet is a row
 * in the vault, and the player asks for it by announcing when they reconnect.
 */
export function sheetHomePeer(charId: string, selfId: string, livingPeerIds: ReadonlySet<string>): string | null {
  const owner = store.get(charId)?.ownerId;
  if (!owner || owner === selfId) return null;
  return livingPeerIds.has(owner) ? owner : null;
}

/** True when the ledger remembers this character as one the TABLE shared with us
 *  rather than one of ours. A player must never push such a record back: their
 *  copy can only be staler than the owner's, the host refuses it as not-theirs,
 *  and each refusal costs the Curator a sticky "someone sent a sheet that is not
 *  theirs" toast about traffic no human asked for. */
export function isForeignSheet(charId: string): boolean {
  return readLedger(charId)?.mine === false;
}

/** Drop sheets owned by peers who have left the room. The AGREEMENT is
 *  deliberately not dropped: the record is still in this vault and the Curator
 *  can still edit it, so where the two copies last agreed is exactly what has to
 *  outlive the disconnection. */
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

/** Test seam: forget the live room, so a suite can simulate the app restarting
 *  and prove that what survives is the agreement on disk. */
export function __resetPartySheets(): void {
  store.clear();
  snapshot = EMPTY;
}
