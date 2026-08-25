// Per-campaign rule switches the Curator owns. Stored in localStorage alongside
// the desk and folders — lightweight table policy, no schema migration.
//
// These are LIVE budgets, not creation-time snapshots: every sheet in the vault
// is measured against the current numbers, so lowering a cap immediately flags
// the characters that no longer fit.

import { SPEC_TOTAL } from "../game/wte";
import { isRecord, readJson, removeJson, writeJson } from "./localJson";

export interface CampaignRules {
  /** Cap the SUM of a character's attributes. Off by default: attributes are
   *  rolled, so the budget only matters at tables that let players type their
   *  own — and that is the Curator's call, not the app's. */
  attrBudget: boolean;
  /** The cap itself. Seven d20s average 73.5, so 70 is a slightly lean roll. */
  attrBudgetPoints: number;
  /** Specialty points per character. Always enforced; the published rules say
   *  200, but the Curator may run a leaner or richer table. */
  specTotal: number;
  /** Pay attribute compensation on the four CORE pools as a SHARE of the pool
   *  rather than a flat number. Off by default: it is a real buff to shaped
   *  builds, and the flat version is what every existing sheet was built under. */
  poolCompensation: boolean;
  /** Paradigm Affinity (2026-08): Favored-stat dice on Roll Axis rolls. ON by
   *  default — it is a published rule, not a house rule; the toggle exists for
   *  tables that want the flatter pre-Affinity math. */
  paradigmAffinity: boolean;
}

/** Seven d20s average 73.5 — the default budget sits just under an average roll. */
export const ATTR_BUDGET_DEFAULT = 70;
export const ATTR_BUDGET_MIN = 7;
export const ATTR_BUDGET_MAX = 140;
/** A single specialty caps at 75, so ten of them is the useful ceiling. */
export const SPEC_TOTAL_MIN = 10;
export const SPEC_TOTAL_MAX = 750;

export const DEFAULT_RULES: CampaignRules = {
  attrBudget: false,
  attrBudgetPoints: ATTR_BUDGET_DEFAULT,
  specTotal: SPEC_TOTAL,
  poolCompensation: false,
  paradigmAffinity: true,
};

const key = (campaignId: string) => `wte-campaign-rules:${campaignId}`;

// A joined table may install the Curator's authoritative rules in memory. Kept
// as a tiny injection seam rather than importing netplay/Codex here, so this
// low-level rules module remains usable by tests and offline tools.
let roomRules: { campaignId: string; rules: CampaignRules } | null = null;

export function installRoomCampaignRules(campaignId: string, rules: CampaignRules): void {
  roomRules = campaignId ? { campaignId, rules: parseRules(rules) } : null;
}

export function clearRoomCampaignRules(): void {
  roomRules = null;
}

const clamp = (v: unknown, lo: number, hi: number, fallback: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, Math.round(n))) : fallback;
};

/** Normalise anything read off disk — an older or hand-edited blob still boots. */
export function parseRules(raw: unknown): CampaignRules {
  const o = (raw && typeof raw === "object" ? raw : {}) as Partial<CampaignRules>;
  return {
    attrBudget: o.attrBudget === true,
    attrBudgetPoints: clamp(o.attrBudgetPoints, ATTR_BUDGET_MIN, ATTR_BUDGET_MAX, ATTR_BUDGET_DEFAULT),
    specTotal: clamp(o.specTotal, SPEC_TOTAL_MIN, SPEC_TOTAL_MAX, SPEC_TOTAL),
    poolCompensation: o.poolCompensation === true,
    // Published rule: absent (older blobs, older peers) means ON.
    paradigmAffinity: o.paradigmAffinity !== false,
  };
}

/** The rules computeDerived needs, for a character in this campaign. Null id
 *  (an unfiled or shared character) simply gets the published defaults. */
export function derivedRules(campaignId: string | null | undefined): { poolCompensation: boolean } {
  return { poolCompensation: campaignId ? loadRules(campaignId).poolCompensation : false };
}

/** The caps to hand validateSheet / specialtyRemaining for this campaign. */
export function sheetCaps(rules: CampaignRules): { specTotal: number; attrTotal?: number } {
  return { specTotal: rules.specTotal, attrTotal: rules.attrBudget ? rules.attrBudgetPoints : undefined };
}

// These are NOT preferences: derivedRules() feeds computeDerived, so a lost value
// silently changes every character's derived pools, and sheetCaps() feeds
// validateSheet, so characters that were legal become over budget. Falling back to
// published defaults without saying so is the worst option, hence the guard.
export function loadLocalRules(campaignId: string): CampaignRules {
  const r = readJson<unknown>(key(campaignId), {}, { validate: isRecord, label: "campaign rules" });
  return parseRules(r.value);
}

export function loadRules(campaignId: string): CampaignRules {
  return roomRules?.campaignId === campaignId ? { ...roomRules.rules } : loadLocalRules(campaignId);
}

export function saveRules(campaignId: string, rules: CampaignRules): CampaignRules {
  const clean = parseRules(rules);
  writeJson(key(campaignId), clean, { label: "campaign rules" });
  if (typeof window !== "undefined") window.dispatchEvent(new Event("wte-pages-changed"));
  return clean;
}

/** Remove the device-local policy owned by one campaign. This is intentionally
 * separate from the in-memory room authority: package rollback must undo the
 * destination campaign without disturbing whichever live table is connected. */
export function deleteLocalRules(campaignId: string): void {
  const result = removeJson(key(campaignId));
  if (!result.ok) throw new Error(result.error || "campaign rules could not be removed");
}

/** How the budget reads on the creator: spent, cap, and whether it blocks saving. */
export function attrBudgetState(total: number, rules: CampaignRules): {
  enforced: boolean;
  spent: number;
  cap: number;
  remaining: number;
  over: boolean;
} {
  const cap = rules.attrBudgetPoints;
  return {
    enforced: rules.attrBudget,
    spent: total,
    cap,
    remaining: cap - total,
    over: rules.attrBudget && total > cap,
  };
}
