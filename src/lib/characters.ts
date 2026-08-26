// Async character repository over the SQLite `characters` table (campaign-scoped).
// The structured CharacterSheet is serialized into the `data` JSON column.
// Desktop-only: the vault UI gates on isTauri(); there is no browser fallback.
import type { Character, CharacterSheet } from "../models/character";
import { getDb, sqlAvailable } from "./db";
import { emptySheet, parseSheetSafe, serializeSheet } from "./sheetCodec";

export { emptySheet };

interface CharacterRow {
  id: string;
  campaign_id: string | null;
  name: string;
  data: string | null;
  created_at: number;
  updated_at: number;
}

/** A character row with its parsed sheet attached.
 *
 *  When `corrupt` is set, `sheet` is a BLANK placeholder and `rawData` holds the
 *  original unreadable text. Callers must not write such a record back: the
 *  update path refuses it (see assertSafeToPersist), because the old behaviour was
 *  to render a blank rank-0 character with the right name — reading exactly like
 *  "my character was reset" — and then persist that blank over the real bytes
 *  400ms after the first interaction. */
export interface CharacterRecord extends Character {
  sheet: CharacterSheet;
  /** True when `data` could not be parsed. `sheet` is then not the real sheet. */
  corrupt?: boolean;
  /** The original unreadable `data` text, kept verbatim so it can be recovered. */
  rawData?: string;
  /** Why the parse failed, for the recovery screen. */
  corruptError?: string;
  /** Set when the record was written by a NEWER build; it is readable but the UI
   *  must treat it as read-only. */
  futureVersion?: number;
}

function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return "ch-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
}

function toRecord(row: CharacterRow): CharacterRecord {
  const parsed = parseSheetSafe(row.data);
  return {
    id: row.id,
    campaignId: row.campaign_id,
    name: row.name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    sheet: parsed.sheet,
    // Propagate the failure instead of discarding it. sheetCodec deliberately
    // preserves the raw text for recovery; throwing that away here is what left
    // the destructive half of this bug live after the codec landed.
    ...(parsed.corrupt ? { corrupt: true as const, rawData: parsed.raw, corruptError: parsed.error } : {}),
    ...(parsed.futureVersion ? { futureVersion: parsed.futureVersion } : {}),
  };
}

/** Thrown when something tries to save a character whose stored data could not be
 *  read. Overwriting an unreadable record destroys the only copy of it. */
export class CorruptRecordError extends Error {
  constructor(public readonly id: string) {
    super("Refusing to save over a character whose stored data could not be read.");
    this.name = "CorruptRecordError";
  }
}

/** Thrown when a record was written by a NEWER build. Saving it from here would
 *  normalise fields this build does not understand. */
export class FutureVersionError extends Error {
  constructor(
    public readonly id: string,
    public readonly version: number
  ) {
    super(
      `This character was saved by a newer version of W.T.E (format ${version}). Update W.T.E to edit it — it is shown read-only so nothing is lost.`
    );
    this.name = "FutureVersionError";
  }
}

/** Guard every write path. A corrupt row must be repaired or explicitly reset by
 *  the user, never silently replaced by the placeholder the reader substituted. */
async function assertSafeToPersist(id: string): Promise<void> {
  const db = await getDb();
  const rows = await db.select<{ data: string | null }[]>("SELECT data FROM characters WHERE id = $1", [id]);
  if (rows.length === 0) return; // a new row is fine
  const p = parseSheetSafe(rows[0].data);
  if (p.corrupt) throw new CorruptRecordError(id);
  if (p.futureVersion) throw new FutureVersionError(id, p.futureVersion);
}

/** The unreadable text of a corrupt row, for the recovery screen. */
export async function getRawCharacterData(id: string): Promise<string | null> {
  if (!sqlAvailable()) return null;
  const db = await getDb();
  const rows = await db.select<{ data: string | null }[]>("SELECT data FROM characters WHERE id = $1", [id]);
  return rows[0]?.data ?? null;
}

/** Replace an unreadable row with a blank sheet. This is the ONE path allowed to
 *  overwrite corrupt data, because the user asked for it explicitly after being
 *  shown the raw text — it deliberately bypasses assertSafeToPersist. */
