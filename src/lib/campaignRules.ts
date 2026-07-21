// Per-campaign rule switches the Curator owns. Stored in localStorage alongside
// the desk and folders — lightweight table policy, no schema migration.

export interface CampaignRules {
  /** Cap the SUM of a character's attributes at creation. Off by default:
   *  attributes are rolled, so the budget only matters at tables that let
   *  players type their own — and that is the Curator's call, not the app's. */
  attrBudget: boolean;
  /** The cap itself. Seven d20s average 73.5, so 70 is a slightly lean roll. */
  attrBudgetPoints: number;
}

/** Seven d20s average 73.5 — the default budget sits just under an average roll. */
export const ATTR_BUDGET_DEFAULT = 70;
export const ATTR_BUDGET_MIN = 7;
export const ATTR_BUDGET_MAX = 140;

export const DEFAULT_RULES: CampaignRules = { attrBudget: false, attrBudgetPoints: ATTR_BUDGET_DEFAULT };

const key = (campaignId: string) => `wte-campaign-rules:${campaignId}`;

/** Normalise anything read off disk — an older or hand-edited blob still boots. */
export function parseRules(raw: unknown): CampaignRules {
  const o = (raw && typeof raw === "object" ? raw : {}) as Partial<CampaignRules>;
  const pts = Number(o.attrBudgetPoints);
  return {
    attrBudget: o.attrBudget === true,
    attrBudgetPoints: Number.isFinite(pts)
      ? Math.max(ATTR_BUDGET_MIN, Math.min(ATTR_BUDGET_MAX, Math.round(pts)))
      : ATTR_BUDGET_DEFAULT,
  };
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
