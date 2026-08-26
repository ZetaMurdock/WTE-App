// How OFTEN an ability may be used, read from the field the corpus already has.
//
// Every one of the 98 Genus abilities carries an authored `| Limit |` — 47
// distinct strings, from "Once per encounter" through "Once per SNR window per
// target pair" to "Unlimited within SS budget; cannot shape living matter".
// None of it reached the table: the string was printed on the card and that was
// the whole of it, so the count lived in a player's memory.
//
// This module types those strings and NOTHING ELSE. It deliberately does not
// ask a page to re-declare its limit inside the `## Actions` block: the corpus
// already says it once, and a second place to say the same thing is exactly the
// drift the Actions arc exists to remove.
//
// Same discipline as inceptGrants and abilityEffects: a closed vocabulary for
// the part that is mechanics (the PERIOD), open text for the part that is
// setting (the SCOPE a count is keyed by), and a clause this grammar cannot
// type is REPORTED rather than guessed at. `unreadable` is a first-class
// output — "Once per long rest for creature merging; once per encounter for
// objects" is a real rule that needs a Curator's decision, and the honest thing
// is to say so on the card instead of quietly enforcing half of it.

/** Windows a limit may be counted against. Closed on purpose: an unrecognised
 *  period is reported, never invented. Which of these the APP can observe is a
 *  separate question with a separate table — see the usage ledger's
 *  `boundaryOf`. The grammar knowing a word is not the app knowing when it
 *  ticks. */
export type LimitPeriod =
  | "turn"
  | "round"
  | "encounter"
  | "scene"
  | "action"
  | "short-rest"
  | "long-rest"
  | "synaptic-focus"
  | "snr-window"
  | "downtime"
  | "day";

/** Every spelling the corpus uses, mapped to one id. Plurals are listed rather
 *  than stemmed: stripping a trailing "s" turns "SNR windows" into "snr window"
 *  correctly and "Synaptic Focus" into "Synaptic Focu". */
const PERIOD_WORDS: Readonly<Record<string, LimitPeriod>> = {
  turn: "turn",
  turns: "turn",
  round: "round",
  rounds: "round",
  encounter: "encounter",
  encounters: "encounter",
  scene: "scene",
  scenes: "scene",
  action: "action",
  actions: "action",
  "short rest": "short-rest",
  "short rests": "short-rest",
  "long rest": "long-rest",
  "long rests": "long-rest",
  "synaptic focus": "synaptic-focus",
  "snr window": "snr-window",
  "snr windows": "snr-window",
  downtime: "downtime",
  downtimes: "downtime",
  day: "day",
  days: "day",
  "24 hours": "day",
};

const PERIOD_LABELS: Readonly<Record<LimitPeriod, string>> = {
  turn: "turn",
  round: "round",
  encounter: "encounter",
  scene: "scene",
  action: "action",
  "short-rest": "short rest",
  "long-rest": "long rest",
  "synaptic-focus": "Synaptic Focus",
  "snr-window": "SNR window",
  downtime: "downtime",
  day: "day",
};

export function limitPeriodLabel(period: LimitPeriod): string {
  return PERIOD_LABELS[period];
}

/** "Once per encounter" — a count that refills when its window turns over. */
export interface PeriodClause {
  kind: "per-period";
  count: number;
  period: LimitPeriod;
  /** "Once per 4 rounds" — the window spans this many periods. 1 in the
   *  ordinary case, so a consumer never has to check for undefined. */
  everyN: number;
  /** Dimensions the count is keyed by: "target", "element type", "material
   *  pairing". OPEN text, like a condition name in the `## Actions` grammar —
   *  the setting decides what a substance type is, and a table writing its own
   *  must not need a parser change to say "once per Vault per scene". */
  scopes: string[];
  text: string;
}

/** "One object animated at a time" — a cap on how many are live at once, which
 *  is a different rule from how many times you may start one. */
export interface ConcurrentClause {
  kind: "concurrent";
  count: number;
  /** What there may only be N of, as authored. */
  noun: string;
  text: string;
}

