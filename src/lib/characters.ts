// Async character repository over the SQLite `characters` table (campaign-scoped).
// The structured CharacterSheet is serialized into the `data` JSON column.
// Desktop-only: the vault UI gates on isTauri(); there is no browser fallback.
import type { Character, CharacterSheet } from "../models/character";
import { getDb, sqlAvailable } from "./db";
import { zeroAttributes, zeroSpecialties } from "../game/wte";

interface CharacterRow {
  id: string;
  campaign_id: string | null;
  name: string;
  data: string | null;
  created_at: number;
  updated_at: number;
}

/** A character row with its parsed sheet attached. */
export interface CharacterRecord extends Character {
  sheet: CharacterSheet;
}

function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return "ch-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
}

export function emptySheet(): CharacterSheet {
  return { attributes: zeroAttributes(), specialties: zeroSpecialties(), rank: 0, notes: "" };
}

function parseSheet(raw: string | null): CharacterSheet {
  if (!raw) return emptySheet();
  try {
    const p = JSON.parse(raw) as Partial<CharacterSheet>;
    return {
      attributes: { ...zeroAttributes(), ...(p.attributes || {}) },
      specialties: { ...zeroSpecialties(), ...(p.specialties || {}) },
      speciesId: p.speciesId,
      variantName: p.variantName,
      variantOption: p.variantOption,
      paradigmId: p.paradigmId,
      rank: typeof p.rank === "number" ? p.rank : 0,
      portrait: p.portrait,
      background: p.background,
      sizeId: p.sizeId || "auto",
      equipment: Array.isArray(p.equipment) ? p.equipment : [],
      genusLoadout: Array.isArray(p.genusLoadout) ? p.genusLoadout : [],
      cipherLoadout: Array.isArray(p.cipherLoadout) ? p.cipherLoadout : [],
      weaponLoadout: Array.isArray(p.weaponLoadout) ? p.weaponLoadout : [],
      gearLoadout: Array.isArray(p.gearLoadout) ? p.gearLoadout : [],
      ssSpent: typeof p.ssSpent === "number" ? p.ssSpent : 0,
      notes: p.notes || "",
      negotiation: p.negotiation && typeof p.negotiation === "object" ? p.negotiation : undefined,
      folderId: p.folderId ?? null,
      tags: Array.isArray(p.tags) ? p.tags : [],
      notesMd: typeof p.notesMd === "string" ? p.notesMd : "",
    };
  } catch {
    return emptySheet();
  }
}

function toRecord(row: CharacterRow): CharacterRecord {
  return {
    id: row.id,
    campaignId: row.campaign_id,
    name: row.name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    sheet: parseSheet(row.data),
  };
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
    [rec.id, campaignId, rec.name, JSON.stringify(sheet), now, now]
  );
  return rec;
}

export async function updateCharacter(
  id: string,
  patch: { name?: string; sheet?: CharacterSheet }
): Promise<void> {
  const db = await getDb();
  const now = Date.now();
  if (patch.name !== undefined && patch.sheet !== undefined) {
    await db.execute("UPDATE characters SET name = $1, data = $2, updated_at = $3 WHERE id = $4", [
      patch.name.trim() || "Unnamed Inquisitor",
      JSON.stringify(patch.sheet),
      now,
      id,
    ]);
  } else if (patch.sheet !== undefined) {
    await db.execute("UPDATE characters SET data = $1, updated_at = $2 WHERE id = $3", [
      JSON.stringify(patch.sheet),
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

/** Merge a partial sheet change into a character (folder move, tags, notes) —
 *  loads, patches, and persists the whole sheet. Returns false if not found. */
export async function patchCharacterSheet(id: string, patch: Partial<CharacterSheet>): Promise<boolean> {
  const rec = await getCharacter(id);
  if (!rec) return false;
  await updateCharacter(id, { sheet: { ...rec.sheet, ...patch } });
  return true;
}

/** Insert-or-replace a full record by id — used to apply a character pushed over
 *  netplay (the Curator importing a player's sheet, or either side receiving a
 *  live edit). The record keeps its OWNER's campaignId, so it never shows up in
 *  the receiver's own campaign character list. */
export async function upsertCharacter(rec: CharacterRecord): Promise<void> {
  if (!sqlAvailable()) return;
  const db = await getDb();
  const now = Date.now();
  await db.execute(
    `INSERT INTO characters (id, campaign_id, name, data, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name,
         data = excluded.data,
         updated_at = excluded.updated_at`,
    [rec.id, rec.campaignId, rec.name || "Unnamed Inquisitor", JSON.stringify(rec.sheet), rec.createdAt || now, rec.updatedAt || now]
  );
}
