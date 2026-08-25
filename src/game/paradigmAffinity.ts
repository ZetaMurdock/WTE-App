// Paradigm Affinity — the Favored dice a doctrine adds to Roll Axis rolls.
//
// Each Paradigm trains two Attributes and two Specialties beyond ordinary
// reliability (the Paradigm pages' "Affinity" sections, 2026-08). When one of
// those statistics is the source actually governing a Roll Axis resolution,
// the roll gains bonus dice scaled by Designation Rank: +1d5 per tier for a
// Favored Attribute, +1d10 per tier for a Favored Specialty.
//
// CONVERGENCE is the paradigm at its purest: when a Roll Path's attribute AND
// specialty are both Favored (Science's Wisdom + Mental Fortitude on Capacity,
// Warfare's Strength + Weapon Mastery on Power), BOTH pools apply to that roll
// regardless of which source the player picked — "when both legitimately
// govern", per every page's wording.
//
// Remnant individualizes half of its Affinity: Dexterity and Adaptation are
// fixed, and the player chooses one additional Attribute and one additional
// Specialty at creation ("Field Affinity Selection"). The Quick Hack cipher's
// Field Reconfiguration swaps those chosen halves mid-scene, which is why the
// choice is data on the sheet rather than something baked at creation.
//
// This module is pure math over the Paradigm record — the favored lists live on
// the Paradigm itself (baked in wte.ts, overridable by campaign paradigm
// pages), so a table can retune a doctrine without touching code.
import { getParadigm, type AttrKey, type SpecKey } from "./wte";
import type { RollAxisPath } from "./rollAxis";

/** The die each pool rolls, straight from the pages' rank table. */
export const AFFINITY_ATTR_DIE = 5;
export const AFFINITY_SPEC_DIE = 10;

export interface AffinityContext {
  paradigmId?: string;
  /** Designation Rank, 0–9. Unranked characters use the 1–2 bracket. */
  rank: number;
  /** Remnant's chosen additional favorites ("Field Affinity Selection"). */
  extraAttr?: AttrKey;
  extraSpec?: SpecKey;
}

export interface AffinityDice {
  /** +Nd5 — the Favored Attribute pool. */
  d5?: number;
  /** +Nd10 — the Favored Specialty pool. */
  d10?: number;
  /** Both pools applied because the path's attribute AND specialty are Favored. */
  convergence: boolean;
}

/** Rank bracket → dice per pool: 1–2 → 1, 3–5 → 2, 6–8 → 3, 9 → 4. */
export function affinityTier(rank: number): number {
  if (rank >= 9) return 4;
  if (rank >= 6) return 3;
  if (rank >= 3) return 2;
  return 1;
}

function favored(
  paradigmId: string | undefined,
  ctx: AffinityContext
): { attrs: Set<AttrKey>; specs: Set<SpecKey> } | null {
  const paradigm = getParadigm(paradigmId);
  if (!paradigm?.favoredAttrs?.length && !paradigm?.favoredSpecs?.length) return null;
  const attrs = new Set<AttrKey>(paradigm.favoredAttrs ?? []);
  const specs = new Set<SpecKey>(paradigm.favoredSpecs ?? []);
  // The individualized half only exists where the doctrine says so — a chosen
  // stat lingering on a sheet after a paradigm change must not leak Affinity.
  if (paradigm.favoredChoice) {
    if (ctx.extraAttr) attrs.add(ctx.extraAttr);
    if (ctx.extraSpec) specs.add(ctx.extraSpec);
  }
  return { attrs, specs };
}

/**
 * The Affinity dice one Roll Axis choice earns.
 *
 * `source` is which side the player is rolling. A non-convergent Favored stat
 * grants its pool only when it is the side actually rolled — Evolution's
 * Strength adds nothing to a Power roll made through Weapon Mastery, because
 * Strength does not govern that resolution.
 */
export function affinityFor(
  path: RollAxisPath,
  source: "attribute" | "specialty",
  ctx: AffinityContext
): AffinityDice | null {
  const pools = favored(ctx.paradigmId, ctx);
  if (!pools) return null;
  const attrFav = pools.attrs.has(path.attribute.key);
  const specFav = pools.specs.has(path.specialty.key);
  const tier = affinityTier(ctx.rank);
  if (attrFav && specFav) return { d5: tier, d10: tier, convergence: true };
  if (source === "attribute" && attrFav) return { d5: tier, convergence: false };
  if (source === "specialty" && specFav) return { d10: tier, convergence: false };
  return null;
}

/** "+2d5 +2d10" — the dice as a chip/formula fragment. */
export function affinityLabel(dice: AffinityDice): string {
  const parts: string[] = [];
  if (dice.d5) parts.push(`+${dice.d5}d${AFFINITY_ATTR_DIE}`);
  if (dice.d10) parts.push(`+${dice.d10}d${AFFINITY_SPEC_DIE}`);
  return parts.join(" ");
}

/** The dice expression tail appended to a Roll Axis expr ("+2d5+2d10"). */
export function affinityExpr(dice: AffinityDice): string {
  let expr = "";
  if (dice.d5) expr += `+${dice.d5}d${AFFINITY_ATTR_DIE}`;
  if (dice.d10) expr += `+${dice.d10}d${AFFINITY_SPEC_DIE}`;
  return expr;
}
