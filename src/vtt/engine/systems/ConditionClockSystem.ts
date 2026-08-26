// ConditionClockSystem: the round clock's effect on CONDITIONS.
//
// A condition was a plain string with no end to it. P0/P1 wrote "Slowed (2)"
// onto a token and nothing ever took it off again — the tag outlived the fight,
// the scene, and eventually the campaign, because no layer owned the countdown
// the prose had already declared.
//
// The countdown does NOT live in the tag. `VttConditionClock` says why the wire
// format stays plain text; what belongs here is the consequence of that choice:
// a clock is matched to a status by its EXACT text, one clock per occurrence, so
// a `stack` condition's instances stay distinguishable without either side of
// the wire learning a new encoding.
//
// Nothing in this file writes to a token. `expire` computes what a round has
// undone and hands each removal to a writer the engine supplies —
// adjudicateTokenVitals, the same authorised path a Curator's own ruling takes,
// which reports whether the write landed. A refused write keeps its clock, so
// the condition is retried rather than silently forgotten. The Curator stays
// sovereign; the clock only ever proposes.
import { resolveCondition, type ConditionStacking } from "../../../game/conditions";
import type { VttConditionClock, VttSceneData, VttToken } from "../../types/scene";

/**
 * What a tag with no Conditions page behind it does when it lands twice.
 *
 * The four stacking rules are page-declared and this system never overrides one.
 * But a token may carry free text no page defines — a Curator's own "Marked", a
 * tag from a campaign whose pages are not loaded — and that has to do SOMETHING.
 * `refresh` is the conservative reading: one pip, and the longer clock wins, so
 * an undefined tag can never multiply behind the table's back.
 */
export const UNDECLARED_STACKING: ConditionStacking = "refresh";

/** Ceiling on live clocks in one scene. Statuses are capped per token by the
 *  patch sanitizer; this caps the field as a whole so a scripted `stack` loop
 *  cannot grow a snapshot past the wire budget. */
export const MAX_CONDITION_CLOCKS = 4_000;

const MAX_ROUNDS = 9_999;

/** The rounds suffix `conditionTag` appends for display — "Slowed (2)". The tag
 *  is the token's truth and is never rewritten, so the lookup strips the suffix
 *  rather than asking every page to declare a name that includes its duration. */
const TAG_ROUNDS_SUFFIX = /\s*\(\d{1,4}\)\s*$/;

/** The condition a status tag names, for the registry lookup. */
export function conditionOfTag(status: string): string {
  const raw = String(status ?? "").trim();
  return resolveCondition(raw) ? raw : raw.replace(TAG_ROUNDS_SUFFIX, "").trim() || raw;
}

/** The Stacking rule the tag's page declares, or the undeclared fallback. */
export function stackingForTag(status: string): ConditionStacking {
  return resolveCondition(conditionOfTag(status))?.stacking ?? UNDECLARED_STACKING;
}

/** One condition landing on one body. */
export interface ConditionApplication {
  tokenId: string;
  /** The tag exactly as it will read on the token. */
  status: string;
  /** The encounter round it lands on. */
  round: number;
  /** Rounds it lasts. Absent/0 = no clock: it stays until a Curator clears it. */
  rounds?: number;
  /** How strong this application is, when the caller knows. Only `highest`
   *  reads it, and it defaults to the declared duration. */
  potency?: number;
}

/** What an application WOULD do. Committed by the engine, never here. */
export interface ConditionPlan {
  /** The target's next `statuses`, for the authorised vitals write. */
  statuses: string[];
  /** The scene's next clock list, written only once that write is authorised. */
  clocks: VttConditionClock[];
  /** The rule that decided it, so a caller can report what the page said. */
  stacking: ConditionStacking;
}

/** A round's worth of removals on one token. */
export interface ConditionExpiry {
  tokenId: string;
  /** The token's next `statuses`, one occurrence gone per expired clock. */
  statuses: string[];
  /** The tags that ran out, in clock order. */
  expired: string[];
}

/** Commits a token's statuses through the authorised path; reports whether the
 *  write was allowed. `PixiVttApp.adjudicateTokenVitals` is the implementation. */
export type ConditionVitalsWriter = (tokenId: string, statuses: string[]) => boolean;

const ENDLESS = Number.POSITIVE_INFINITY;

function usableRounds(rounds: unknown): number | undefined {
  if (typeof rounds !== "number" || !Number.isFinite(rounds)) return undefined;
  const whole = Math.trunc(rounds);
  return whole >= 1 ? Math.min(whole, MAX_ROUNDS) : undefined;
}

function usableRound(round: unknown): number {
  if (typeof round !== "number" || !Number.isFinite(round)) return 0;
  return Math.max(0, Math.trunc(round));
}

function validClock(clock: unknown): clock is VttConditionClock {
  if (!clock || typeof clock !== "object") return false;
  const c = clock as VttConditionClock;
  return typeof c.tokenId === "string" && !!c.tokenId && typeof c.status === "string" && !!c.status &&
    Number.isFinite(c.bornRound) && Number.isFinite(c.rounds) && c.rounds >= 1;
}

