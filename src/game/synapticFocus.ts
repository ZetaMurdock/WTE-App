// Synaptic Focus — the shared advancement currency for Genus and Incepts.
//
// Every rank grants FOCUS_PER_RANK points, spent two ways:
//   • GENUS  — 1 point = +1 Focus on a specific ability, to a cap of 4. Focus IS
//     access: you know exactly the genus you have invested in, which replaces the
//     old flat genusSlots(5 + rank) allowance.
//   • INCEPT — a flat INCEPT_FOCUS_COST to unlock. Costing the same as taking one
//     genus from 1 to 4 is deliberate: an incept is a maxed genus you didn't take.
//
// Focus is per ABILITY, not per domain. Per-domain would be degenerate — five
// domains at 4 each is 20 points, maxed by rank 6, and every character ends up
// identical. Per-ability puts 98 abilities in competition for ~30 points.
//
// Focus also settles genus-vs-genus: the higher Focus wins outright (a Reflect
// with less Focus than the Elemental it meets simply fails). Equal Focus goes to
// a contested Control roll scaled by rank.
import { rankMult, rollSpecialty, type RollMode } from "./wte";

/** Points granted per rank. Rank 0 is included, so a fresh character starts with
 *  one spend to make — 3 points, i.e. one genus at Focus 3 or a single incept. */
export const FOCUS_PER_RANK = 3;
/** A single genus ability tops out here; further points are wasted. */
export const GENUS_FOCUS_MAX = 4;
/** Flat cost to unlock one incept — equal to raising a genus from 1 to 4. */
export const INCEPT_FOCUS_COST = 3;

/** What a character has bought. Genus maps ability name → Focus (1…4). */
export interface FocusSpend {
  genus: Record<string, number>;
  incepts: string[];
}

export function emptySpend(): FocusSpend {
  return { genus: {}, incepts: [] };
}

/** Normalise anything read off a saved sheet — out-of-range Focus is clamped and
 *  zero/negative entries are dropped, so a hand-edited sheet still loads. */
export function parseSpend(raw: unknown): FocusSpend {
  const o = (raw && typeof raw === "object" ? raw : {}) as Partial<FocusSpend>;
  const genus: Record<string, number> = {};
  if (o.genus && typeof o.genus === "object") {
    for (const [name, v] of Object.entries(o.genus)) {
      const n = Math.round(Number(v));
      if (Number.isFinite(n) && n > 0) genus[name] = Math.min(GENUS_FOCUS_MAX, n);
    }
  }
  const incepts = Array.isArray(o.incepts) ? [...new Set(o.incepts.filter((x) => typeof x === "string"))] : [];
  return { genus, incepts };
}

/** Total Focus earned by this rank. */
export function focusBudget(rank: number): number {
  const r = Math.max(0, Math.trunc(rank) || 0);
  return (r + 1) * FOCUS_PER_RANK;
}

export function focusSpent(s: FocusSpend): number {
  const onGenus = Object.values(s.genus).reduce((t, v) => t + v, 0);
  return onGenus + s.incepts.length * INCEPT_FOCUS_COST;
}

export function focusRemaining(rank: number, s: FocusSpend): number {
  return focusBudget(rank) - focusSpent(s);
}

/** Focus invested in one ability (0 when unknown). */
export function genusFocus(s: FocusSpend, name: string): number {
  return s.genus[name] || 0;
}

/** The genus a character actually knows — Focus is access, so this replaces the
 *  old slot allowance and is what feeds usableGenus()/the VTT action list. */
export function knownGenus(s: FocusSpend): string[] {
  return Object.keys(s.genus).filter((n) => s.genus[n] > 0);
}

/** Raise one genus by a point. Returns the SAME object when the move is illegal
 *  (at the cap, or not enough Focus left) so callers can detect a no-op. */
export function raiseGenus(s: FocusSpend, name: string, rank: number): FocusSpend {
  const cur = genusFocus(s, name);
  if (cur >= GENUS_FOCUS_MAX) return s;
  if (focusRemaining(rank, s) < 1) return s;
  return { ...s, genus: { ...s.genus, [name]: cur + 1 } };
}

