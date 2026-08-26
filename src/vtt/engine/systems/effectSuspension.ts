// What "suspended" means for a placed effect, and why it is a round rather than
// a flag.
//
// `Tamper: delay, 1 round` says an ability's effect stops happening and then
// starts happening again. Every other property of that effect — its shape, its
// remaining life, its per-round lines, the status it grants — has to survive the
// gap untouched, or delay would silently be a weaker `end`.
//
// THE DEFINITION. While the encounter round is below `suspendedUntil`:
//
//   IT GRANTS NO STATUS. `SimulationSystem` still counts the effect among the
//   status OWNERS (so the pip it granted is revoked from whoever was standing
//   in it) but contains nobody. Dropping it from the owner list instead would
//   have stranded the tag: the sim only ever removes a status some live effect
//   claims, so a pip whose zone vanished from that list is kept forever. That
//   is the same stranding `tamperPlan`'s cascade exists to prevent, and it is
//   why suspension is expressed as "the body is empty", not "the effect is
//   gone".
//
//   IT PROPOSES NOTHING. `RecurringEffectSystem` skips it BEFORE stamping
//   `tickedRound`, so the rounds it slept through are not marked paid. A field
//   that woke to find its guard already stamped would skip its first live round.
//
//   IT DOES NOT AGE. `TimelineSystem` will not expire it, and on waking its
//   `bornRound` is pushed forward by exactly the rounds it slept. A 3-round
//   field delayed for 1 round burns for 3 rounds, ending one round later than it
//   would have. The alternative — letting the clock run while nothing happened —
//   makes `delay` into `end` for any effect delayed past its own lifetime, which
//   is the one reading the verb cannot mean.
//
// A ROUND, NOT A BOOLEAN, because the Curator can step the encounter round
// backwards. A boolean would need a separate "who turns it off" pass that a
// backwards step could not reverse; a stored wake-round is simply compared, so
// stepping back into the sleep re-suspends and stepping forward wakes again.
// `suspendedAt` rides beside it for the same reason `VttConditionClock` stores
// `bornRound` rather than a countdown: the amount of life to hand back has to be
// derivable from the record, not from how many times a hook happened to run.
import type { VttEffect, VttSceneData } from "../../types/scene";

/** A round we will actually compare against. Garbage from a peer or an older
 *  build means "not suspended" rather than an effect frozen forever. */
function usableRound(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.trunc(value);
}

/** Is this effect asleep at `round`? */
export function effectSuspended(effect: VttEffect, round: number): boolean {
  const until = usableRound(effect.data.suspendedUntil);
  if (until == null) return false;
  const now = usableRound(round) ?? 0;
  return now < until;
}

/** The rounds an effect still has to sleep, for a Curator-facing line. Zero
 *  when it is awake. */
export function suspensionRemaining(effect: VttEffect, round: number): number {
  const until = usableRound(effect.data.suspendedUntil);
  if (until == null) return 0;
  return Math.max(0, until - (usableRound(round) ?? 0));
}

/**
 * Wake every effect whose delay has run out, handing back the life it slept
 * through. Returns the ids that woke.
 *
 * Runs FIRST on the round hook — before the recurring pass, before expiry,
 * before the zone-status pass — because all three ask whether an effect is
 * suspended and all three must get the same answer for the round they are
 * working on. Waking after expiry would let a field that came back this round be
 * expired by the same tick that returned it.
 *
 * Idempotent: an effect with no `suspendedUntil` is untouched, and a woken one
 * carries neither field, so a hook that fires twice for one round wakes nothing
 * the second time and cannot hand back the same rounds again.
 */
export function resumeSuspended(data: VttSceneData, round: number): string[] {
  const woke: string[] = [];
  const now = usableRound(round) ?? 0;
  for (const effect of data.effects) {
    const until = usableRound(effect.data.suspendedUntil);
    if (until == null) {
      // A stray `suspendedAt` with no wake round is bookkeeping for a sleep that
      // is not happening; leaving it would push `bornRound` by a stale gap the
      // next time anything suspended this effect.
      if (effect.data.suspendedAt !== undefined) delete effect.data.suspendedAt;
      continue;
    }
    if (now < until) continue;
    const from = usableRound(effect.data.suspendedAt);
    // Clamped at zero: a record whose halves disagree (a peer, a hand-edited
    // scene) must not REDUCE an effect's remaining life on waking.
    const slept = from == null ? 0 : Math.max(0, until - from);
    if (slept > 0) effect.data.bornRound = (effect.data.bornRound ?? 0) + slept;
    delete effect.data.suspendedUntil;
    delete effect.data.suspendedAt;
    woke.push(effect.id);
  }
  return woke;
}
