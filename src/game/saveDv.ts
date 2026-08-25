// Attacker-keyed Save DVs — one formula instead of a printed table.
//
// The Genus and Cipher pages print fixed DVs (mostly 10–20) written before the
// Roll Axis modifier pipeline existed. A fixed number cannot track nine Ranks
// of attacker growth: a trained specialist's MINIMUM save die at Rank 0 already
// clears every printed value, while the Null Genus outliers (60/65) are
// unreachable for anyone else. The DV is therefore keyed to the ability's
// wielder:
//
//     Save DV = SAVE_DV_BASE + attacker's check modifier on the paired path
//
// Parity of modifiers is exactly 50% for a specialist-route defender; every ±2
// of modifier difference swings the odds ≈ ±5%. Because the modifier already
// carries Rank (through derived stats), equipment, size, morality and Codex
// formula overrides, the DV self-scales through every layer with no table.
//
// PAIRING. The ability's own prose decides which check powers it: when the
// effect names a check the wielder makes ("Physical Check — Power … the target
// makes a Physical Save — Evasion"), that check keys the DV. When it names
// none, the pages' own convention supplies the default — Mental Check —
// Capacity is what the corpus consistently rolls "against a Dice Value", the
// casting check of the system.
import type { AbilityAction } from "./abilityActions";
import { ROLL_AXIS_PATHS, rollAxisChoices, type RollAxisPath, type RollAxisStats } from "./rollAxis";

export const SAVE_DV_BASE = 21;
/** The casting check: what an ability is powered by when its prose names none. */
export const DEFAULT_SAVE_CHECK_PATH: RollAxisPath["id"] = "capacity";

export interface SaveDv {
  dv: number;
  base: number;
  /** The attacker check path keying this DV. */
  checkPathId: RollAxisPath["id"];
  checkPathName: string;
  /** The attacker's strongest legal route on that path. */
  checkMod: number;
  /** Which source supplies `checkMod` — "Weapon Mastery", "Strength", … */
  sourceLabel: string;
  /** True when the paired check came from the ability's own prose. */
  fromAbility: boolean;
  /** The page's printed fixed DV, kept as provenance (never used in `dv`). */
  printed?: number;
}

/** The check path that powers an ability: the first self check its prose names,
 * else the Capacity casting check. */
export function pairedCheckPath(actions: readonly AbilityAction[]): { id: RollAxisPath["id"]; fromAbility: boolean } {
  for (const action of actions) {
    if (action.kind !== "self" || !action.rollAxis) continue;
    if (action.rollAxis.direction !== "check") continue;
    return { id: action.rollAxis.path, fromAbility: true };
  }
  return { id: DEFAULT_SAVE_CHECK_PATH, fromAbility: false };
}

/**
 * The attacker-keyed DV for one parsed target-side save.
 *
 * `actions` is the ability's full parsed action list — the save's siblings are
 * what name the paired check. The attacker's modifier is the stronger of the
 * path's two legal routes, resolved through rollAxisChoices so an active Codex
 * formula shapes the DV exactly as it shapes the roll. Affinity dice do not
 * enter: they are dice on the attacker's own rolls, not a static modifier.
 */
export function abilitySaveDv(
  save: AbilityAction,
  actions: readonly AbilityAction[],
  stats: RollAxisStats
): SaveDv | null {
  if (save.kind !== "save") return null;
  const paired = pairedCheckPath(actions);
  const path = ROLL_AXIS_PATHS.find((candidate) => candidate.id === paired.id);
  if (!path || !path.directions.includes("check")) return null;
  const noAffinity: RollAxisStats = { attr: stats.attr, spec: stats.spec, derived: stats.derived };
  const best = rollAxisChoices(path, "check", noAffinity).reduce((a, b) => (b.totalMod > a.totalMod ? b : a));
  return {
    dv: SAVE_DV_BASE + best.totalMod,
    base: SAVE_DV_BASE,
    checkPathId: path.id,
    checkPathName: path.name,
    checkMod: best.totalMod,
    sourceLabel: best.sourceLabel,
    fromAbility: paired.fromAbility,
    printed: save.dc,
  };
}

/** A save action's label with any printed "· DV 13"/"· DC 18" tail removed, so
 * the computed DV can stand in its place without showing two numbers. */
export function savePlainLabel(save: AbilityAction): string {
  return save.label.replace(/\s*·\s*D[CV]\b.*$/i, "");
}

/** "DV 74 = 21 + Capacity check +53 (Mental Fortitude)" — audit string for
 * titles and roll-feed provenance. */
export function saveDvBreakdown(keyed: SaveDv): string {
  const sign = keyed.checkMod >= 0 ? `+${keyed.checkMod}` : `${keyed.checkMod}`;
  const printed = keyed.printed != null ? ` · printed DV ${keyed.printed}` : "";
  return `DV ${keyed.dv} = ${keyed.base} + ${keyed.checkPathName} check ${sign} (${keyed.sourceLabel})${printed}`;
}