function expiryOf(clock: VttConditionClock): number {
  return clock.bornRound + clock.rounds;
}

/** A clock's strength for `highest`: what the caller declared, or failing that
 *  the duration it asked for — the only magnitude a plain-text tag carries. */
function potencyOf(clock: VttConditionClock): number {
  return typeof clock.potency === "number" && Number.isFinite(clock.potency) ? clock.potency : clock.rounds;
}

function occurrences(statuses: readonly string[], status: string): number {
  let n = 0;
  for (const entry of statuses) if (entry === status) n++;
  return n;
}

/** Drop `count` occurrences of `status`, leaving every other tag where it sits
 *  — a token's pips are ordered and a Curator reads them in that order. */
function withoutOccurrences(statuses: readonly string[], status: string, count: number): string[] {
  let left = count;
  const out: string[] = [];
  for (const entry of statuses) {
    if (left > 0 && entry === status) {
      left--;
      continue;
    }
    out.push(entry);
  }
  return out;
}

/** Keep the field ABSENT while a scene has no clocks, so a table that never
 *  applies a timed condition saves and syncs exactly what it did before. */
function setClocks(data: VttSceneData, clocks: VttConditionClock[]): void {
  if (clocks.length) data.conditionClocks = clocks;
  else delete data.conditionClocks;
}

export class ConditionClockSystem {
  /**
   * What applying `status` to a token would leave behind, decided by the
   * Stacking rule the condition's own page declares.
   *
   * Returns null when there is nothing to apply to (no such token, empty tag) or
   * when the scene is already at `MAX_CONDITION_CLOCKS` — a refusal the caller
   * can report, rather than an application that quietly loses its clock.
   */
  plan(data: VttSceneData, application: ConditionApplication): ConditionPlan | null {
    const status = String(application.status ?? "").trim();
    const token = data.tokens.find((t) => t.id === application.tokenId);
    if (!token || !status) return null;

    const stacking = stackingForTag(status);
    const round = usableRound(application.round);
    const rounds = usableRounds(application.rounds);
    const potency = typeof application.potency === "number" && Number.isFinite(application.potency) ? application.potency : undefined;

    const all = (data.conditionClocks ?? []).filter(validClock);
    if (rounds !== undefined && all.length >= MAX_CONDITION_CLOCKS) return null;
    const mine = (clock: VttConditionClock) => clock.tokenId === token.id && clock.status === status;
    const held = all.filter(mine);
    const rest = all.filter((clock) => !mine(clock));
    const current = token.statuses ?? [];
    const present = occurrences(current, status);
    // Null stands for "no clock" throughout: an application with no duration is
    // endless, and endless is exactly what a missing clock means on the wire.
    const fresh: VttConditionClock | null = rounds === undefined
      ? null
      : { tokenId: token.id, status, bornRound: round, rounds, ...(potency !== undefined ? { potency } : {}) };

    // stack: instances are counted, so each application is its own pip and its
    // own clock, and neither knows about the other.
    if (stacking === "stack") {
      return { statuses: [...current, status], clocks: fresh ? [...rest, ...held, fresh] : all, stacking };
    }

    // Every other rule keeps ONE instance. A duplicate can only have come from a
    // page that used to say `stack`, and a rule that says one instance cannot
    // leave two pips standing the moment it is asked again.
    const statuses = present === 1 ? [...current] : [...withoutOccurrences(current, status, present), status];

    // With no instance on the token, whatever clocks name this tag are stale —
    // a Curator cleared the pip by hand — and this is a first application.
    const heldClock = present === 0
      ? null
      : held.reduce<VttConditionClock | null>((best, clock) => (!best || expiryOf(clock) > expiryOf(best) ? clock : best), null);
    // A tag already on the token with no clock never expires, and no finite
    // duration outlasts or outweighs it.
    const endlessHeld = present > 0 && !heldClock;
    const newExpiry = fresh ? expiryOf(fresh) : ENDLESS;
    const newPotency = potency ?? rounds ?? ENDLESS;

    let winner: VttConditionClock | null;
    if (present === 0) {
      winner = fresh; // nothing held — a first application
    } else if (stacking === "extend") {
      // Durations add: the held clock simply runs longer, keeping the round it
      // was born on so the total is exactly remaining + new.
      winner = endlessHeld || !fresh || !heldClock ? null : { ...heldClock, rounds: Math.min(heldClock.rounds + fresh.rounds, MAX_ROUNDS) };
    } else if (stacking === "highest") {
      // The stronger application wins outright and brings its own duration —
      // which is why a weaker one is discarded even when it would last longer.
      winner = newPotency > (endlessHeld ? ENDLESS : potencyOf(heldClock!)) ? fresh : heldClock;
    } else {
      // refresh: the longer of the two durations wins; the loser is forgotten.
      winner = newExpiry > (endlessHeld ? ENDLESS : expiryOf(heldClock!)) ? fresh : heldClock;
    }

    return { statuses, clocks: winner ? [...rest, winner] : rest, stacking };
  }

