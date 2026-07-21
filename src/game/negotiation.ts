// The Negotiation Engine — diplomacy resolved with the same chassis as the
// Pressure Engine, aimed at a person instead of a situation. A high-profile
// client has a RESISTANCE number; each exchange the Inquisitor picks the skills
// they are actually leaning on, rolls them, and the outcome band pushes that
// number down (warming) or up (losing the room).
//
// Two things make it diplomacy rather than "roll Charisma":
//  • INFLUENCE is the social Attack Power — it adds straight to the AAV, so the
//    derived stat that had no combat job finally carries a scene. Process-soul
//    characters (Influence 0) genuinely cannot push here.
//  • EMINENCE gates the room. A client with a standing requirement gives a
//    liability a real penalty before a die is rolled.
import { peBand, type PeBand } from "./wte";

export const NEGOTIATION_DEFAULT = 50;
export const NEGOTIATION_MAX = 150;

export interface AccordState {
  label: string;
  key: "accord" | "receptive" | "guarded" | "resistant" | "sealed";
}

/** Where the room stands, from the client's remaining Resistance. */
export function accordState(resistance: number): AccordState {
  if (resistance <= 0) return { label: "ACCORD", key: "accord" };
  if (resistance <= 20) return { label: "RECEPTIVE", key: "receptive" };
  if (resistance <= 50) return { label: "GUARDED", key: "guarded" };
  if (resistance < NEGOTIATION_MAX) return { label: "RESISTANT", key: "resistant" };
  return { label: "SEALED", key: "sealed" };
}

/** How far short of the client's standing requirement the Inquisitor is
 *  (0 when they clear it). Eminence runs −20 … +20. */
export function eminenceGap(eminence: number, required: number): number {
  return Math.max(0, required - eminence);
}

/** Final AAV for an exchange: the averaged skill totals, the multi-skill
 *  cohesion bonus (3 → +1, 4 → +2), plus Influence, minus any standing gap. */
export function negotiationAav(
  rowTotals: number[],
  influenceMod: number,
  gap: number
): { aav: number; cBonus: number } {
  if (rowTotals.length === 0) return { aav: 0, cBonus: 0 };
  const cBonus = rowTotals.length >= 4 ? 2 : rowTotals.length === 3 ? 1 : 0;
  const avg = Math.round(rowTotals.reduce((a, b) => a + b, 0) / rowTotals.length);
  return { aav: avg + cBonus + influenceMod - gap, cBonus };
}

/** Resolve an exchange: AAV vs Resistance lands in the shared outcome bands.
 *  A NEGATIVE band change warms the client (Resistance falls toward Accord). */
export function negotiationOutcome(aav: number, resistance: number): { diff: number; band: PeBand } {
  const diff = aav - resistance;
  return { diff, band: peBand(diff) };
}

/** Apply a band to the track, clamped to the playable range. */
export function applyAccord(resistance: number, change: number): number {
  return Math.max(0, Math.min(NEGOTIATION_MAX, resistance + change));
}