/** "Unlimited within SS budget" — no use count at all; the price is the limit. */
export interface UnlimitedClause {
  kind: "unlimited";
  /** What still bounds it, as authored ("SS budget"), or null for a bare
   *  "Unlimited". Not typed further: the SS price is abilityCost's business. */
  gate: string | null;
  text: string;
}

export type LimitClause = PeriodClause | ConcurrentClause | UnlimitedClause;

export interface UsageLimit {
  /** The authored string, verbatim and always. Whatever this grammar makes of
   *  it, the card shows what the page said. */
  text: string;
  clauses: LimitClause[];
  /** Clauses this grammar cannot type. NOT a parse failure to be hidden — it is
   *  the report. A limit with entries here is shown as authored and left to the
   *  table, because guessing at "requires willing participant" would be the app
   *  inventing a rule the setting never wrote. */
  unreadable: string[];
}

const FREQUENCY_WORDS: Readonly<Record<string, number>> = {
  once: 1,
  twice: 2,
  thrice: 3,
};

const CARDINALS: Readonly<Record<string, number>> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
};

function own<T>(table: Readonly<Record<string, T>>, key: string): T | undefined {
  const k = key.trim().toLowerCase().replace(/\s+/g, " ");
  return Object.prototype.hasOwnProperty.call(table, k) ? table[k] : undefined;
}

function digits(word: string): number | null {
  return /^\d{1,3}$/.test(word.trim()) ? parseInt(word.trim(), 10) : null;
}

/** "Once" / "Twice" / "Three times" / "4" — how many uses a clause allows. */
function frequency(word: string): number | null {
  const w = word.trim().toLowerCase();
  const named = own(FREQUENCY_WORDS, w);
  if (named != null) return named;
  const times = /^(.+?)\s+times?$/.exec(w);
  if (times) return own(CARDINALS, times[1]) ?? digits(times[1]);
  return digits(w);
}

/** A cardinal in the leading position of a cap: "One object", "Four object". */
function cardinal(word: string): number | null {
  return own(CARDINALS, word) ?? digits(word);
}

/** A scope is a short noun phrase. Digits and punctuation are how a MANGLED
 *  clause reaches here — "encounter (Short), Once" is what splitting a
 *  two-variant limit leaves behind — and typing that as a scope would invent a
 *  dimension the page never named. */
const SCOPE_RE = /^[a-z][a-z /-]*$/;

interface Segment {
  period?: LimitPeriod;
  everyN?: number;
  scope?: string;
}

function segment(text: string): Segment | null {
  const t = text.trim().toLowerCase().replace(/\s+/g, " ");
  if (!t) return null;
  const period = own(PERIOD_WORDS, t);
  if (period) return { period, everyN: 1 };
  // "4 rounds" — the window spans several periods.
  const spanned = /^(\d{1,3})\s+(.+)$/.exec(t);
  if (spanned) {
    const spannedPeriod = own(PERIOD_WORDS, spanned[2]);
    if (spannedPeriod) return { period: spannedPeriod, everyN: parseInt(spanned[1], 10) };
  }
  return SCOPE_RE.test(t) ? { scope: t } : null;
}

function periodClause(text: string): PeriodClause | null {
  const m = /^(.+?)\s+per\s+(.+)$/i.exec(text.trim());
  if (!m) return null;
  const count = frequency(m[1]);
  if (count == null || count < 1) return null;
  const parts = m[2].split(/\s+per\s+/i);
  const scopes: string[] = [];
  let period: LimitPeriod | null = null;
  let everyN = 1;
  for (const part of parts) {
    const seg = segment(part);
    if (!seg) return null;
    if (seg.period) {
      // Two periods in one clause is not a count anything can keep: "Twice per
      // encounter (Short), Once per 24 hours (Long)" is two DIFFERENT limits
      // for two forms of one ability, and picking either enforces the wrong one.
      if (period) return null;
      period = seg.period;
      everyN = seg.everyN ?? 1;
    } else if (seg.scope) {
      scopes.push(seg.scope);
    }
  }
  if (!period) return null;
  return { kind: "per-period", count, period, everyN, scopes, text: text.trim() };
}