export async function resetCorruptCharacter(id: string): Promise<void> {
  if (!sqlAvailable()) return;
  const db = await getDb();
  await db.execute("UPDATE characters SET data = $1, updated_at = $2 WHERE id = $3", [
    serializeSheet(emptySheet()),
    Date.now(),
    id,
  ]);
}

/** Try to repair a row from text the user edited (e.g. after fixing a truncated
 *  blob by hand, or pasting a backup). Rejects if the replacement is also
 *  unreadable, so a failed repair cannot destroy the original. */
export async function repairCharacterData(id: string, text: string): Promise<void> {
  if (!sqlAvailable()) return;
  const parsed = parseSheetSafe(text);
  if (parsed.corrupt) throw new Error("That text still could not be read as a character — the original is unchanged.");
  const db = await getDb();
  await db.execute("UPDATE characters SET data = $1, updated_at = $2 WHERE id = $3", [
    serializeSheet(parsed.sheet),
    Date.now(),
    id,
  ]);
}

export async function listCharacters(campaignId: string): Promise<CharacterRecord[]> {
  if (!sqlAvailable()) return [];
  const db = await getDb();
  const rows = await db.select<CharacterRow[]>(
    "SELECT * FROM characters WHERE campaign_id = $1 ORDER BY updated_at DESC",
    [campaignId]
  );
  return rows.map(toRecord);
}

/** EVERY character on this device, whatever campaign they are filed under —
 *  including ones with no campaign at all. A player who joins a Curator's table
 *  has characters under their OWN campaign ids (or none), so a table view has to
 *  offer all of them rather than filtering to the Curator's id, which this device
 *  does not own. */
export async function listAllCharacters(): Promise<CharacterRecord[]> {
  if (!sqlAvailable()) return [];
  const db = await getDb();
  const rows = await db.select<CharacterRow[]>("SELECT * FROM characters ORDER BY updated_at DESC");
  return rows.map(toRecord);
}

/** File a character under a different campaign — "carry it over" to the table you
 *  are now playing at. campaign_id has no foreign key, so a player may hold a
 *  character stamped with the Curator's campaign id without owning that row. */
export async function assignCharacterCampaign(id: string, campaignId: string | null): Promise<void> {
  if (!sqlAvailable()) return;
  const db = await getDb();
  await db.execute("UPDATE characters SET campaign_id = $1, updated_at = $2 WHERE id = $3", [
    campaignId,
    Date.now(),
    id,
  ]);
}

export async function getCharacter(id: string): Promise<CharacterRecord | undefined> {
  if (!sqlAvailable()) return undefined;
  const db = await getDb();
  const rows = await db.select<CharacterRow[]>("SELECT * FROM characters WHERE id = $1", [id]);
  return rows[0] ? toRecord(rows[0]) : undefined;
}

export async function countCharacters(campaignId: string): Promise<number> {
  if (!sqlAvailable()) return 0;
  const db = await getDb();
  const rows = await db.select<{ n: number }[]>(
    "SELECT COUNT(*) AS n FROM characters WHERE campaign_id = $1",
    [campaignId]
  );
  return rows[0]?.n ?? 0;
}

export async function createCharacter(
  campaignId: string,
  name: string,
  sheet: CharacterSheet
): Promise<CharacterRecord> {
  const now = Date.now();
  const rec: CharacterRecord = {
    id: newId(),
    campaignId,
    name: name.trim() || "Unnamed Inquisitor",
    createdAt: now,
    updatedAt: now,
    sheet,
  };
  const db = await getDb();
  await db.execute(
    "INSERT INTO characters (id, campaign_id, name, data, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6)",
    [rec.id, campaignId, rec.name, serializeSheet(sheet), now, now]
  );
  return rec;
}

