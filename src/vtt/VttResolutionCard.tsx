import { useEffect, useRef, useState } from "react";
import {
  armedConsequences,
  autoApplicable,
  conditionTag,
  damageAfterVerdict,
  type OutcomeConsequence,
  type PendingOutcome,
} from "./data/outcomeLedger";

export interface VttResolutionCardProps {
  outcomes: PendingOutcome[];
  /** The table opted into committing DECLARED damage and conditions without a
   *  click. Everything the engine had to guess, and every Curator ruling, still
   *  waits for one — see `autoApplicable`. */
  autoApplyDeclared?: boolean;
  /** Roll this consequence's dice. Returns the rolled total, or null if it could not roll. */
  onRoll: (outcome: PendingOutcome, consequence: OutcomeConsequence) => number | null;
  /** Apply HP change to the target token. `amount` is positive for damage, negative for healing. */
  onApplyDamage: (outcome: PendingOutcome, consequence: OutcomeConsequence, amount: number) => void;
  /** Apply the condition tag to the target token's statuses. */
  onApplyCondition: (outcome: PendingOutcome, consequence: OutcomeConsequence) => void;
  /** Curator declares a verdict by hand — for rulings, and to override a roll. */
  onDeclare: (outcome: PendingOutcome, verdict: "pass" | "fail") => void;
  onDismiss: (outcomeId: string) => void;
}

/** Rolled totals live here and not in the ledger: a total is the Curator's
 *  working number until they press Apply, and a ledger that stored it would
 *  have to be re-broadcast for a roll nobody committed to. */
type RolledTotals = Record<string, number | null>;

/** What each row actually committed, unsigned. Read back only for the badge:
 *  the magnitude cannot be re-derived once the verdict moves, and a badge that
 *  said "Applied −13 HP" for a 27 the Curator already sent would be the card
 *  lying about a thing it did. */
type CommittedTotals = Record<string, number>;

function rowKey(outcome: PendingOutcome, consequence: OutcomeConsequence): string {
  return `${outcome.id}|${consequence.id}`;
}

/** Where this row came from.
 *
 *  A card offering "3d10 Cold" looks identical whether an author declared it in
 *  an `## Actions` block or the prose scanner recovered it from a sentence, and
 *  the two carry very different weight: the first is the page's own word, the
 *  second is a reading of it that a Curator may want to check. It is also the
 *  line auto-apply is drawn along, so a table that switched auto-apply on can
 *  see at a glance which rows it covers. Only the declared side is marked —
 *  labelling every prose row would put a badge on the entire shipped corpus. */
function SourceChip({ consequence }: { consequence: OutcomeConsequence }) {
  if (!consequence.declared) return null;
  return (
    <span className="vtt2-res-src" title="Declared in this ability's ## Actions block, not read out of its prose">
      declared
    </span>
  );
}

/** "Physical Save — Recovery · 14 vs DV 18 — failed" — the whole resolution in
 *  one line, so the card never makes the table reconstruct why it is offering
 *  what it is offering. */
function resolutionLine(outcome: PendingOutcome): string {
  const verdict =
    outcome.verdict === "pass" ? "passed" : outcome.verdict === "fail" ? "failed" : "waiting on the roll";
  const parts = [outcome.rollLabel];
  if (outcome.rollTotal != null && outcome.dc != null) parts.push(`${outcome.rollTotal} vs DV ${outcome.dc}`);
  else if (outcome.rollTotal != null) parts.push(String(outcome.rollTotal));
  else if (outcome.dc != null) parts.push(`vs DV ${outcome.dc}`);
  return `${parts.join(" · ")} — ${verdict}`;
}

/** The sign belongs in the button, not in the caller's head: HP moves down for
 *  damage and up for healing, and the Curator confirms the direction they read. */
function hpLabel(kind: OutcomeConsequence["kind"], magnitude: number): string {
  return kind === "heal" ? `+${magnitude} HP` : `−${magnitude} HP`;
}

interface RowProps {
  outcome: PendingOutcome;
  consequence: OutcomeConsequence;
  /** Undefined = not rolled yet; null = the roll could not be made. */
  total: number | null | undefined;
  /** The magnitude this row sent, when it was this session that sent it. */
  committed: number | undefined;
  onRoll: () => void;
  onApplyDamage: (amount: number) => void;
  onApplyCondition: () => void;
}

