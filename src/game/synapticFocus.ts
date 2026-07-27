// Synaptic Focus — the shared advancement currency for Genus and Incepts.
//
// Every rank grants FOCUS_PER_RANK points, spent two ways:
//   • GENUS  — 1 point = +1 Focus on a specific ability, to a cap of 4. Focus IS
//     access: you know exactly the genus you have invested in, which replaces the
//     old flat genusSlots(5 + rank) allowance.
//   • INCEPT — priced by Weight Class. Light and Medium cost INCEPT_FOCUS_COST,
//     the same as taking one genus from 1 to 4: an incept is a maxed genus you
//     didn't take. A HEAVY incept costs more still, because it also drags the
//     character's Wryde into the chaotic tier.
//
// Focus is per ABILITY, not per domain. Per-domain would be degenerate — five
// domains at 4 each is 20 points, maxed by rank 6, and every character ends up
// identical. Per-ability puts 98 abilities in competition for ~30 points.
//
// Focus also settles genus-vs-genus: the higher Focus wins outright (a Reflect
// with less Focus than the Elemental it meets simply fails). Equal Focus goes to
// a contested Control roll scaled by rank.
import { getIncept, rankMult, rollSpecialty, type RollMode, type RollResult } from "./wte";

/** Points granted per rank. Rank 0 is included, so a fresh character starts with
 *  one spend to make — 3 points, i.e. one genus at Focus 3 or a single incept. */
export const FOCUS_PER_RANK = 3;
/** A single genus ability tops out here; further points are wasted. */
export const GENUS_FOCUS_MAX = 4;
/** Baseline cost to unlock one incept — equal to raising a genus from 1 to 4. */
export const INCEPT_FOCUS_COST = 3;
/** Weight Class sets the price. Light and Medium hold the baseline; a Heavy
 *  incept costs 5 — MORE than maxing a genus outright — because it also drags
 *  the character's Wryde into the chaotic tier (see wrydeTier in wte.ts). */
export const INCEPT_COST_BY_WEIGHT: Record<string, number> = { Light: 3, Medium: 3, Heavy: 5 };
export function inceptCost(weight?: string): number {
  return INCEPT_COST_BY_WEIGHT[weight ?? ""] ?? INCEPT_FOCUS_COST;
}

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

/** What one unlocked incept costs this character. Weight lives in the incept
 *  data, not on the sheet, so a sheet can never desync from the rules — pass the
 *  species and it is looked up. Without one, everything bills at the baseline. */
export function costOfIncept(name: string, speciesId?: string): number {
  return inceptCost(getIncept(speciesId, name)?.weight);
}

export function focusSpent(s: FocusSpend, speciesId?: string): number {
  const onGenus = Object.values(s.genus).reduce((t, v) => t + v, 0);
  const onIncepts = s.incepts.reduce((t, n) => t + costOfIncept(n, speciesId), 0);
  return onGenus + onIncepts;
}

export function focusRemaining(rank: number, s: FocusSpend, speciesId?: string, bonus = 0): number {
  return focusBudgetWith(rank, bonus) - focusSpent(s, speciesId);
}

/** Total Focus a character has actually committed. This is the figure incepts
 *  read when they scale off "SF levels you possess" — e.g. SubDermin's Earth
 *  Mold, which extends its range for every two levels spent. */
export function totalFocusSpent(s: FocusSpend, speciesId?: string): number {
  return focusSpent(s, speciesId);
}

/** Hyomen's Talent Holder: "a 1D100 or 50 chance to obtain a extra SF point
 *  whenever you rank up" — a d100 landing on 50 or better grants one bonus
 *  point. Returns the points gained by a single rank-up (0 or 1).
 *  Pass a roll to make it testable; omit to roll. */
export const TALENT_HOLDER_DC = 50;
export function talentHolderBonus(roll?: number): number {
  const d100 = roll ?? 1 + Math.floor(Math.random() * 100);
  return d100 >= TALENT_HOLDER_DC ? 1 : 0;
}

/** SubDermin's Earth Mold: 15 ft base, and "for every two SF levels you
 *  possess: increase the effective range by half your Neuronal Capacity
 *  Modifier plus your Control Modifier". Reads TOTAL Focus spent, so incepts
 *  count toward it as much as genus does. */
