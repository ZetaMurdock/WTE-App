// Custom currencies, as ONE mechanism.
//
// The corpus invents a currency every few pages: Blight stacks on a Stygian's
// victim, Fear Points, Overload Charges, Wryde charges, Perfect Mimic's "4 of 4
// slots", Spectrco's light charge. Read as features they are seven systems; read
// as a shape they are one — a NAMED NUMBER that moves, stops somewhere, and does
// something when it arrives. The `Counter` verb declares the number; `At N`
// declares what arriving costs. This module is the runtime for both, and it is
// deliberately ignorant of WHERE the number is kept.
//
// WHERE IT LIVES (the decision, and why it is two places and not one):
//
// A track has whatever lifetime its OWNER has, and the corpus owns tracks in two
// different ways that no single home can serve.
//
//   - Blight is on a VICTIM. It exists because that body is standing in this
//     fight; when the body leaves the scene the number leaves with it, and the
//     next scene's copy of that creature starts clean. That is a token's
//     lifetime, and token tracks therefore ride the scene beside the condition
//     clocks — see `src/vtt/data/tokenCounters.ts`. Condition clocks proved the
//     shape: an authoritative record beside the scene, plain text on the token.
//   - Fear Points are YOURS. They survive the scene, the encounter and the
//     session, because the character survives them; a Fear track that reset when
//     the Curator opened the world map would be a different mechanic. That is a
//     character's lifetime, and character tracks live on the sheet
//     (`CharacterSheet.counterTracks`).
//
// Forcing either into the other's home breaks a real page, so both are supported
// and the primitive below is the part they share: a `CounterTrack[]` and the
// rules for moving one. Neither home reimplements the arithmetic, the cap, or
// the crossing rule.
//
// WHAT THE GRAMMAR CANNOT SAY, and is therefore reported rather than invented:
//
//   - DECAY. No page in the corpus states that a track ticks down, and no bullet
//     can say it. So nothing here decays anything. A track persists until it is
//     cleared by hand or its owner is gone. `counterGaps` says this out loud so
//     a Curator is told, rather than a rule being back-filled by an engine.
//   - PER-ENCOUNTER RESET. Same gap. `ConditionClockSystem.restart` exists
//     because a DURATION is anchored to a round number and a new fight renumbers
//     the rounds; a counter is anchored to nothing, so a new fight has no
//     arithmetic to redo, and "Overload resets each combat" is a sentence only a
//     page can write.
//   - A FLOOR other than zero. Below zero a currency has no meaning any surface
//     can render, so zero is the floor and a track at zero stops existing.
//   - REPEATING THRESHOLDS. See `crossedThresholds`.
//   - A MARK ON THE WAY DOWN. `At N` says what ARRIVING costs and arriving is
//     upward, so `At 0` — Radiant's "At 0 charges, gain +1 ADA" — can never
//     fire. `counterGaps` names that mark instead of letting the block read as
//     if it worked.
import type { EffectStep } from "./abilityEffects";

/** One named number and the ceiling it was last given. */
export interface CounterTrack {
  /** The name exactly as the page wrote it — "Blight", "Overload Charges". It is
   *  display text AND half the identity; `counterKey` owns the matching. */
  name: string;
  value: number;
  /** The ceiling, when some page has declared one. Kept on the TRACK and not
   *  only on the step that moved it: `Counter: Blight +1, cap 8` puts the
   *  ceiling on one ability's bullet, and a second, cap-less ability nudging the
   *  same track must not walk it past 8 through the back door. */
  cap?: number;
}

/** Ceiling on any track's value. Not a rule — a bound, so a scripted loop or a
 *  malformed peer cannot put an unbounded integer on a scene snapshot. */
export const MAX_COUNTER_VALUE = 9_999;

/** Tracks one owner may carry. A token's pips are already capped at 64 by the
 *  patch sanitizer; this caps the RECORD, so a body cannot accumulate a new
 *  named currency per round for the life of a campaign. */
export const MAX_COUNTER_TRACKS = 24;

/** Longest name a track may carry, inside the status-tag budget the wire already
 *  enforces on a pip. */
export const MAX_COUNTER_NAME = 40;

/**
 * Two names are the same track when they read the same to a human.
 *
 * A page writes `Counter: Blight +1` and another writes `Counter: blight +1`,
 * and a table that saw two pips would rightly call that a bug. Case and inner
 * whitespace are folded; nothing else is, because "Fear" and "Fear Points" are
 * two currencies and an engine that guessed otherwise would merge them.
 */
