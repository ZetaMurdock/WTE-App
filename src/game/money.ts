// W.T.E currency — Palladium, Credits, Shrives.
//
//   10,000 Shrives   = 1 Credit
//   1,000,000 Credits = 1 Palladium
//
// so 1 Palladium = 10,000,000,000 Shrives. That is a huge spread, which drives
// two decisions:
//
//  • Everything is stored as ONE integer of SHRIVES, the smallest unit. Storing
//    three separate fields invites the classic bug where 10,001 Shrives and
//    1 Credit + 1 Shrive are "different" amounts.
//  • Number.MAX_SAFE_INTEGER / 10^10 is 900,719, so Shrive-exact arithmetic
//    holds up to ~900,000 Palladium. That is far past any table's purse, but the
//    cap is enforced rather than left to silently lose precision.

export const SHRIVES_PER_CREDIT = 10_000;
export const CREDITS_PER_PALLADIUM = 1_000_000;
export const SHRIVES_PER_PALLADIUM = SHRIVES_PER_CREDIT * CREDITS_PER_PALLADIUM; // 10^10

/** Hard ceiling: the largest Shrive total that stays exact in a JS number. */
export const MAX_SHRIVES = Math.floor(Number.MAX_SAFE_INTEGER / SHRIVES_PER_PALLADIUM) * SHRIVES_PER_PALLADIUM;

export interface Purse {
  palladium: number;
  credits: number;
  shrives: number;
}

/** Clamp to the representable, non-negative range. Money never goes below zero —
 *  a debt is a story, not a negative purse. */
export function clampShrives(n: number): number {
  const v = Number(n);
  // Only NaN is "no amount". Infinity means absurdly large, which must clamp to
  // the ceiling — treating it as 0 would silently ZERO someone's purse.
  if (Number.isNaN(v)) return 0;
  return Math.round(Math.max(0, Math.min(MAX_SHRIVES, v)));
}

/** Collapse a mixed purse into a single Shrive total. Components may be
 *  un-normalised — 15,000 Shrives is fine and becomes 1 Credit 5,000 Shrives. */
export function toShrives(p: Partial<Purse>): number {
  const pd = Number(p.palladium) || 0;
  const cr = Number(p.credits) || 0;
  const sh = Number(p.shrives) || 0;
  return clampShrives(pd * SHRIVES_PER_PALLADIUM + cr * SHRIVES_PER_CREDIT + sh);
}

/** Split a Shrive total into the largest denominations that fit. */
export function fromShrives(total: number): Purse {
  let n = clampShrives(total);
  const palladium = Math.floor(n / SHRIVES_PER_PALLADIUM);
  n -= palladium * SHRIVES_PER_PALLADIUM;
  const credits = Math.floor(n / SHRIVES_PER_CREDIT);
  const shrives = n - credits * SHRIVES_PER_CREDIT;
  return { palladium, credits, shrives };
}

const nf = (n: number) => n.toLocaleString("en-US");

/** Short label for a sheet or a card: "2 Pd · 340,000 Cr · 5,000 Sh".
 *  Zero denominations are omitted; a wholly empty purse reads "0 Sh". */
export function formatMoney(total: number): string {
  const { palladium, credits, shrives } = fromShrives(total);
  const parts: string[] = [];
  if (palladium) parts.push(`${nf(palladium)} Pd`);
  if (credits) parts.push(`${nf(credits)} Cr`);
  if (shrives || parts.length === 0) parts.push(`${nf(shrives)} Sh`);
  return parts.join(" · ");
}

/** Long form, for a ledger line: "2 Palladium, 340,000 Credits, 5,000 Shrives". */
export function formatMoneyLong(total: number): string {
  const { palladium, credits, shrives } = fromShrives(total);
  const parts: string[] = [];
  if (palladium) parts.push(`${nf(palladium)} Palladium`);
  if (credits) parts.push(`${nf(credits)} Credit${credits === 1 ? "" : "s"}`);
  if (shrives || parts.length === 0) parts.push(`${nf(shrives)} Shrive${shrives === 1 ? "" : "s"}`);
  return parts.join(", ");
}

/** Read a typed amount. Accepts "2pd 300cr", "5,000 sh", a bare number (Shrives),
 *  and the long words. Returns null when nothing numeric is present, so a caller
 *  can tell "they typed rubbish" from "they typed zero". */
export function parseMoney(text: string): number | null {
  const s = String(text ?? "").toLowerCase().replace(/,/g, "").trim();
  if (!s) return null;
  const re = /(-?\d+(?:\.\d+)?)\s*(palladium|pall?|pd|p|credits?|cr|c|shrives?|sh|s)?/g;
  let m: RegExpExecArray | null;
  let total = 0;
  let found = false;
  while ((m = re.exec(s))) {
    const v = parseFloat(m[1]);
    if (!Number.isFinite(v)) continue;
    found = true;
    const unit = m[2] ?? "sh";
    if (/^(palladium|pall?|pd|p)$/.test(unit)) total += v * SHRIVES_PER_PALLADIUM;
    else if (/^(credits?|cr|c)$/.test(unit)) total += v * SHRIVES_PER_CREDIT;
    else total += v;
  }
  return found ? clampShrives(total) : null;
}

/** Add (or subtract, with a negative delta) and clamp. */
export function addShrives(total: number, delta: number): number {
  return clampShrives(clampShrives(total) + (Number(delta) || 0));
}

/** Can this purse cover `cost`? */
export function canAfford(total: number, cost: number): boolean {
  return clampShrives(total) >= clampShrives(cost);
}

/** Spend, returning the new total, or null when it cannot be covered — so a
 *  caller must handle the shortfall rather than silently flooring at zero. */
export function spendShrives(total: number, cost: number): number | null {
  const t = clampShrives(total);
  const c = clampShrives(cost);
  return t >= c ? t - c : null;
}