const CONCURRENT_RE = /^(?:(up to|maximum|max)\s+)?([A-Za-z]+|\d{1,3})\s+(.+?)(?:\s+(at a time|simultaneously))?$/i;

function concurrentClause(text: string): ConcurrentClause | null {
  const t = text.trim();
  const m = CONCURRENT_RE.exec(t);
  if (!m) return null;
  // Without one of these markers, "5 SS" reads as a cap of five SS. A cap says
  // it is a cap, in one of the ways the corpus writes it.
  if (!m[1] && !m[4]) return null;
  const count = cardinal(m[2]);
  if (count == null || count < 1) return null;
  const noun = m[3].trim();
  // Periods are tried first, but a MALFORMED one must not fall through to here
  // either — "3 per short rest" would otherwise become a cap of three "per"s.
  if (!noun || /\bper\b/i.test(noun)) return null;
  return { kind: "concurrent", count, noun, text: t };
}

function unlimitedClause(text: string): UnlimitedClause | null {
  const m = /^unlimited(?:\s+within\s+(.+))?$/i.exec(text.trim());
  if (!m) return null;
  return { kind: "unlimited", gate: m[1]?.trim() || null, text: text.trim() };
}

/** Clauses are separated by a semicolon or a sentence break. NOT by commas:
 *  "5 SS per 1,000 gallons" carries one inside a number. */
function clauseTexts(text: string): string[] {
  return text
    .split(/;|(?<=\.)\s+/)
    .map((part) => part.trim().replace(/\.$/, "").trim())
    .filter(Boolean);
}

/**
 * Read an authored `| Limit |` string.
 *
 *     "Once per encounter"          → 1 per encounter
 *     "Once per target per scene"   → 1 per scene, keyed per target
 *     "Once per 4 rounds"           → 1 per 4 rounds
 *     "One active Link at a time"   → a cap of 1, not a use count
 *     "Unlimited within SS budget"  → no use count; SS is the limit
 *     "Once per long rest; requires willing participant"
 *                                   → 1 per long rest, plus one clause reported
 *                                     for the table to rule on
 *
 * Returns null for an ability with NO authored limit, which is not the same as
 * an unlimited one and must never be shown as one.
 */
export function parseUsageLimit(text: string | null | undefined): UsageLimit | null {
  const raw = (text ?? "").trim();
  if (!raw) return null;
  const clauses: LimitClause[] = [];
  const unreadable: string[] = [];
  for (const part of clauseTexts(raw)) {
    const clause = periodClause(part) ?? concurrentClause(part) ?? unlimitedClause(part);
    if (clause) clauses.push(clause);
    else unreadable.push(part);
  }
  return { text: raw, clauses, unreadable };
}

/** The clause a tally can be kept against, or null where the limit is a cap, a
 *  budget, or something only a human can adjudicate. The FIRST period clause:
 *  the corpus never writes two, and `periodClause` refuses the one string that
 *  looked like it did. */
export function countedClause(limit: UsageLimit | null): PeriodClause | null {
  if (!limit) return null;
  // A page that says UNLIMITED has said there is no use count, and the rate it
  // names beside it is a budget, not an allowance. Photonic Swing is authored
  // "Unlimited; once per action"; counting the rider put "1 of 1 used" and an
  // amber row on an ability the corpus calls unlimited, and — the app running
  // no action boundary — left it there until a human hit reset.
  if (limit.clauses.some((clause) => clause.kind === "unlimited")) return null;
  for (const clause of limit.clauses) if (clause.kind === "per-period") return clause;
  return null;
}

/** How a period clause reads back to a Curator: "2 per encounter",
 *  "1 per scene, per target". */
export function clauseLabel(clause: PeriodClause): string {
  const window =
    clause.everyN > 1 ? `${clause.everyN} ${limitPeriodLabel(clause.period)}s` : limitPeriodLabel(clause.period);
  const keyed = clause.scopes.length ? `, per ${clause.scopes.join(" per ")}` : "";
  return `${clause.count} per ${window}${keyed}`;
}
