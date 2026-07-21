// Per-campaign rule switches the Curator owns. Stored in localStorage alongside
// the desk and folders — lightweight table policy, no schema migration.
//
// These are LIVE budgets, not creation-time snapshots: every sheet in the vault
// is measured against the current numbers, so lowering a cap immediately flags
// the characters that no longer fit.

import { SPEC_TOTAL } from "../game/wte";

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
};

const key = (campaignId: string) => `wte-campaign-rules:${campaignId}`;

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
  };
}

/** The caps to hand validateSheet / specialtyRemaining for this campaign. */
export function sheetCaps(rules: CampaignRules): { specTotal: number; attrTotal?: number } {
  return { specTotal: rules.specTotal, attrTotal: rules.attrBudget ? rules.attrBudgetPoints : undefined };
}

export function loadRules(campaignId: string): CampaignRules {
  try {
    return parseRules(JSON.parse(localStorage.getItem(key(campaignId)) || "{}"));
  } catch {
    return { ...DEFAULT_RULES };
  }
}

export function saveRules(campaignId: string, rules: CampaignRules): CampaignRules {
  const clean = parseRules(rules);
  try {
    localStorage.setItem(key(campaignId), JSON.stringify(clean));
  } catch {
    /* quota / unavailable — the rule simply stays off */
  }
  return clean;
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
