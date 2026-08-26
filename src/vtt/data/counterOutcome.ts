// A track reaching its number becomes a Resolution Card.
//
// This is the join for the `Counter` half of the arc, and it is the same join
// `recurringOutcome` makes for the `Each round:` half: something happened away
// from the dice, and what it costs still has to reach a human before it reaches
// a token. `At 8: Damage: 1d100` is an ordinary consequence that happens to be
// armed by an integer instead of a verdict, so it goes down the ordinary path —
// one card, one Curator, one authorised write — rather than growing a second way
// to apply damage with its own rules about what may commit unattended.
//
// The card is UNROLLED. Nothing was thrown for it and nothing will be; see
// `PendingOutcome.unrolled` for what that changes and, more to the point, what
// it does not: a `ruling` still waits for a human, `autoApplyDeclared` is still
// the only thing that commits a row without a click, and the table that never
// opted in still confirms every one of these by hand.
import {
  openOutcome,
  type OutcomeConsequence,
  type OutcomeTarget,
  type PendingOutcome,
} from "./outcomeLedger";

/** One crossing, as the applier reports it. */
export interface CounterCrossing {
  /** The card whose Apply moved the track — the crossing's provenance. */
  outcome: PendingOutcome;
  /** The body (or the character row) the track belongs to. */
  target: OutcomeTarget;
  /** The counter row that was applied. Its `thresholds` carry what each mark
   *  owes; nothing here re-reads the page, which is long out of scope. */
  consequence: OutcomeConsequence;
  /** The marks this move crossed, ascending — `crossedThresholds`' answer. */
  crossed: readonly number[];
  /** Where the track ended up, for the line the card puts on screen. */
  value: number;
  now: number;
  ttlMs?: number;
}

/**
 * Every crossed mark's consequences, in one list.
 *
 * Ids are namespaced by the mark. Two marks crossed in one jump — a `+5` past
 * `At 3` and `At 5` — can easily declare the same shape twice, and without the
 * prefix the second `dmg-0` would collide with the first: the card's `applied`
 * list is keyed by consequence id, so committing the 3-damage would have marked
 * the 5-damage applied and hidden it.
 */
export function consequencesFromCrossing(
  consequence: OutcomeConsequence,
  crossed: readonly number[]
): OutcomeConsequence[] {
  const out: OutcomeConsequence[] = [];
  for (const at of [...crossed].sort((a, b) => a - b)) {
    const threshold = consequence.thresholds?.find((entry) => entry.at === at);
    if (!threshold) continue;
    for (const inner of threshold.consequences) {
      out.push({ ...inner, id: `t${at}-${inner.id}`, label: `At ${at} · ${inner.label}` });
    }
  }
  return out;
}

/**
 * The card a crossing opens, or null when the marks it crossed owe nothing.
 *
 * Null rather than an empty card on purpose: a track ticking past a mark whose
 * steps the deriver could not read has nothing to offer a Curator, and a card
 * with no rows on it is a notification pretending to be a decision.
 *
 * The id is derived from the row that moved the track — card, target and
 * consequence — which is the same key the ledger's `applied` list uses. So a
 * duplicate delivery lands on the card that already exists instead of stacking a
 * second copy beside it, and a LATER genuine crossing from a different ability
 * gets its own card because it came off a different row.
 */
export function outcomeFromCrossing(crossing: CounterCrossing): PendingOutcome | null {
  const { outcome, target, consequence, crossed, value } = crossing;
  const name = consequence.counter?.trim();
  if (!name || !crossed.length) return null;
  const consequences = consequencesFromCrossing(consequence, crossed);
  if (!consequences.length) return null;

  const marks = [...crossed].sort((a, b) => a - b);
  const base = openOutcome({
    id: `ct-${outcome.id}-${target.id}-${consequence.id}`,
    // The crossing belongs to the ability that moved the track. A card naming
    // the track alone would leave the Curator with "Blight reached 8" and no way
    // to tell which of three Stygians on the map put it there.
    sourceAbilityId: outcome.sourceAbilityId,
    sourceAbilityName: outcome.sourceAbilityName,
    casterCharacterId: outcome.casterCharacterId,
    targets: [{ tokenId: target.tokenId, id: target.id, name: target.name }],
    // Where the track ENDED rides the label when it is past the mark it fired.
    // A `+5` through `At 3` leaves the body on 5, and a card reading only
    // "Fear reached 3" would send the Curator to the pip to find out the rest.
    rollLabel:
      value > marks[marks.length - 1]
        ? `${name} reached ${marks.join(" and ")} — now ${value}`
        : `${name} reached ${marks.join(" and ")}`,
    now: crossing.now,
    ttlMs: crossing.ttlMs,
  });
  return {
    ...base,
    // The page said this, so the card says the page said it — the flag drives
    // both the "declared" reading in the UI and the auto-apply gate.
    fromBlock: true,
    unrolled: true,
    consequences,
  };
}

/** How a crossing reads in a toast — the one line a Curator sees even if they
 *  never open the card. A track that moved without crossing anything says so
 *  too, because "Blight 4/8" is the information the table wanted. */
export function crossingLine(name: string, value: number, cap: number | undefined, crossed: readonly number[]): string {
  const reading = cap != null ? `${name} ${value}/${cap}` : `${name} ${value}`;
  if (!crossed.length) return reading;
  const marks = [...crossed].sort((a, b) => a - b);
  return `${reading} — reached ${marks.join(", ")}`;
}