/** Drop a point back; at Focus 1 this forgets the ability entirely. */
export function lowerGenus(s: FocusSpend, name: string): FocusSpend {
  const cur = genusFocus(s, name);
  if (cur <= 0) return s;
  const genus = { ...s.genus };
  if (cur === 1) delete genus[name];
  else genus[name] = cur - 1;
  return { ...s, genus };
}

export function canUnlockIncept(s: FocusSpend, name: string, rank: number): boolean {
  return !s.incepts.includes(name) && focusRemaining(rank, s) >= INCEPT_FOCUS_COST;
}

export function unlockIncept(s: FocusSpend, name: string, rank: number): FocusSpend {
  if (!canUnlockIncept(s, name, rank)) return s;
  return { ...s, incepts: [...s.incepts, name] };
}

export function relockIncept(s: FocusSpend, name: string): FocusSpend {
  if (!s.incepts.includes(name)) return s;
  return { ...s, incepts: s.incepts.filter((n) => n !== name) };
}

/** Characters built before Focus existed carry a flat genusLoadout. Seed each
 *  known ability at Focus 1, in order, until the budget runs out — nothing is
 *  silently upgraded, and an over-long legacy loadout is truncated rather than
 *  putting the sheet over budget. */
export function migrateLoadout(loadout: string[], rank: number): FocusSpend {
  const s = emptySpend();
  const budget = focusBudget(rank);
  for (const name of loadout) {
    if (!name || s.genus[name]) continue;
    if (focusSpent(s) + 1 > budget) break;
    s.genus[name] = 1;
  }
  return s;
}

// ── Genus vs Genus ───────────────────────────────────────────────────────────

export interface ContestSide {
  label: string;
  /** Focus invested in the ability being used. */
  focus: number;
  /** Control specialty points, for the tie-break roll. */
  control: number;
  rank: number;
}

export interface ContestResult {
  /** "a" = the acting ability wins (e.g. Reflect lands); "b" = it is overpowered. */
  winner: "a" | "b";
  /** True when Focus alone settled it and no dice were needed. */
  byFocus: boolean;
  aTotal?: number;
  bTotal?: number;
  note: string;
}

/** Who wins on already-scaled Control totals. A dead tie favours the DEFENDER —
 *  an established effect holds unless something beats it outright. */
export function contestByRoll(aTotal: number, bTotal: number): "a" | "b" {
  return aTotal > bTotal ? "a" : "b";
}

/** Scaled Control total for a contest side: the standard d40 Control roll,
 *  multiplied by the roller's rank multiplier. */
export function contestRoll(side: ContestSide, mode: RollMode = "normal"): number {
  const r = rollSpecialty("Control", side.control, mode);
  return Math.round(r.result * rankMult(side.rank));
}

/** Resolve one genus used against another. Higher Synaptic Focus wins outright;
 *  equal Focus goes to contested Control × rank multiplier. */
export function focusContest(a: ContestSide, b: ContestSide, mode: RollMode = "normal"): ContestResult {
  if (a.focus !== b.focus) {
    const winner = a.focus > b.focus ? "a" : "b";
    return {
      winner,
      byFocus: true,
      note:
        winner === "a"
          ? `${a.label} (Focus ${a.focus}) overpowers ${b.label} (Focus ${b.focus}).`
          : `${b.label} (Focus ${b.focus}) is too strongly focused — ${a.label} (Focus ${a.focus}) fails.`,
    };
  }
  const aTotal = contestRoll(a, mode);
  const bTotal = contestRoll(b, mode);
  const winner = contestByRoll(aTotal, bTotal);
  return {
    winner,
    byFocus: false,
    aTotal,
    bTotal,
    note:
      `Focus ${a.focus} both ways — contested Control: ` +
      `${a.label} ${aTotal} vs ${b.label} ${bTotal}. ` +
      (aTotal === bTotal ? `Tied, so ${b.label} holds.` : `${winner === "a" ? a.label : b.label} wins.`),
  };
}
