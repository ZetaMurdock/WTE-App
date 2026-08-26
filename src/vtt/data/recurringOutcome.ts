// A round of a burning field becomes a Resolution Card.
//
// This is the join between the two halves of the arc. `RecurringEffectSystem`
// works out who is standing in what this round and refuses to do anything about
// it; `outcomeLedger` owns the card where a validated roll becomes an applied
// consequence and a human confirms every write. Nothing new is invented here —
// the whole point is that a recurring save is not a new KIND of resolution, so
// it must not grow a second path with its own rules about what may auto-apply.
//
// ONE CARD PER FIELD PER ROUND, not one per token. The ledger learned to carry
// several targets under one shared DV for area abilities, and a field is the
// same shape: one template, one save, everyone inside it. Splitting a 6-token
// zone into 6 sibling cards would make the Curator confirm the same field six
// times a round — the point at which "confirm everything" stops being
// sovereignty and starts being an obstacle people route around.
import type { RecurringProposal } from "../engine/systems/RecurringEffectSystem";
import type { VttEffectTick } from "../types/scene";
import { openOutcome, type OutcomeConsequence, type PendingOutcome } from "./outcomeLedger";

/**
 * What a round's ticks cost the tokens in the field.
 *
 * Marked `declared: true`, and the claim is true: every tick came off a page's
 * `## Actions` block, which is the only source `autoApplicable` will commit
 * without a click. That gate stays exactly where it is — a table that never set
 * `autoApplyDeclared` still confirms each round by hand, and a `ruling` is never
 * auto-applied at all, because a ruling is the page asking a human a question.
 *
 * The gate itself contributes nothing: it is the roll, not a thing that lands.
 */
export function consequencesFromTicks(ticks: readonly VttEffectTick[]): OutcomeConsequence[] {
  const out: OutcomeConsequence[] = [];
  for (const tick of ticks) {
    if (tick.kind === "save") continue;
    out.push({
      id: tick.id,
      kind: tick.kind,
      label: tick.label,
      on: tick.on,
      ...(tick.expr ? { expr: tick.expr } : {}),
      ...(tick.damageType ? { damageType: tick.damageType } : {}),
      ...(tick.condition ? { condition: tick.condition } : {}),
      ...(tick.rounds != null ? { rounds: tick.rounds } : {}),
      ...(tick.half ? { half: true } : {}),
      declared: true,
    });
  }
  return out;
}

/** Proposals from one round, split into the cards they belong on. */
export function groupProposals(proposals: readonly RecurringProposal[]): RecurringProposal[][] {
  const byEffect = new Map<string, RecurringProposal[]>();
  for (const proposal of proposals) {
    const key = `${proposal.effectId}:${proposal.round}`;
    const bucket = byEffect.get(key);
    if (bucket) bucket.push(proposal);
    else byEffect.set(key, [proposal]);
  }
  return [...byEffect.values()];
}

/**
 * The card one field's round opens.
 *
 * `openOutcome` derives consequences from an ability's steps or its prose, and a
 * placed template has neither — the ability that made it is long out of scope,
 * which is the entire reason `VttEffectTick` exists. So the card is opened for
 * its targets, its DV and its identity, and its consequences are replaced with
 * the ones the ticks carry. Replacing rather than reaching into the ledger keeps
 * the derivation rules in one file: this module never decides what a consequence
 * MEANS, only which list of them this card is holding.
 */
export function outcomeFromProposals(
  proposals: readonly RecurringProposal[],
  now: number,
  ttlMs?: number
): PendingOutcome | null {
  const first = proposals[0];
  if (!first) return null;
  const gate = first.gate;
  const name = first.sourceAbilityName || "Lingering effect";
  const base = openOutcome({
    // Effect + round, so the same round delivered twice lands on the card that
    // already exists instead of stacking a duplicate beside it.
    id: `rt-${first.effectId}-${first.round}`,
    sourceAbilityId: first.sourceAbilityId || first.effectId,
    sourceAbilityName: name,
    casterCharacterId: first.casterCharacterId,
    targets: proposals.map((proposal) => ({
      id: proposal.tokenId,
      tokenId: proposal.tokenId,
      name: proposal.tokenName,
    })),
    ...(gate?.dv != null ? { dc: gate.dv } : {}),
    // The round is on the label because a card that read only "Absolute Zero"
    // gives a Curator holding two of them no way to tell this round's from the
    // one they have not cleared yet.
    rollLabel: gate ? `${gate.label} · round ${first.round}` : `${name} · round ${first.round}`,
    now,
    ttlMs,
  });
  return {
    ...base,
    // The block said this, so the card says the block said it — the flag drives
    // the "declared" reading in the UI and the auto-apply gate alike.
    fromBlock: true,
    consequences: consequencesFromTicks(first.ticks),
  };
}

/** Every card a round's proposals open, in effect order. */
export function outcomesFromProposals(
  proposals: readonly RecurringProposal[],
  now: number,
  ttlMs?: number
): PendingOutcome[] {
  const cards: PendingOutcome[] = [];
  for (const group of groupProposals(proposals)) {
    const card = outcomeFromProposals(group, now, ttlMs);
    if (card) cards.push(card);
  }
  return cards;
}
