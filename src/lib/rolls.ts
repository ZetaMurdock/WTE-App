// Roll feed persisted to the SQLite `rolls` table (migration v2). Foundation for the
// Phase 6 VTT roll feed. Desktop-only; no-ops outside Tauri.
import { parseDiceTerms, diceTermsExpr, type RollResult } from "../game/wte";
import type { NetRollMode } from "../net/protocol";
import { getDb, sqlAvailable } from "./db";

export interface RollEntry {
  id: string;
  campaignId: string | null;
  characterId: string | null;
  formula: string;
  result: number;
  label: string;
  at: number;
  baseExpr?: string;
  actorName?: string;
  tokenId?: string;
  requestId?: string;
  mode?: NetRollMode;
  detail?: unknown;
}

export interface RollLogMeta {
  /** Reuse the id already placed in the live feed/wire message. */
  id?: string;
  at?: number;
  baseExpr?: string;
  actorName?: string;
  tokenId?: string;
  requestId?: string;
  mode?: NetRollMode;
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

interface StoredRollMeta {
  version: 1;
  baseExpr?: string;
  actorName?: string;
  tokenId?: string;
  requestId?: string;
  mode?: NetRollMode;
}

export function createRollId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return "r-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
}

/** Normalize user-entered dice into the expression used for request
 * correlation (for example ` d20 + 03 ` -> `1d20+3`). */
export function canonicalRollExpr(raw: string): string | null {
  const parsed = parseDiceTerms(raw);
  return parsed ? diceTermsExpr(parsed) : null;
}

export interface ValidatedCompletedRoll {
  id: string;
  label: string;
  formula: string;
  baseExpr: string;
  result: number;
  mode: NetRollMode;
  detail: RollResult["detail"];
}

/**
 * Validate a completed roll received from the network and rebuild its display
 * formula from the actual dice detail. This is deliberately stricter than the
 * local dice parser: a peer cannot claim a result that does not match the
 * supplied die totals, modifier, posture, and canonical base expression.
 */
export function validateCompletedRoll(value: unknown): ValidatedCompletedRoll | null {
  const roll = asRecord(value);
  if (!roll) return null;
  const id = typeof roll.id === "string" ? roll.id.trim() : "";
  const label = typeof roll.label === "string" ? roll.label.trim() : "";
  const rawBaseExpr = typeof roll.baseExpr === "string" ? roll.baseExpr : "";
  // Length-gate BEFORE parsing: the expression came off the network.
  if (rawBaseExpr.length > 64) return null;
  const baseExpr = canonicalRollExpr(rawBaseExpr);
  const mode = rollMode(roll.mode);
  const detail = asRecord(roll.detail);
  if (
    !id || id.length > 128 || label.length > 160 ||
    typeof roll.formula !== "string" || roll.formula.length > 240 ||
    !baseExpr || baseExpr !== rawBaseExpr || !mode || !detail
  ) return null;

  const parsed = parseDiceTerms(baseExpr);
  if (!parsed || !Number.isFinite(parsed.mod)) return null;
  const expectedRollCount = mode === "normal" ? 1 : mode.startsWith("double-") ? 3 : 2;
  const totals = Array.isArray(detail.rolls) ? detail.rolls : null;
  if (
    detail.die !== parsed.terms[0].sides || detail.modifier !== parsed.mod ||
    detail.label !== label || detail.mode !== mode ||
    !totals || totals.length !== expectedRollCount
  ) return null;
  // The pool's reachable range: every die at 1, every die at its maximum.
  const low = parsed.terms.reduce((sum, term) => sum + term.count, 0);
  const high = parsed.terms.reduce((sum, term) => sum + term.count * term.sides, 0);
  if (!totals.every((total) => Number.isInteger(total) && total >= low && total <= high)) return null;
  const selected = mode.endsWith("adv") ? Math.max(...totals) : mode.endsWith("dis") ? Math.min(...totals) : totals[0];
  const result = roll.result;
  if (
    detail.roll !== selected || typeof result !== "number" || !Number.isInteger(result) ||
    result !== selected + parsed.mod
  ) return null;

  const posture = mode === "normal"
    ? ""
    : ` · ${mode.startsWith("double-") ? "Double " : ""}${mode.endsWith("adv") ? "Advantage" : "Disadvantage"} (${totals.join("/")})`;
  return {
    id,
    label,
    formula: `${baseExpr}${posture}`,
    baseExpr,
    result,
    mode,
    detail: {
      die: parsed.terms[0].sides,
      roll: selected,
      modifier: parsed.mod,
      label,
      mode,
      rolls: [...totals],
    },
  };
}

export async function logRoll(
  campaignId: string | null,
  characterId: string | null,
  roll: RollResult,
  meta: RollLogMeta = {}
): Promise<void> {
  if (!sqlAvailable()) return;
  const id = meta.id || createRollId();
  const at = Number.isFinite(meta.at) ? Number(meta.at) : Date.now();
  const storedMeta: StoredRollMeta = {
    version: 1,
    baseExpr: meta.baseExpr,
    actorName: meta.actorName,
    tokenId: meta.tokenId,
    requestId: meta.requestId,
    mode: meta.mode ?? roll.detail.mode,
  };
  // Keep the legacy label/die fields at the root so older builds still render
  // the row; namespaced metadata is additive and safe for them to ignore.
  const detail = JSON.stringify({ ...roll.detail, _wte: storedMeta });
  const db = await getDb();
  await db.execute(
    "INSERT OR IGNORE INTO rolls (id, campaign_id, character_id, formula, result, detail, at) VALUES ($1,$2,$3,$4,$5,$6,$7)",
    [id, campaignId, characterId, roll.formula, roll.result, detail, at]
  );
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function rollMode(value: unknown): NetRollMode | undefined {
  return value === "normal" || value === "adv" || value === "dis" || value === "double-adv" || value === "double-dis" ? value : undefined;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
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
    let detail: unknown;
    let meta: Record<string, unknown> | null = null;
    try {
      detail = r.detail ? JSON.parse(r.detail) : undefined;
      const parsed = asRecord(detail);
      label = optionalString(parsed?.label) ?? "";
      meta = asRecord(parsed?._wte);
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
      baseExpr: optionalString(meta?.baseExpr),
      actorName: optionalString(meta?.actorName),
      tokenId: optionalString(meta?.tokenId),
      requestId: optionalString(meta?.requestId),
      mode: rollMode(meta?.mode),
      detail,
    };
  });
}