// Row and Card are module-level, not nested in the card body: a component
// declared inside a render is a new type every render, so pressing Roll would
// remount the whole card and drop the Curator's keyboard focus mid-resolution.
function ConsequenceRow({
  outcome,
  consequence,
  total,
  committed,
  onRoll,
  onApplyDamage,
  onApplyCondition,
}: RowProps) {
  const applied = outcome.applied.includes(consequence.id);

  if (consequence.kind === "ruling") {
    return (
      <li className="vtt2-res-row">
        <div className="vtt2-res-ruling">“{consequence.label}”</div>
        <SourceChip consequence={consequence} />
        <div className="vtt2-res-note">
          {consequence.declared
            ? "Curator adjudicates — the page asked for a ruling, not a number."
            : "Curator adjudicates — the prose names no number to apply."}
        </div>
      </li>
    );
  }

  if (consequence.kind === "condition") {
    const tag = conditionTag(consequence);
    return (
      <li className="vtt2-res-row">
        <span className="vtt2-res-label">{consequence.label}</span>
        <SourceChip consequence={consequence} />
        {applied ? (
          <span className="vtt2-res-applied">Applied {tag}</span>
        ) : (
          <button
            type="button"
            className="vtt2-res-btn"
            onClick={onApplyCondition}
            title={`Add the ${tag} tag to ${outcome.targetName}`}
          >
            Apply {tag}
          </button>
        )}
      </li>
    );
  }

  // The ledger's `applied` list is the only thing between a committed hit and a
  // second one, so it is read BEFORE the dice: the rolled total lives in this
  // component, and the panel unmounts whenever the Curator switches tools — a
  // row that keyed "already applied" off a local total would come back from a
  // remount offering Roll again on damage the target had already taken.
  if (applied) {
    return (
      <li className="vtt2-res-row">
        <span className="vtt2-res-label">{consequence.label}</span>
        <SourceChip consequence={consequence} />
        <span className="vtt2-res-applied">
          {committed == null ? "Applied" : `Applied ${hpLabel(consequence.kind, committed)}`}
        </span>
      </li>
    );
  }

  // A halved rider is shown as the halving, not as a smaller number that
  // appeared from nowhere — the table can check the arithmetic.
  const halved = outcome.verdict === "pass" && consequence.half === true;
  const magnitude = typeof total === "number" ? damageAfterVerdict(outcome, consequence, total) : null;

  return (
    <li className="vtt2-res-row">
      <span className="vtt2-res-label">{consequence.label}</span>
      <SourceChip consequence={consequence} />
      {total === null && <span className="equip-warn">Could not roll {consequence.expr ?? consequence.label}.</span>}
      {magnitude == null ? (
        <button
          type="button"
          className="vtt2-res-btn"
          onClick={onRoll}
          title={`Roll ${consequence.expr ?? consequence.label} for ${outcome.targetName}`}
        >
          Roll {consequence.label}
        </button>
      ) : (
        <>
          <span className="vtt2-res-rolled">
            Rolled {total}
            {halved ? " · half on a success" : ""}
          </span>
          <button
            type="button"
            className="vtt2-res-btn strong"
            onClick={() => onApplyDamage(consequence.kind === "heal" ? -magnitude : magnitude)}
            title={`${consequence.kind === "heal" ? "Heal" : "Damage"} ${outcome.targetName} by ${magnitude}`}
          >
            Apply {hpLabel(consequence.kind, magnitude)}
          </button>
        </>
      )}
    </li>
  );
}

interface CardProps extends Omit<VttResolutionCardProps, "outcomes" | "onRoll" | "autoApplyDeclared"> {
  outcome: PendingOutcome;
  rolled: RolledTotals;
  committed: CommittedTotals;
  onRollRow: (outcome: PendingOutcome, consequence: OutcomeConsequence) => void;
}

function OutcomeCard({
  outcome,
  rolled,
  committed,
  onRollRow,
  onApplyDamage,
  onApplyCondition,
  onDeclare,
  onDismiss,
}: CardProps) {
  const armed = armedConsequences(outcome);
  return (
    <div className="vtt2-res-card">
      <div className="vtt2-insp-head">
        <span className="vtt2-res-title">
          {outcome.sourceAbilityName} → {outcome.targetName}
        </span>
        {/* "×" is not a name a screen reader can act on, and `title` alone is
            the weakest source of one. Say whose card is being discarded. */}
        <button
          type="button"
          className="cdx-tab-x"
          onClick={() => onDismiss(outcome.id)}
          title="Dismiss without applying"
          aria-label={`Dismiss ${outcome.sourceAbilityName} on ${outcome.targetName} without applying it`}
        >
          ×
        </button>
      </div>

      <div className="vtt2-res-line">{resolutionLine(outcome)}</div>

      {outcome.verdict === "pending" ? (
        <p className="list-empty vtt2-res-note">Waiting on the roll — or declare it below.</p>
      ) : armed.length === 0 ? (
        <p className="list-empty vtt2-res-note">
          {outcome.verdict === "pass"
            ? "Nothing to apply — the save held."
            : outcome.fromBlock
              ? "Nothing to apply — this ability's page declares nothing for a failure."
              : "Nothing to apply — this ability's prose names no consequence."}
        </p>
      ) : (
        <ul className="vtt2-res-list">
          {armed.map((consequence) => (
            <ConsequenceRow
              key={consequence.id}
              outcome={outcome}
              consequence={consequence}
              total={rolled[rowKey(outcome, consequence)]}
              committed={committed[rowKey(outcome, consequence)]}
              onRoll={() => onRollRow(outcome, consequence)}
              onApplyDamage={(amount) => onApplyDamage(outcome, consequence, amount)}
              onApplyCondition={() => onApplyCondition(outcome, consequence)}
            />
          ))}
        </ul>
      )}

      {/* Always offered, settled or not: tables that roll physically at the
          table need a way in, and a card with no exit is worse than no card. */}
      <div className="vtt2-res-declare" role="group" aria-label={`Declare the verdict for ${outcome.targetName}`}>
        <button
          type="button"
          className="vtt2-res-btn"
          aria-pressed={outcome.verdict === "pass"}
          onClick={() => onDeclare(outcome, "pass")}
        >
          {outcome.targetName} passed
        </button>
        <button
          type="button"
          className="vtt2-res-btn"
          aria-pressed={outcome.verdict === "fail"}
          onClick={() => onDeclare(outcome, "fail")}
        >
          {outcome.targetName} failed
        </button>
      </div>
    </div>
  );
}