  /** The removals a round has caused, without committing any of them. */
  due(data: VttSceneData, round: number): ConditionExpiry[] {
    const now = usableRound(round);
    const byToken = new Map<string, { token: VttToken; expired: VttConditionClock[] }>();
    for (const clock of data.conditionClocks ?? []) {
      if (!validClock(clock) || now < expiryOf(clock)) continue;
      const token = data.tokens.find((t) => t.id === clock.tokenId);
      if (!token) continue;
      const entry = byToken.get(token.id) ?? { token, expired: [] };
      entry.expired.push(clock);
      byToken.set(token.id, entry);
    }
    const out: ConditionExpiry[] = [];
    for (const { token, expired } of byToken.values()) {
      let statuses = [...(token.statuses ?? [])];
      const counts = new Map<string, number>();
      for (const clock of expired) counts.set(clock.status, (counts.get(clock.status) ?? 0) + 1);
      for (const [status, count] of counts) statuses = withoutOccurrences(statuses, status, count);
      out.push({ tokenId: token.id, statuses, expired: expired.map((clock) => clock.status) });
    }
    return out;
  }

  /**
   * Run the clocks out at `round`: the condition comes off the token through
   * `write`, and only then is its clock cleared.
   *
   * A write the engine refuses keeps its clock, so the tag is not left on a body
   * with nothing counting it down — the next round asks again. Returns the tags
   * actually removed.
   */
  expire(data: VttSceneData, round: number, write: ConditionVitalsWriter): string[] {
    const clocks = (data.conditionClocks ?? []).filter(validClock);
    if (!clocks.length) {
      if (data.conditionClocks?.length) setClocks(data, []);
      return [];
    }
    const now = usableRound(round);
    const expiries = this.due(data, now);
    const refused = new Set<string>();
    const removed: string[] = [];
    for (const expiry of expiries) {
      if (write(expiry.tokenId, expiry.statuses)) removed.push(...expiry.expired);
      else refused.add(expiry.tokenId);
    }
    const kept = clocks.filter((clock) => {
      if (now < expiryOf(clock)) return true;
      if (refused.has(clock.tokenId)) return true;
      // An expired clock on a token that is no longer here has nothing to remove.
      return false;
    });
    if (kept.length !== (data.conditionClocks?.length ?? 0)) setClocks(data, kept);
    return removed;
  }

  /**
   * Re-anchor every clock to its REMAINING rounds, because the counter it was
   * measured against is about to start over.
   *
   * A clock stores an absolute expiry, which is right while one encounter runs:
   * walking a mis-clicked round back un-expires exactly what that round expired.
   * But `newEncounter` starts at round 1 again, so a tag applied on round 9 of a
   * fight that ends carries an expiry of 11 into the next one and sits there,
   * unexpired, through ten rounds of it — the tag outliving the fight, which is
   * the whole bug this file exists to end.
   *
   * `lastRound` is the round the ending encounter was on. A clock already past
   * its expiry (its removal was refused) keeps one round, so the next fight asks
   * again instead of inheriting a countdown that can never fire. Nothing is
   * written to a token: a condition between fights is still the Curator's.
   */
  restart(data: VttSceneData, lastRound: number): boolean {
    const clocks = (data.conditionClocks ?? []).filter(validClock);
    if (!clocks.length) return false;
    const ended = usableRound(lastRound);
    // Anchoring at round 0 while encounters count from 1 leaves exactly the
    // rounds a continuous counter would have had left: expiry - ended.
    let moved = clocks.length !== (data.conditionClocks?.length ?? 0);
    const next = clocks.map((clock) => {
      const rounds = Math.min(Math.max(expiryOf(clock) - ended, 1), MAX_ROUNDS);
      if (clock.bornRound === 0 && clock.rounds === rounds) return clock;
      moved = true;
      return { ...clock, bornRound: 0, rounds };
    });
    if (!moved) return false;
    setClocks(data, next);
    return true;
  }

  /**
   * Drop clocks with nothing left to count: a deleted token, a status a Curator
   * cleared by hand, a malformed entry from a peer, and any surplus beyond the
   * occurrences actually on the token.
   *
   * Returns whether anything was dropped. Orphans are not merely untidy — a
   * clock outliving its token would fire a vitals write at an id that no longer
   * exists, every round, for the life of the scene.
   */
  prune(data: VttSceneData): boolean {
    const clocks = data.conditionClocks;
    if (!clocks?.length) return false;
    const left = new Map<string, number>();
    const kept = clocks.filter((clock) => {
      if (!validClock(clock)) return false;
      const token = data.tokens.find((t) => t.id === clock.tokenId);
      if (!token) return false;
      // NUL joins the halves so a status carrying the separator character
      // cannot collide with another token's key; it is written as an escape
      // because a raw NUL byte in source makes grep skip the whole file as
      // binary.
      const key = `${clock.tokenId}\u0000${clock.status}`;
      const remaining = left.get(key) ?? occurrences(token.statuses ?? [], clock.status);
      if (remaining <= 0) return false;
      left.set(key, remaining - 1);
      return true;
    }).slice(0, MAX_CONDITION_CLOCKS);
    if (kept.length === clocks.length) return false;
    setClocks(data, kept);
    return true;
  }
}
