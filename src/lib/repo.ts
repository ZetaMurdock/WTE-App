// Async campaign repository. Uses SQLite inside the desktop app and falls back
// to the localStorage implementation (storage.ts) in a plain browser (npm run dev).
// The active-campaign pointer stays in localStorage as a per-device UI preference.
import type { Campaign } from "../models/campaign";
import { getDb, sqlAvailable } from "./db";
import * as ls from "./storage";

interface CampaignRow {
  id: string;
  name: string;
  system: string | null;
  created_at: number;
  updated_at: number;
  archived: number;
}

function rowToCampaign(r: CampaignRow): Campaign {
  return {
    id: r.id,
    name: r.name,
    system: r.system ?? undefined,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    archived: !!r.archived,
  };
}

function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return "c-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
}

export async function listCampaigns(includeArchived = false): Promise<Campaign[]> {
  if (!sqlAvailable()) return ls.listCampaigns(includeArchived);
  const db = await getDb();
  const where = includeArchived ? "" : "WHERE archived = 0";
  const rows = await db.select<CampaignRow[]>(
    `SELECT * FROM campaigns ${where} ORDER BY updated_at DESC`
  );
  return rows.map(rowToCampaign);
}

export async function getCampaign(id: string): Promise<Campaign | undefined> {
  if (!sqlAvailable()) return ls.getCampaign(id);
  const db = await getDb();
  const rows = await db.select<CampaignRow[]>("SELECT * FROM campaigns WHERE id = $1", [id]);
  return rows[0] ? rowToCampaign(rows[0]) : undefined;
}

export async function createCampaign(name: string, system?: string): Promise<Campaign> {
  if (!sqlAvailable()) return ls.createCampaign(name, system);
  const now = Date.now();
  const c: Campaign = {
    id: newId(),
    name: name.trim() || "Untitled Campaign",
    system,
    createdAt: now,
    updatedAt: now,
    archived: false,
  };
  const db = await getDb();
  await db.execute(
    "INSERT INTO campaigns (id, name, system, created_at, updated_at, archived) VALUES ($1,$2,$3,$4,$5,0)",
    [c.id, c.name, c.system ?? null, c.createdAt, c.updatedAt]
  );
  ls.setActiveCampaignId(c.id);
  return c;
}

export async function renameCampaign(id: string, name: string): Promise<void> {
  if (!sqlAvailable()) return ls.renameCampaign(id, name);
  const n = name.trim();
  if (!n) return;
  const db = await getDb();
  await db.execute("UPDATE campaigns SET name = $1, updated_at = $2 WHERE id = $3", [
    n,
    Date.now(),
    id,
  ]);
}

export async function archiveCampaign(id: string, archived = true): Promise<void> {
  if (!sqlAvailable()) return ls.archiveCampaign(id, archived);
  const db = await getDb();
  await db.execute("UPDATE campaigns SET archived = $1, updated_at = $2 WHERE id = $3", [
    archived ? 1 : 0,
    Date.now(),
    id,
  ]);
  if (archived && ls.getActiveCampaignId() === id) ls.setActiveCampaignId(null);
}

// Active-campaign pointer — a per-device UI preference, kept in localStorage in both backends.
export const getActiveCampaignId = ls.getActiveCampaignId;
export const setActiveCampaignId = ls.setActiveCampaignId;