// The Curator-facing end of the outcome ledger: a settled roll, the consequences
// its verdict armed, and one button per consequence that says what it will do.
//
// Proposes only. Every button here calls back out to VttScreen, which applies
// through the same validated ops a manual token edit uses — nothing on this card
// writes to a token, and nothing fires without a click.
export function VttResolutionCard({
  outcomes,
  autoApplyDeclared = false,
  onRoll,
  onApplyDamage,
  onApplyCondition,
  onDeclare,
  onDismiss,
}: VttResolutionCardProps) {
  const [rolled, setRolled] = useState<RolledTotals>({});
  const [committed, setCommitted] = useState<CommittedTotals>({});

  // Rows this component already committed without a click.
  //
  // The ledger's `applied` list is the authority on what landed, and
  // `autoApplicable` filters against it — but it only fills in once the engine
  // AUTHORISES the op. A write the engine refuses (the token left the scene, it
  // is player-owned and `updateToken` will not have it) never marks anything
  // applied, so a guard that trusted `applied` alone would re-roll and re-send
  // that same consequence on every render for as long as the card was open.
  const autoFired = useRef<Set<string>>(new Set());

  // No dependency list on purpose. A verdict can arrive from the wire, from the
  // Curator's own Declare buttons, or from a local roll settling the request,
  // and each reaches this component as a fresh ledger snapshot rather than as a
  // value worth listing. The guard above — not the dependency array — is what
  // makes a consequence fire exactly once.
  useEffect(() => {
    for (const outcome of outcomes) {
      for (const consequence of autoApplicable(outcome, { autoApplyDeclared })) {
        const key = rowKey(outcome, consequence);
        if (autoFired.current.has(key)) continue;
        autoFired.current.add(key);
        if (consequence.kind === "condition") {
          onApplyCondition(outcome, consequence);
          continue;
        }
        const total = rollRow(outcome, consequence);
        // Dice nothing could read leave the row exactly as a Curator would find
        // it — armed, with its Roll button, and no number invented in its place.
        if (total == null) continue;
        const magnitude = damageAfterVerdict(outcome, consequence, total);
        applyRow(outcome, consequence, consequence.kind === "heal" ? -magnitude : magnitude);
      }
    }
  });

  if (outcomes.length === 0) return null;

  // Sorted here rather than trusted from the caller: the ledger keeps newest
  // first, but this card is also rendered from filtered slices, and an outcome
  // the Curator just caused appearing below a stale one reads as a bug.
  const ordered = [...outcomes].sort((a, b) => b.createdAt - a.createdAt);

  function rollRow(outcome: PendingOutcome, consequence: OutcomeConsequence): number | null {
    const total = onRoll(outcome, consequence);
    setRolled((prior) => ({ ...prior, [rowKey(outcome, consequence)]: total }));
    return total;
  }

  function applyRow(outcome: PendingOutcome, consequence: OutcomeConsequence, amount: number) {
    onApplyDamage(outcome, consequence, amount);
    setCommitted((prior) => ({ ...prior, [rowKey(outcome, consequence)]: Math.abs(amount) }));
  }

  return (
    // A labelled region, because these cards float over the map with no heading
    // above them: without a name, the only way to find them by keyboard is to
    // tab through every control on the stage and recognise them by accident.
    <div className="vtt2-resolutions" role="region" aria-label="Resolutions awaiting the Curator">
      {ordered.map((outcome) => (
        <OutcomeCard
          key={outcome.id}
          outcome={outcome}
          rolled={rolled}
          committed={committed}
          onRollRow={rollRow}
          onApplyDamage={applyRow}
          onApplyCondition={onApplyCondition}
          onDeclare={onDeclare}
          onDismiss={onDismiss}
        />
      ))}
    </div>
  );
}
