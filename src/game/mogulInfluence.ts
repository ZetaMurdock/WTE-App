// Mogul Influence — how deep inside Regency jurisdiction a location sits, and
// what stops working when you leave it.
//
// This is the exploration axis. It is NOT the sector alignment code (On Sequence /
// Detached / Rogue / Excursioned), which describes a sector's political posture —
// influence describes YOUR distance from ECP coverage at a given coordinate. A
// Rogue sector can still sit inside the geofence; a Core-aligned world can have a
// hole in coverage.
//
// Note on vocabulary: the published diagram says "EAC Connection Lost" once while
// the prose and the Sectors page say ECP throughout (ECP-certified Voyager
// Credentials, the ECP network, ECP updates). ECP is treated as canonical here.

export type InfluenceBand = "core" | "marginal" | "void";

export interface InfluenceLevel {
  band: InfluenceBand;
  /** Zone name as published. */
  zone: string;
  /** Territory name as published. */
  territory: string;
  /** The parenthetical character of the place. */
  character: string;
  /** How a beacon reads it out: "Mogul Influence High". */
  influence: string;
  /** Hazard banner. */
  hazard: string;
  /** 0 = safest. Ordered so comparisons work. */
  severity: 0 | 1 | 2;
  /** True once the ECP can no longer reach you. */
  beyondGeofence: boolean;
}

export const INFLUENCE_LEVELS: InfluenceLevel[] = [
  {
    band: "core",
    zone: "Core Worlds",
    territory: "Mogul Core Administration",
    character: "Absolute Order",
    influence: "Absolute",
    hazard: "Safe area",
    severity: 0,
    beyondGeofence: false,
  },
  {
    band: "marginal",
    zone: "Marginal Zone",
    territory: "Mogul-Influenced Dominions",
    character: "High-Pressure Border",
    influence: "High",
    hazard: "Warning zone",
    severity: 1,
    beyondGeofence: false,
  },
  {
    band: "void",
    zone: "Sovereign / Void",
    territory: "Unmonitored / Lawless Space",
    character: "ECP Connection Lost",
    influence: "None",
    hazard: "Extreme hazard",
    severity: 2,
    beyondGeofence: true,
  },
];

export function influenceOf(band: InfluenceBand | string | undefined): InfluenceLevel {
  return INFLUENCE_LEVELS.find((l) => l.band === band) ?? INFLUENCE_LEVELS[1];
}

/** What stops working past the Geofenced Horizon. Every one of these is a Curator
 *  prompt, not an automatic penalty — the rules say the Regency has no
 *  jurisdiction, they do not say roll a d20. */
export interface VoidConsequence {
  name: string;
  detail: string;
}
export const VOID_CONSEQUENCES: VoidConsequence[] = [
  {
    name: "Operator blackout",
    detail:
      "The connection to your Operator's neural Bio-Tank flickers and fails, leaving you completely blind in the dark.",
  },
  {
    name: "Cipher destabilisation",
    detail:
      "Paradigm Ciphers no longer receive systemic power stabilisation, risking severe backlashes.",
  },
  {
    name: "Foreign dominion",
    detail:
      "The cold, unfeeling superpowers of the outer rims — the Nigraldi Swarms, the entropic Tribulas Celestials — hold absolute dominion here.",
  },
  {
    name: "High treason",
    detail:
      "Voyager paths must stay inside registered Mogul-Influenced space-lanes. Deviating without a signed, notarised execution warrant from your Coordinator is an immediate act of high treason.",
  },
];

/** Consequences in force at a given band — none inside the geofence. */
export function consequencesAt(band: InfluenceBand | string | undefined): VoidConsequence[] {
  return influenceOf(band).beyondGeofence ? VOID_CONSEQUENCES : [];
}

/** A place the party has reached. The Curator sets these; nothing is derived from
 *  the sector, because coverage and politics are different axes. */
export interface LocationBeacon {
  planet: string;
  /** Sector id or free name — the Curator may be off the published 16. */
  sector: string;
  band: InfluenceBand;
  /** Optional Curator note appended to the readout. */
  note?: string;
}

/** The announcement line, in the published shape:
 *  "Inquisitors — new location reached · Planet: Ashfall · Sector: Boren · Mogul Influence: High" */
export function beaconLine(b: LocationBeacon): string {
  const lvl = influenceOf(b.band);
  const bits = [
    "Inquisitors — new location reached",
    `Planet: ${b.planet.trim() || "Unlogged"}`,
    `Sector: ${b.sector.trim() || "Uncharted"}`,
    `Mogul Influence: ${lvl.influence}`,
  ];
  if (b.note?.trim()) bits.push(b.note.trim());
  return bits.join(" · ");
}

/** The warning a Curator should read out when the party crosses the horizon.
 *  Empty inside the geofence. */
export function crossingWarning(band: InfluenceBand | string | undefined): string {
  const lvl = influenceOf(band);
  if (!lvl.beyondGeofence) return "";
  return (
    `You have crossed the Geofenced Horizon into ${lvl.territory}. ` +
    `The Regency has no jurisdiction here.`
  );
}

/** Did this move make things worse? Used to decide whether to shout about it. */
export function isEscalation(from: InfluenceBand | undefined, to: InfluenceBand): boolean {
  if (!from) return influenceOf(to).severity > 0;
  return influenceOf(to).severity > influenceOf(from).severity;
}