export const EARTH_MOLD_BASE_FT = 15;
export function earthMoldRange(spent: number, ncMod: number, controlMod: number): number {
  const steps = Math.floor(Math.max(0, spent) / 2);
  const perStep = Math.floor(ncMod / 2) + controlMod;
  // The authored text INCREASES the range, so a character with underwater
  // modifiers keeps the 15 ft base rather than having it subtracted away. Clamp
  // the bonus, never the total.
  return EARTH_MOLD_BASE_FT + Math.max(0, steps * perStep);
}

/** Budget including any bonus points banked from Talent Holder rank-ups. */
export function focusBudgetWith(rank: number, bonusPoints = 0): number {
  return focusBudget(rank) + Math.max(0, Math.trunc(bonusPoints) || 0);
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
export function raiseGenus(s: FocusSpend, name: string, rank: number, speciesId?: string, bonus = 0): FocusSpend {
  const cur = genusFocus(s, name);
  if (cur >= GENUS_FOCUS_MAX) return s;
  if (focusRemaining(rank, s, speciesId, bonus) < 1) return s;
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

export function canUnlockIncept(s: FocusSpend, name: string, rank: number, speciesId?: string, bonus = 0): boolean {
  return !s.incepts.includes(name) && focusRemaining(rank, s, speciesId, bonus) >= costOfIncept(name, speciesId);
}

export function unlockIncept(s: FocusSpend, name: string, rank: number, speciesId?: string, bonus = 0): FocusSpend {
  if (!canUnlockIncept(s, name, rank, speciesId, bonus)) return s;
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
  /** Mirga's Identity Theft: while transformed you may use the Focus the target
   *  possesses in a Genus instead of your own ("if they have SF 4 for Reflect and
   *  you have SF 1 you can use the SF 4"). Set this to the borrowed value; since
   *  the incept says you MAY use it, the better of the two applies. */
  borrowedFocus?: number;
}

/** The Focus a side actually brings — its own, or a borrowed one if higher. */
export function effectiveFocus(side: ContestSide): number {
  return Math.max(side.focus, side.borrowedFocus ?? 0);
}

export interface ContestResult {
  /** "a" = the acting ability wins (e.g. Reflect lands); "b" = it is overpowered. */
  winner: "a" | "b";
  /** True when Focus alone settled it and no dice were needed. */
  byFocus: boolean;
  aTotal?: number;
  bTotal?: number;
  /** The underlying Control rolls, kept so a caller can log what was actually
   *  thrown instead of inventing dice detail around the scaled total. */
  aRoll?: RollResult;
  bRoll?: RollResult;
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
  return contestRollDetail(side, mode).total;
}

/** Same roll, but keeps the d40 that produced it. */
export function contestRollDetail(side: ContestSide, mode: RollMode = "normal"): { raw: RollResult; total: number } {
  const raw = rollSpecialty("Control", side.control, mode);
  return { raw, total: Math.round(raw.result * rankMult(side.rank)) };
}

/** Resolve one genus used against another. Higher Synaptic Focus wins outright;
 *  equal Focus goes to contested Control × rank multiplier. */
export function focusContest(a: ContestSide, b: ContestSide, mode: RollMode = "normal"): ContestResult {
  const af = effectiveFocus(a);
  const bf = effectiveFocus(b);
  if (af !== bf) {
    const winner = af > bf ? "a" : "b";
    return {
      winner,
      byFocus: true,
      note:
        winner === "a"
          ? `${a.label} (Focus ${af}) overpowers ${b.label} (Focus ${bf}).`
          : `${b.label} (Focus ${bf}) is too strongly focused — ${a.label} (Focus ${af}) fails.`,
    };
  }
  const aRolled = contestRollDetail(a, mode);
  const bRolled = contestRollDetail(b, mode);
  const aTotal = aRolled.total;
  const bTotal = bRolled.total;
  const winner = contestByRoll(aTotal, bTotal);
  return {
    winner,
    byFocus: false,
    aTotal,
    bTotal,
    aRoll: aRolled.raw,
    bRoll: bRolled.raw,
    note:
      `Focus ${af} both ways — contested Control: ` +
      `${a.label} ${aTotal} vs ${b.label} ${bTotal}. ` +
      (aTotal === bTotal ? `Tied, so ${b.label} holds.` : `${winner === "a" ? a.label : b.label} wins.`),
  };
}
