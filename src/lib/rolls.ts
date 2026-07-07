// Roll feed persisted to the SQLite `rolls` table (migration v2). Foundation for the
// Phase 6 VTT roll feed. Desktop-only; no-ops outside Tauri.
import type { RollResult } from "../game/wte";
import { getDb, sqlAvailable } from "./db";

export interface RollEntry {
  id: string;
  campaignId: string | null;
  characterId: string | null;
  formula: string;
  result: number;
  label: string;
  at: number;
}

interface RollRow {
  id: string;
  campaign_id: string | null;
  character_id: string | null;
  formula: string;
  result: number;
  detail: string | null;
  at: number;
}

function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return "r-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
}

export async function logRoll(
  campaignId: string | null,
  characterId: string | null,
  roll: RollResult
): Promise<void> {
  if (!sqlAvailable()) return;
  const db = await getDb();
  await db.execute(
    "INSERT INTO rolls (id, campaign_id, character_id, formula, result, detail, at) VALUES ($1,$2,$3,$4,$5,$6,$7)",
    [newId(), campaignId, characterId, roll.formula, roll.result, JSON.stringify(roll.detail), Date.now()]
  );
}

export async function recentRolls(campaignId: string, limit = 12): Promise<RollEntry[]> {
  if (!sqlAvailable()) return [];
  const db = await getDb();
  const rows = await db.select<RollRow[]>(
    "SELECT * FROM rolls WHERE campaign_id = $1 ORDER BY at DESC LIMIT $2",
    [campaignId, limit]
  );
  return rows.map((r) => {
    let label = "";
    try {
      label = r.detail ? (JSON.parse(r.detail).label as string) || "" : "";
    } catch {
      /* ignore */
    }
    return {
      id: r.id,
      campaignId: r.campaign_id,
      characterId: r.character_id,
      formula: r.formula,
      result: r.result,
      label,
      at: r.at,
    };
  });
}
