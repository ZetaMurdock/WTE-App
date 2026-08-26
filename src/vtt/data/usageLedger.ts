// Counting uses against an authored limit — and being honest about the windows
// this app cannot see.
//
// `abilityLimits` types "Once per short rest" into a count and a period. Only
// half of that is something the app can act on: it knows what a turn, a round,
// an encounter and a scene are, because it runs them. It has NO concept of a
// short rest, a long rest, a Synaptic Focus boundary, an SNR window, downtime,
// or a day. Inventing one — "a long rest is eight in-app hours", "an SNR window
// closes at end of round" — would be this app writing setting rules, which is
// the one thing it must never do.
//
// So a period is either OBSERVED or the TABLE'S. An observed period keys its
// tally to the window the app is actually in, and the count refills by itself
// when that window turns over. A table period keys its tally to one manual
// bucket that only a human clears, and the card SAYS so: "2 of 3 used · since
// reset — a short rest is the table's call". The number is still useful; the
// boundary is still theirs.
//
// Nothing here blocks anything. See `usageStatus` for why.
import {
  countedClause,
  limitPeriodLabel,
  type LimitPeriod,
  type PeriodClause,
  type UsageLimit,
} from "../../game/abilityLimits";

/** Where a period's edge comes from. `observed` means the app runs the clock;
 *  `table` means it does not, and a Curator says when the window turned. */
export type BoundaryKind = "observed" | "table";

/** The four windows the app actually runs. Everything else is the table's, and
 *  is listed by its ABSENCE from here rather than by a guessed equivalence —
 *  "an encounter is close enough to an SNR window" is exactly the kind of
 *  substitution that would put an app-authored rule in front of a Curator. */
const OBSERVED: Readonly<Record<string, true>> = {
  turn: true,
  round: true,
  encounter: true,
  scene: true,
};

export function boundaryOf(period: LimitPeriod): BoundaryKind {
  return Object.prototype.hasOwnProperty.call(OBSERVED, period) ? "observed" : "table";
}

/** Where the table is right now, as far as a limit is concerned. Every field is
 *  optional: the abilities panel is usable with no scene loaded and no
 *  encounter linked, and a window that is not running is a window nothing can
 *  be counted against — not a window to fall back from. */
export interface UsageWindow {
  sceneId?: string | null;
  encounterId?: string | null;
  round?: number | null;
  /** The combatant whose turn it is. A round number alone cannot separate two
   *  characters' turns inside it, and "Once per turn" means YOUR turn. */
  turnId?: string | null;
}

/**
 * The key a tally is kept under, or null where the window is not running.
 *
 * Null is a real answer and not a failure: "Once per encounter" with no
 * encounter linked has nothing to count against, and quietly counting it under
 * some other window would give a player a spent use they never had.
 */
export function windowKey(period: LimitPeriod, window: UsageWindow): string | null {
  if (boundaryOf(period) === "table") return `table:${period}`;
  const encounter = window.encounterId?.trim();
  const scene = window.sceneId?.trim();
  const round = window.round;
  switch (period) {
    case "scene":
      return scene ? `scene:${scene}` : null;
    case "encounter":
      return encounter ? `encounter:${encounter}` : null;
    case "round":
      return encounter && round != null ? `encounter:${encounter}#r${round}` : null;
    case "turn":
      // A turn is a round AND whose it is. Keying on the round alone would let
      // one combatant's "Once per turn" ability spend everyone else's.
      return encounter && round != null && window.turnId ? `encounter:${encounter}#r${round}#t${window.turnId}` : null;
    default:
      return null;
  }
}

/** One recorded use. `scopeValue` is the dimension a keyed limit counts
 *  separately — the target id for "once per target per scene". Empty string
 *  where the limit is not keyed, so the tally match is one plain comparison. */
export interface UsageEntry {
  key: string;
  abilityId: string;
  characterId: string;
  scopeValue: string;
  at: number;
}