export function counterKey(name: string | null | undefined): string {
  return String(name ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

function usableName(name: string | null | undefined): string {
  return String(name ?? "").trim().replace(/\s+/g, " ").slice(0, MAX_COUNTER_NAME);
}

function usableValue(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(MAX_COUNTER_VALUE, Math.trunc(value)));
}

function usableCap(cap: unknown): number | undefined {
  if (typeof cap !== "number" || !Number.isFinite(cap)) return undefined;
  const whole = Math.trunc(cap);
  return whole >= 0 ? Math.min(whole, MAX_COUNTER_VALUE) : undefined;
}

/** A record with nothing to count is not a track. Read by every consumer, so a
 *  malformed peer entry can never become a pip or fire a threshold. */
export function validCounterTrack(track: unknown): track is CounterTrack {
  if (!track || typeof track !== "object") return false;
  const t = track as CounterTrack;
  return typeof t.name === "string" && !!t.name.trim() && t.name.length <= MAX_COUNTER_NAME &&
    Number.isFinite(t.value) && t.value > 0 && t.value <= MAX_COUNTER_VALUE &&
    (t.cap === undefined || (Number.isFinite(t.cap) && t.cap >= 0 && t.cap <= MAX_COUNTER_VALUE));
}

export function findCounter(tracks: readonly CounterTrack[] | undefined, name: string): CounterTrack | null {
  const key = counterKey(name);
  if (!key) return null;
  return (tracks ?? []).find((track) => validCounterTrack(track) && counterKey(track.name) === key) ?? null;
}

/** What a track currently reads. Zero for a track nobody has opened, which is
 *  the same answer as a track that ran back down to zero — deliberately, because
 *  those two states are indistinguishable to a table and must not diverge here. */
export function counterValue(tracks: readonly CounterTrack[] | undefined, name: string): number {
  return findCounter(tracks, name)?.value ?? 0;
}

/**
 * How a track READS — "Blight 3/8", or "Fear Points 3" with no declared ceiling.
 *
 * This is the whole of the visibility story for a token track. A number nobody
 * can see is not a mechanic, and the surface for "something is true of this
 * body" already exists: `VttToken.statuses`, rendered as pips on the map, as
 * chips in the inspector, and in the encounter rows. A counter takes that
 * surface rather than growing a new one beside it.
 *
 * The VALUE rides the tag on purpose, which is the opposite of what
 * `VttConditionClock` chose, and the difference is the point: a clock's
 * remaining rounds are DERIVABLE from the round counter every peer already has,
 * so encoding them in the tag would have put engine bookkeeping on a pip for no
 * gain. A track's value is derivable from nothing. If the tag does not carry it,
 * a player's screen cannot show it at all — and the record beside the scene
 * still exists, still authoritative, because a tag is free text a Curator can
 * retype and a mechanic must not be one keystroke away from reading 30 Blight.
 */
export function counterTag(track: CounterTrack): string {
  const cap = usableCap(track.cap);
  return cap != null ? `${track.name} ${track.value}/${cap}` : `${track.name} ${track.value}`;
}

const TAG_RE = /^(.+?)\s+(\d{1,4})(?:\s*\/\s*(\d{1,4}))?$/;

/**
 * Read a tag back into a track.
 *
 * Reconciliation only — never truth. The record beside the scene is what the
 * engine reasons about; this exists so a reader can tell WHICH pip belongs to a
 * track it is about to move, and so a Curator who cleared the pip by hand can be
 * detected and the orphaned record dropped with it.
 */
export function parseCounterTag(tag: string | null | undefined): CounterTrack | null {
  const m = TAG_RE.exec(String(tag ?? "").trim());
  if (!m) return null;
  const name = usableName(m[1]);
  if (!name) return null;
  const value = usableValue(Number(m[2]));
  if (value <= 0) return null;
  const cap = m[3] ? usableCap(Number(m[3])) : undefined;
  return cap != null ? { name, value, cap } : { name, value };
}

/** Does this status tag name this track? Used to replace one pip in place rather
 *  than appending a second reading of the same number. */
export function isCounterTagFor(tag: string, name: string): boolean {
  const parsed = parseCounterTag(tag);
  return !!parsed && counterKey(parsed.name) === counterKey(name);
}

/**
 * The `At N` values declared for one track, ascending and without duplicates.
 *
 * `parseAbilityEffects` has already bound each threshold to the track declared
 * above it, so this is a filter and not a re-derivation of bullet order — that
 * reasoning happens in the parser and stays there.
 */
export function counterThresholds(steps: readonly EffectStep[], name: string): number[] {
  const key = counterKey(name);
  const found = new Set<number>();
  for (const step of steps) {
    if (step.cadence !== "at-threshold" || step.threshold == null) continue;
    if (counterKey(step.counter) !== key) continue;
    if (!Number.isFinite(step.threshold)) continue;
    found.add(Math.trunc(step.threshold));
  }
  return [...found].sort((a, b) => a - b);
}

/** The steps bound to one `At N` on one track, in page order — the consequences
 *  a crossing hands to the Curator. */
export function stepsAtThreshold(steps: readonly EffectStep[], name: string, at: number): EffectStep[] {
  const key = counterKey(name);
  return steps.filter(
    (step) => step.cadence === "at-threshold" && step.threshold === at && counterKey(step.counter) === key
  );
}

/**
 * Which thresholds a move CROSSED, ascending.
 *
 * The rule is a crossing and not a comparison, and every awkward case falls out
 * of that one choice:
 *
 *  - it fires AT the number, not one before: `from < at <= to`. `At 8` on a
 *    track going 7 → 8 fires; 6 → 7 does not.
 *  - it does NOT re-fire on every later increment. Blight declares `cap 8` and
 *    `At 8: Damage: 1d100`; every further `+1` is clamped to 8, and a rule that
 *    asked `value >= 8` would deal 1d100 every round, forever, to a victim
 *    already sitting at the ceiling. No page in the corpus asks for that, and
 *    the grammar has no word with which to ask — a repeating threshold is a gap
 *    the Curator is told about (`counterGaps`), not a behaviour inferred here.
 *  - it fires AGAIN if the track falls below the number and climbs back. That is
 *    a second genuine crossing, and the alternative — a latch — would need an
 *    "already fired" flag no page declares, which would then have to be
 *    persisted, sent over the wire, and reset by rules nobody has written.
 *  - a move that jumps several at once fires all of them, ascending. A `+5` from
 *    0 past `At 3` and `At 5` owes the table both; skipping the one it flew over
 *    would silently drop a consequence the page declared.
 *  - a downward move fires nothing. `At N` says what ARRIVING costs, and leaving
 *    is not arriving.
 */
export function crossedThresholds(from: number, to: number, thresholds: readonly number[]): number[] {
  if (!(to > from)) return [];
  return [...thresholds].filter((at) => Number.isFinite(at) && from < at && at <= to).sort((a, b) => a - b);
}

/** One move of one track, as a caller states it. */
export interface CounterApplication {
  name: string;
  /** Signed, exactly as the page wrote it. */
  delta: number;
  /** The ceiling this step declares, when it declares one. */
  cap?: number;
  /** The `At N` values watching this track, from the same page. Empty is normal:
   *  a track may simply be a number the table reads. */
  thresholds?: readonly number[];
}

/** What a move WOULD do. Committed by the owner's home, never here — a token
 *  track commits through the authorised vitals writer, a character track through
 *  the sheet's own save path. */
export interface CounterPlan {
  /** The owner's next track list, with a zeroed track dropped entirely. */
  tracks: CounterTrack[];
  name: string;
  from: number;
  to: number;
  cap?: number;
  /** The ceiling refused part of the move. Reported so a card can say "already
   *  at 8" instead of offering a button that silently does nothing. */
  capped: boolean;
  /** Thresholds this move crossed, ascending. */
  crossed: number[];
}

/**
 * Move one track.
 *
 * Returns null only when there is nothing to move — an unnamed counter, a `+0`,
 * or a brand-new track on an owner already at `MAX_COUNTER_TRACKS`. A refusal a
 * caller can report beats a plan that changes nothing and looks like it did.
 */
export function planCounter(
  tracks: readonly CounterTrack[] | undefined,
  application: CounterApplication
): CounterPlan | null {
  const name = usableName(application.name);
  const key = counterKey(name);
  if (!key) return null;
  const delta =
    typeof application.delta === "number" && Number.isFinite(application.delta) ? Math.trunc(application.delta) : 0;
  if (delta === 0) return null;

  const all = (tracks ?? []).filter(validCounterTrack);
  const held = all.find((track) => counterKey(track.name) === key) ?? null;
  const rest = all.filter((track) => counterKey(track.name) !== key);
  // A new track on an owner already carrying the maximum is refused rather than
  // silently evicting one of theirs — losing a Blight count to make room for a
  // Fear count is not a trade any page asked for.
  if (!held && rest.length >= MAX_COUNTER_TRACKS) return null;

  // The step's ceiling wins where it declares one; the track's own is kept where
  // it does not. See `CounterTrack.cap`.
  const cap = usableCap(application.cap) ?? usableCap(held?.cap);
  const from = held?.value ?? 0;
  const ceiling = cap != null ? Math.min(cap, MAX_COUNTER_VALUE) : MAX_COUNTER_VALUE;
  const raw = from + delta;
  const to = Math.max(0, Math.min(ceiling, raw));
  const crossed = crossedThresholds(from, to, application.thresholds ?? []);
  // The NAME the page just wrote wins over the one already stored, so a track
  // opened as "blight" reads as "Blight" the moment a page spells it that way.
  const next: CounterTrack = cap != null ? { name, value: to, cap } : { name, value: to };
  return {
    // A track at zero is dropped, not stored as 0: a pip reading "Blight 0/8"
    // would sit on every body that ever took a single point and never come off
    // again, which is the tag-outlives-the-fight bug condition clocks exist to
    // end. And it would never come off even by accident — `parseCounterTag`
    // refuses a zero reading, so `isCounterTagFor` cannot recognise "Blight 0"
    // as this track's pip, and neither the replace-in-place in
    // `planTokenCounter` nor `pruneCounterTracks` would ever collect it.
    tracks: to > 0 ? [...rest, next] : rest,
    name,
    from,
    to,
    ...(cap != null ? { cap } : {}),
    capped: raw > ceiling,
    crossed,
  };
}

/** Take a track off entirely — the Curator's eraser, and the only decay this
 *  module has, because it is the only one a page can ask for. */
export function clearCounter(tracks: readonly CounterTrack[] | undefined, name: string): CounterTrack[] {
  const key = counterKey(name);
  return (tracks ?? []).filter((track) => validCounterTrack(track) && counterKey(track.name) !== key);
}

/** Set a track by hand. The engine proposes; this is the door a human walks
 *  through when the table has decided the number is something else. */
export function setCounter(
  tracks: readonly CounterTrack[] | undefined,
  name: string,
  value: number,
  cap?: number
): CounterTrack[] {
  const clean = usableName(name);
  if (!clean) return (tracks ?? []).filter(validCounterTrack);
  const held = findCounter(tracks, clean);
  const rest = clearCounter(tracks, clean);
  const ceiling = usableCap(cap) ?? usableCap(held?.cap);
  const next = usableValue(ceiling != null ? Math.min(value, ceiling) : value);
  if (next <= 0) return rest;
  if (rest.length >= MAX_COUNTER_TRACKS) return rest;
  return [...rest, ceiling != null ? { name: clean, value: next, cap: ceiling } : { name: clean, value: next }];
}

/**
 * What a page asked for that this runtime will not do, in the Curator's words.
 *
 * Reporting is the deliverable here, not a fallback. A block whose prose says a
 * track "resets each encounter" and whose bullets cannot say it has declared a
 * rule the engine will not keep, and the honest response is to name that rule —
 * not to invent a decay schedule and let the table discover it mid-fight.
 */
export function counterGaps(steps: readonly EffectStep[]): string[] {
  const gaps: string[] = [];
  const names = new Map<string, string>();
  for (const step of steps) {
    if (step.verb !== "counter" || !step.counter) continue;
    const key = counterKey(step.counter);
    if (!names.has(key)) names.set(key, step.counter);
  }
  for (const [key, name] of names) {
    const declaredMarks = counterThresholds(steps, name);
    if (!declaredMarks.length) continue;
    // A mark AT OR BELOW ZERO can never be arrived at. `crossedThresholds` fires
    // on `from < at`, and zero is this module's floor — a track that reaches it
    // is dropped — so nothing can ever be below a mark of 0 and climb to it.
    //
    // Reported rather than quietly ignored, and this is the case that forced the
    // split: Radiant's Energy Bleed says "At 0 charges, gain +1 ADA", so a
    // Curator transcribing that page writes `At 0:` and the block parses without
    // a single error. Saying "Overload Charges fires at 0 once per crossing" for
    // a mark that fires never is the engine affirming a rule it does not keep —
    // worse than silence, because the Curator stops watching for it.
    const thresholds = declaredMarks.filter((at) => at > 0);
    const unreachable = declaredMarks.filter((at) => at <= 0);
    if (unreachable.length) {
      gaps.push(
        `${name} declares a mark at ${unreachable.join(", ")}, and nothing here will fire it: a mark fires on ARRIVING, and a track's floor is zero — it cannot be below ${unreachable[unreachable.length - 1]} and climb to it. A rule that fires on the way down, or on emptying, is one the grammar has no word for. The Curator's call.`
      );
    }
    if (!thresholds.length) continue;
    const atCap = steps.some(
      (step) =>
        step.verb === "counter" &&
        counterKey(step.counter) === key &&
        step.cap != null &&
        thresholds.includes(step.cap)
    );
    gaps.push(
      atCap
        ? // The corpus's own shape — Blight caps at 8 and fires at 8 — so the
          // crossing rule is the whole difference between "once" and "every
          // round for the rest of the fight". The table is told which it gets.
          `${name} fires at ${thresholds.join(", ")} once per crossing, and the cap holds it there. The grammar cannot declare a repeat or a decay, so it stays at ${thresholds[thresholds.length - 1]} until someone clears it — the Curator's call.`
        : `${name} fires at ${thresholds.join(", ")} once per crossing, and never decays on its own — the grammar has no word for a reset. The Curator decides when it clears.`
    );
  }
  return gaps;
}