export async function updateCharacter(
  id: string,
  patch: { name?: string; sheet?: CharacterSheet }
): Promise<void> {
  // A name-only edit is safe on a corrupt row (name is its own column), but any
  // write that touches `data` would replace the unreadable original with the
  // placeholder the reader substituted.
  if (patch.sheet !== undefined) await assertSafeToPersist(id);
  const db = await getDb();
  const now = Date.now();
  if (patch.name !== undefined && patch.sheet !== undefined) {
    await db.execute("UPDATE characters SET name = $1, data = $2, updated_at = $3 WHERE id = $4", [
      patch.name.trim() || "Unnamed Inquisitor",
      serializeSheet(patch.sheet),
      now,
      id,
    ]);
  } else if (patch.sheet !== undefined) {
    await db.execute("UPDATE characters SET data = $1, updated_at = $2 WHERE id = $3", [
      serializeSheet(patch.sheet),
      now,
      id,
    ]);
  } else if (patch.name !== undefined) {
    await db.execute("UPDATE characters SET name = $1, updated_at = $2 WHERE id = $3", [
      patch.name.trim() || "Unnamed Inquisitor",
      now,
      id,
    ]);
  }
}

export async function deleteCharacter(id: string): Promise<void> {
  const db = await getDb();
  await db.execute("DELETE FROM characters WHERE id = $1", [id]);
}

export type SheetEditOutcome = "written" | "unchanged" | "missing";

/**
 * Read-modify-write one character's sheet, with the change COMPUTED FROM THE
 * STORED SHEET rather than from whatever the caller was last shown.
 *
 * This exists because a whole-field patch built from a stale copy silently
 * reverts everything else in that field. The Curator's synopsis retracts a
 * handout by writing the whole `handouts` array; retracting two of them in
 * quick succession, each array computed from the same pre-write snapshot, put
 * the first note back on the player's sheet while removing the second. Any
 * list-valued field — `handouts`, `equipment`, `tags` — has the same
 * shape of failure.
 *
 * `build` runs with no `await` between the load and the store, so two edits
 * issued a click apart cannot interleave. Returning null means the fresh sheet
 * needs no change, which is NOT the same answer as a missing record — the two
 * have different things to say to the person who asked.
 */
export async function editCharacterSheet(
  id: string,
  build: (sheet: CharacterSheet) => Partial<CharacterSheet> | null
): Promise<SheetEditOutcome> {
  const rec = await getCharacter(id);
  if (!rec) return "missing";
  // Spreading a corrupt record's placeholder sheet would write a blank character
  // with the patched field applied — this is the path the vault's move-folder and
  // add/remove-tag actions take, so it must refuse too.
  if (rec.corrupt) throw new CorruptRecordError(id);
  const patch = build(rec.sheet);
  if (!patch) return "unchanged";
  await updateCharacter(id, { sheet: { ...rec.sheet, ...patch } });
  return "written";
}

/** Merge a partial sheet change into a character (folder move, tags, notes) —
 *  loads, patches, and persists the whole sheet. Returns false if not found.
 *  Prefer `editCharacterSheet` when the patch depends on the sheet's current
 *  contents; see the note there on stale list-valued writes. */
export async function patchCharacterSheet(id: string, patch: Partial<CharacterSheet>): Promise<boolean> {
  return (await editCharacterSheet(id, () => patch)) !== "missing";
}

/** Insert-or-replace a full record by id — used to apply a character pushed over
 *  netplay (the Curator importing a player's sheet, or either side receiving a
 *  live edit). The record keeps its OWNER's campaignId, so it never shows up in
 *  the receiver's own campaign character list. */
export async function upsertCharacter(rec: CharacterRecord): Promise<void> {
  if (!sqlAvailable()) return;
  // Never push a corrupt-loaded record over the wire into a good local row, and
  // never overwrite a local row that is itself unreadable.
  if (rec.corrupt) throw new CorruptRecordError(rec.id);
  await assertSafeToPersist(rec.id);
  const db = await getDb();
  const now = Date.now();
  await db.execute(
    `INSERT INTO characters (id, campaign_id, name, data, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name,
         data = excluded.data,
         updated_at = excluded.updated_at`,
    [rec.id, rec.campaignId, rec.name || "Unnamed Inquisitor", serializeSheet(rec.sheet), rec.createdAt || now, rec.updatedAt || now]
  );
}