export interface UsageStatus {
  /** The clause the tally is kept against, when there is one. */
  clause: PeriodClause | null;
  /** The app is keeping this count. False means the card shows the authored
   *  limit and nothing else — see `untracked` for why. */
  tracked: boolean;
  /** Where the window's edge comes from, so the card can say whose call it is. */
  boundary: BoundaryKind | null;
  used: number;
  /** Uses the clause allows, or null when nothing is being counted. */
  allowed: number | null;
  remaining: number;
  /** Every allowed use is spent. NOT a veto — see the note on this module. */
  exhausted: boolean;
  /** Uses beyond the allowance. A Curator overruling a limit is ordinary play,
   *  and the card records that it happened rather than pretending it did not. */
  over: number;
  /** Why the app is not counting, in words a Curator can act on. Null when it
   *  is counting. */
  untracked: string | null;
  key: string | null;
}

const NOT_COUNTED: UsageStatus = {
  clause: null,
  tracked: false,
  boundary: null,
  used: 0,
  allowed: null,
  remaining: 0,
  exhausted: false,
  over: 0,
  untracked: null,
  key: null,
};

export interface UsageContext {
  abilityId: string;
  characterId: string;
  window: UsageWindow;
  /** The dimension a keyed limit separates by — a target's token id for "once
   *  per target per encounter". Absent means the caller cannot supply one, and
   *  the limit is reported as keyed-but-untracked rather than counted as if the
   *  key did not exist. */
  scopeValue?: string;
}

/**
 * What this character has spent against this ability's limit.
 *
 * ENFORCEMENT IS INFORMATIONAL, DELIBERATELY. There is no disabled button
 * anywhere downstream of this, and `exhausted` is a thing the card SAYS, never
 * a thing it does. A Curator overrules a printed limit constantly — the ability
 * is a story beat, the fight has gone long, the page is wrong — and an app that
 * refused the click would be arbitrating the setting instead of tracking it.
 * The engine proposes; the human confirms. The count is the proposal.
 */
export function usageStatus(
  limit: UsageLimit | null,
  uses: readonly UsageEntry[],
  ctx: UsageContext
): UsageStatus {
  const clause = countedClause(limit);
  if (!clause) return NOT_COUNTED;
  const boundary = boundaryOf(clause.period);
  const period = limitPeriodLabel(clause.period);
  const base = { ...NOT_COUNTED, clause, boundary, allowed: clause.count, remaining: clause.count };

  if (clause.scopes.length && ctx.scopeValue === undefined) {
    // "Once per target per scene" needs to know WHICH target. Counting the uses
    // without that key would exhaust the ability on its second target, which is
    // the opposite of what a per-target limit says.
    return { ...base, untracked: `Counted separately per ${clause.scopes.join(" per ")} — the table tracks which.` };
  }
  if (clause.everyN > 1) {
    // "Once per 4 rounds" needs a start the corpus never states. Aligning the
    // window to round 1 would be this app deciding a rule the page did not.
    return { ...base, untracked: `A ${clause.everyN}-${period} window has no declared start — the table tracks it.` };
  }
  const key = windowKey(clause.period, ctx.window);
  if (!key) return { ...base, untracked: `No ${period} is running to count against.` };

  const scopeValue = ctx.scopeValue ?? "";
  let used = 0;
  for (const entry of uses) {
    if (entry.key !== key) continue;
    if (entry.abilityId !== ctx.abilityId) continue;
    if (entry.characterId !== ctx.characterId) continue;
    if (entry.scopeValue !== scopeValue) continue;
    used++;
  }
  return {
    ...base,
    tracked: true,
    key,
    used,
    remaining: Math.max(0, clause.count - used),
    exhausted: used >= clause.count,
    over: Math.max(0, used - clause.count),
  };
}

/** "2 of 3 used" — what the chip says. Empty for a limit nothing is counted
 *  against, so a caller can render the authored text on its own. */
export function usageLabel(status: UsageStatus): string {
  if (!status.tracked || status.allowed == null) return "";
  return `${status.used} of ${status.allowed} used`;
}

/** The whole story for a tooltip: the rule, the window, and whose call the
 *  window's edge is. */
export function usageTitle(limit: UsageLimit, status: UsageStatus): string {
  const parts = [limit.text];
  if (status.untracked) parts.push(status.untracked);
  else if (status.clause && status.boundary === "table")
    parts.push(
      `Counted since the last reset — the app has no ${limitPeriodLabel(status.clause.period)} boundary, so clearing it is the table's call.`
    );
  else if (status.clause) parts.push(`Refills at the start of the next ${limitPeriodLabel(status.clause.period)}.`);
  if (status.over > 0) parts.push(`${status.over} use${status.over === 1 ? "" : "s"} past the printed limit.`);
  if (limit.unreadable.length) parts.push(`Not machine-readable: ${limit.unreadable.join("; ")}`);
  return parts.join(" · ");
}

// ── the store ────────────────────────────────────────────────────────────────
//
// Module-level, keyed by the same session scope the outcome ledger uses, for
// the same reason: the abilities panel unmounts every time the Curator switches
// tools, and a tally that vanished with a panel would be worse than no tally.
// In memory only — a use count is a record of THIS session's play, and a stale
// one restored from disk next week would show a fight's spent uses against a
// fresh encounter.

const LEDGERS = new Map<string, UsageEntry[]>();
const LISTENERS = new Map<string, Set<() => void>>();
/** A long fight is a few dozen uses. The cap is only here so a session left
 *  open for days cannot grow this without bound. */
const MAX_ENTRIES = 500;

// Shared empty result so `listUses` returns a STABLE reference for a scope with
// no uses — required by useSyncExternalStore, which compares by identity and
// re-renders forever against a reader that allocates a new array per call.
const NO_USES = Object.freeze([]) as unknown as UsageEntry[];

function emit(scope: string): void {
  for (const listener of LISTENERS.get(scope) ?? []) listener();
}

export function subscribeUses(scope: string, listener: () => void): () => void {
  const set = LISTENERS.get(scope) ?? new Set<() => void>();
  set.add(listener);
  LISTENERS.set(scope, set);
  return () => {
    set.delete(listener);
    if (set.size === 0 && LISTENERS.get(scope) === set) LISTENERS.delete(scope);
  };
}

export function listUses(scope: string): UsageEntry[] {
  return LEDGERS.get(scope) ?? NO_USES;
}

/** Record one use. Returns the entry, or null where the limit is not one the
 *  app counts — a use with nothing to count it against must not become a row
 *  that later reads as a spent charge. */
export function recordUse(scope: string, limit: UsageLimit | null, ctx: UsageContext, now = Date.now()): UsageEntry | null {
  const status = usageStatus(limit, listUses(scope), ctx);
  if (!status.tracked || !status.key) return null;
  const entry: UsageEntry = {
    key: status.key,
    abilityId: ctx.abilityId,
    characterId: ctx.characterId,
    scopeValue: ctx.scopeValue ?? "",
    at: now,
  };
  const all = LEDGERS.get(scope) ?? [];
  LEDGERS.set(scope, [...all, entry].slice(-MAX_ENTRIES));
  emit(scope);
  return entry;
}

/**
 * Clear a tally — the override, and the answer to every window the app cannot
 * see.
 *
 * A Curator declaring "you took a short rest" is the boundary for every
 * short-rest limit at the table, and this is how they say it. Scoped to one
 * ability and one character when both are given, so resetting a single
 * overruled limit does not silently refill the rest of the party's.
 */
export function clearUses(scope: string, filter?: { abilityId?: string; characterId?: string; key?: string }): void {
  const all = LEDGERS.get(scope);
  if (!all?.length) return;
  const kept = filter
    ? all.filter(
        (entry) =>
          (filter.abilityId != null && entry.abilityId !== filter.abilityId) ||
          (filter.characterId != null && entry.characterId !== filter.characterId) ||
          (filter.key != null && entry.key !== filter.key)
      )
    : [];
  if (kept.length === all.length) return;
  if (kept.length) LEDGERS.set(scope, kept);
  else LEDGERS.delete(scope);
  emit(scope);
}

export function __resetUsageLedger(): void {
  LEDGERS.clear();
  LISTENERS.clear();
}
