import { useEffect, useRef, useState } from "react";
import {
  armedConsequences,
  autoApplicable,
  batchPlan,
  conditionTag,
  damageAfterVerdict,
  outcomeTally,
  pendingRulings,
  type DamageRollMode,
  type OutcomeConsequence,
  type OutcomeTarget,
  type PendingOutcome,
} from "./data/outcomeLedger";

export interface VttResolutionCardProps {
  outcomes: PendingOutcome[];
  /** The table opted into committing DECLARED damage and conditions without a
   *  click. Everything the engine had to guess, and every Curator ruling, still
   *  waits for one — see `autoApplicable`. */
  autoApplyDeclared?: boolean;
  /** Roll this consequence's dice. Returns the rolled total, or null if it could not roll.
   *  Deliberately target-free: the dice belong to the ability and the roll is
   *  filed under its CASTER, so a shared roll and a per-target roll ask for the
   *  same thing and only differ in how many times the card asks. */
  onRoll: (outcome: PendingOutcome, consequence: OutcomeConsequence) => number | null;
  /** Apply HP change to one target's token. `amount` is positive for damage, negative for healing. */
  onApplyDamage: (
    outcome: PendingOutcome,
    target: OutcomeTarget,
    consequence: OutcomeConsequence,
    amount: number
  ) => void;
  /** Apply the condition tag to one target's token statuses. */
  onApplyCondition: (outcome: PendingOutcome, target: OutcomeTarget, consequence: OutcomeConsequence) => void;
  /** Curator declares one target's verdict by hand — for rulings, for a target
   *  they rule immune, and to override a roll. */
  onDeclare: (outcome: PendingOutcome, target: OutcomeTarget, verdict: "pass" | "fail") => void;
  /** Curator says whether the damage is one roll or one each. */
  onSetDamageRoll: (outcome: PendingOutcome, mode: DamageRollMode) => void;
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

/**
 * Where a rolled total is filed.
 *
 * In `shared` mode every target reads and writes ONE slot, which is the entire
 * mechanism: rolling for the first target fills the number in for all 23, and
 * the card shows the same total on every row because it IS the same total.
 * Switching modes changes the key, so a per-target number can never leak into a
 * shared row and be mistaken for everyone's.
 */
function rollKey(outcome: PendingOutcome, target: OutcomeTarget, consequence: OutcomeConsequence): string {
  if (outcome.damageRoll === "shared") return `${outcome.id}|~shared|${consequence.id}`;
  return `${outcome.id}|${target.id}|${consequence.id}`;
}

/** What a target committed is always the target's own, even under one shared
 *  roll — a target that passed took half of it and its badge must say so. */
function committedKey(outcome: PendingOutcome, target: OutcomeTarget, consequence: OutcomeConsequence): string {
  return `${outcome.id}|${target.id}|${consequence.id}`;
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
function resolutionLine(outcome: PendingOutcome, target: OutcomeTarget): string {
  const verdict =
    target.verdict === "pass"
      ? "passed"
      : target.verdict === "fail"
        ? "failed"
        : target.lapsedRound != null
          ? `never rolled — outstanding since round ${target.lapsedRound}`
          : "waiting on the roll";
  const parts = [outcome.rollLabel];
  if (target.rollTotal != null && outcome.dc != null) parts.push(`${target.rollTotal} vs DV ${outcome.dc}`);
  else if (target.rollTotal != null) parts.push(String(target.rollTotal));
  else if (outcome.dc != null) parts.push(`vs DV ${outcome.dc}`);
  return `${parts.join(" · ")} — ${verdict}`;
}

/** The shape of a partly-resolved batch in one readable line. Every clause is a
 *  count from `outcomeTally`, so what the header says and what the batch button
 *  will touch are computed from the same place. */
function tallyLine(outcome: PendingOutcome): string {
  const tally = outcomeTally(outcome);
  const parts: string[] = [];
  if (tally.failed) parts.push(`${tally.failed} of ${tally.live} failed`);
  if (tally.passed) parts.push(`${tally.passed} passed`);
  if (tally.undecided) parts.push(`${tally.undecided} rolled — no DV to judge`);
  if (tally.waiting) parts.push(`${tally.waiting} still to roll`);
  if (tally.lapsed) parts.push(`${tally.lapsed} never rolled`);
  if (tally.removed) parts.push(`${tally.removed} left the scene`);
  return parts.join(" · ") || `${tally.live} targets`;
}

/** The earliest round a target has been outstanding since — the number the
 *  partial-resolution notice quotes. */
function lapsedSince(outcome: PendingOutcome): number | null {
  const rounds = outcome.targets
    .filter((target) => !target.removed && target.lapsedRound != null)
    .map((target) => target.lapsedRound as number);
  return rounds.length ? Math.min(...rounds) : null;
}

/** The sign belongs in the button, not in the caller's head: HP moves down for
 *  damage and up for healing, and the Curator confirms the direction they read. */
function hpLabel(kind: OutcomeConsequence["kind"], magnitude: number): string {
  return kind === "heal" ? `+${magnitude} HP` : `−${magnitude} HP`;
}

function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many;
}

interface RowProps {
  outcome: PendingOutcome;
  target: OutcomeTarget;
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
  target,
  consequence,
  total,
  committed,
  onRoll,
  onApplyDamage,
  onApplyCondition,
}: RowProps) {
  const applied = target.applied.includes(consequence.id);

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
            title={`Add the ${tag} tag to ${target.name}`}
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
  const halved = target.verdict === "pass" && consequence.half === true;
  const magnitude = typeof total === "number" ? damageAfterVerdict(target, consequence, total) : null;
  const shared = outcome.damageRoll === "shared" && outcome.targets.length > 1;

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
          title={
            shared
              ? `Roll ${consequence.expr ?? consequence.label} once for every target`
              : `Roll ${consequence.expr ?? consequence.label} for ${target.name}`
          }
        >
          Roll {consequence.label}
        </button>
      ) : (
        <>
          <span className="vtt2-res-rolled">
            Rolled {total}
            {shared ? " · shared" : ""}
            {halved ? " · half on a success" : ""}
          </span>
          <button
            type="button"
            className="vtt2-res-btn strong"
            onClick={() => onApplyDamage(consequence.kind === "heal" ? -magnitude : magnitude)}
            title={`${consequence.kind === "heal" ? "Heal" : "Damage"} ${target.name} by ${magnitude}`}
          >
            Apply {hpLabel(consequence.kind, magnitude)}
          </button>
        </>
      )}
    </li>
  );
}

interface TargetBlockProps {
  outcome: PendingOutcome;
  target: OutcomeTarget;
  /** A one-target card is the card the app has always shown, so it keeps the
   *  bare layout: no name heading above a resolution line that already names
   *  the only creature involved. */
  solo: boolean;
  rolled: RolledTotals;
  committed: CommittedTotals;
  onRollRow: (outcome: PendingOutcome, target: OutcomeTarget, consequence: OutcomeConsequence) => void;
  onApplyDamage: (
    outcome: PendingOutcome,
    target: OutcomeTarget,
    consequence: OutcomeConsequence,
    amount: number
  ) => void;
  onApplyCondition: (outcome: PendingOutcome, target: OutcomeTarget, consequence: OutcomeConsequence) => void;
  onDeclare: (outcome: PendingOutcome, target: OutcomeTarget, verdict: "pass" | "fail") => void;
}

function TargetBlock({
  outcome,
  target,
  solo,
  rolled,
  committed,
  onRollRow,
  onApplyDamage,
  onApplyCondition,
  onDeclare,
}: TargetBlockProps) {
  const armed = armedConsequences(outcome, target);
  return (
    <div className={`vtt2-res-target${target.removed ? " gone" : ""}`}>
      {!solo && <div className="vtt2-res-tname">{target.name}</div>}
      <div className="vtt2-res-line">{resolutionLine(outcome, target)}</div>

      {/* Said before anything else on the row, because it is the reason every
          button below it is going to be refused. */}
      {target.removed ? (
        <p className="list-empty vtt2-res-note">
          {target.name} is no longer on this scene — nothing here can be applied to them.
        </p>
      ) : target.verdict === "pending" ? (
        <p className="list-empty vtt2-res-note">
          {target.lapsedRound != null
            ? `The round moved on without an answer. Nothing was applied — roll late, or declare it below.`
            : "Waiting on the roll — or declare it below."}
        </p>
      ) : armed.length === 0 ? (
        <p className="list-empty vtt2-res-note">
          {target.verdict === "pass"
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
              target={target}
              consequence={consequence}
              total={rolled[rollKey(outcome, target, consequence)]}
              committed={committed[committedKey(outcome, target, consequence)]}
              onRoll={() => onRollRow(outcome, target, consequence)}
              onApplyDamage={(amount) => onApplyDamage(outcome, target, consequence, amount)}
              onApplyCondition={() => onApplyCondition(outcome, target, consequence)}
            />
          ))}
        </ul>
      )}

      {/* Always offered, settled or not: tables that roll physically at the
          table need a way in, and a card with no exit is worse than no card.
          Still offered per target in a batch — the one target the Curator rules
          immune is exactly the case a batch must not take away from them. */}
      {!target.removed && (
        <div className="vtt2-res-declare" role="group" aria-label={`Declare the verdict for ${target.name}`}>
          <button
            type="button"
            className="vtt2-res-btn"
            aria-pressed={target.verdict === "pass"}
            onClick={() => onDeclare(outcome, target, "pass")}
          >
            {target.name} passed
          </button>
          <button
            type="button"
            className="vtt2-res-btn"
            aria-pressed={target.verdict === "fail"}
            onClick={() => onDeclare(outcome, target, "fail")}
          >
            {target.name} failed
          </button>
        </div>
      )}
    </div>
  );
}

interface CardProps extends Omit<VttResolutionCardProps, "outcomes" | "onRoll" | "autoApplyDeclared"> {
  outcome: PendingOutcome;
  rolled: RolledTotals;
  committed: CommittedTotals;
  onRollRow: (outcome: PendingOutcome, target: OutcomeTarget, consequence: OutcomeConsequence) => void;
  onApplyBatch: (outcome: PendingOutcome, verdict: "fail" | "pass") => void;
}

function OutcomeCard({
  outcome,
  rolled,
  committed,
  onRollRow,
  onApplyDamage,
  onApplyCondition,
  onDeclare,
  onSetDamageRoll,
  onApplyBatch,
  onDismiss,
}: CardProps) {
  const batch = outcome.targets.length > 1;
  // A 23-row list is not a glance. The counts and the one act stay visible; the
  // rows a Curator only needs when they want to treat somebody differently open
  // on request. A single-target card has nothing to collapse.
  const [open, setOpen] = useState(!batch);
  const failPlan = batchPlan(outcome, "fail");
  const passPlan = batchPlan(outcome, "pass");
  const rulings = pendingRulings(outcome);
  const since = lapsedSince(outcome);
  const tally = outcomeTally(outcome);
  const title = batch
    ? `${outcome.sourceAbilityName} → ${outcome.targets.length} targets`
    : `${outcome.sourceAbilityName} → ${outcome.targets[0]?.name ?? "no target"}`;

  return (
    <div className="vtt2-res-card">
      <div className="vtt2-insp-head">
        <span className="vtt2-res-title">{title}</span>
        {/* "×" is not a name a screen reader can act on, and `title` alone is
            the weakest source of one. Say whose card is being discarded. */}
        <button
          type="button"
          className="cdx-tab-x"
          onClick={() => onDismiss(outcome.id)}
          title="Dismiss without applying"
          aria-label={`Dismiss ${outcome.sourceAbilityName} on ${
            batch ? `${outcome.targets.length} targets` : outcome.targets[0]?.name ?? "no target"
          } without applying it`}
        >
          ×
        </button>
      </div>

      {batch && (
        <>
          <div className="vtt2-res-line">
            {outcome.rollLabel}
            {outcome.dc != null ? ` · vs DV ${outcome.dc}` : ""}
          </div>
          <div className="vtt2-res-tally">{tallyLine(outcome)}</div>

          {/* Said in words, not inferred from a spinner. A card that is quietly
              short three answers looks exactly like a card that is finished. */}
          {tally.waiting > 0 && (
            <p className="vtt2-res-note">
              {tally.waiting} {plural(tally.waiting, "target has", "targets have")} not rolled yet.
            </p>
          )}
          {since != null && (
            <p className="vtt2-res-note vtt2-res-lapsed">
              {tally.lapsed} never rolled — outstanding since round {since}. Nothing was applied to{" "}
              {plural(tally.lapsed, "them", "any of them")}; roll late, or open the list and rule on each.
            </p>
          )}

          {/* Which damage model is in force, stated rather than implied, with the
              switch beside it — the corpus writes both and the card cannot be the
              only thing that knows which one it picked. */}
          <div className="vtt2-res-mode">
            <span>
              {outcome.damageRoll === "shared" ? "One shared damage roll for everyone" : "One damage roll per target"}
              {outcome.damageRollByHand ? " · set by you" : " · read from the page"}
            </span>
            <button
              type="button"
              className="vtt2-res-btn"
              onClick={() => onSetDamageRoll(outcome, outcome.damageRoll === "shared" ? "per-target" : "shared")}
            >
              {outcome.damageRoll === "shared" ? "Roll per target" : "Roll once for all"}
            </button>
          </div>

          <div className="vtt2-res-batch" role="group" aria-label="Apply to every target at once">
            {failPlan.length > 0 && (
              <button
                type="button"
                className="vtt2-res-btn strong"
                onClick={() => onApplyBatch(outcome, "fail")}
                title="Roll and apply every armed consequence to each target that failed"
              >
                Apply to all {failPlan.length} that failed
              </button>
            )}
            {passPlan.length > 0 && (
              <button
                type="button"
                className="vtt2-res-btn"
                onClick={() => onApplyBatch(outcome, "pass")}
                title="Apply what a successful save still costs — the half riders"
              >
                Apply to {passPlan.length} that passed
              </button>
            )}
            {failPlan.length === 0 && passPlan.length === 0 && (
              <span className="vtt2-res-note">Nothing is armed to apply yet.</span>
            )}
          </div>

          {rulings.length > 0 && (
            <p className="vtt2-res-note">
              {rulings.length} {plural(rulings.length, "target needs", "targets need")} a ruling — those stay yours,
              one at a time.
            </p>
          )}

          <button
            type="button"
            className="vtt2-res-btn"
            aria-expanded={open}
            onClick={() => setOpen((prior) => !prior)}
          >
            {open ? "Hide targets" : `Show all ${outcome.targets.length} targets`}
          </button>
        </>
      )}

      {open &&
        outcome.targets.map((target) => (
          <TargetBlock
            key={target.id}
            outcome={outcome}
            target={target}
            solo={!batch}
            rolled={rolled}
            committed={committed}
            onRollRow={onRollRow}
            onApplyDamage={onApplyDamage}
            onApplyCondition={onApplyCondition}
            onDeclare={onDeclare}
          />
        ))}
    </div>
  );
}

// The Curator-facing end of the outcome ledger: a settled roll, the consequences
// its verdict armed, and one button per consequence that says what it will do.
// An area ability puts many targets on ONE of these rather than many cards —
// the counts up top are the glance, the rows underneath are the exceptions.
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
  onSetDamageRoll,
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
    // One memo for the whole pass, for the same reason `applyBatch` carries one:
    // this loop can reach 23 targets of a shared-damage card before React has
    // landed a single `setRolled`, and without it each of them rolls its own
    // number under a card that says there is only one.
    const pass = new Map<string, number | null>();
    for (const outcome of outcomes) {
      for (const target of outcome.targets) {
        for (const consequence of autoApplicable(outcome, target, { autoApplyDeclared })) {
          const key = committedKey(outcome, target, consequence);
          if (autoFired.current.has(key)) continue;
          autoFired.current.add(key);
          if (consequence.kind === "condition") {
            onApplyCondition(outcome, target, consequence);
            continue;
          }
          const total = rollRow(outcome, target, consequence, pass);
          // Dice nothing could read leave the row exactly as a Curator would find
          // it — armed, with its Roll button, and no number invented in its place.
          if (total == null) continue;
          const magnitude = damageAfterVerdict(target, consequence, total);
          applyRow(outcome, target, consequence, consequence.kind === "heal" ? -magnitude : magnitude);
        }
      }
    }
  });

  if (outcomes.length === 0) return null;

  // Sorted here rather than trusted from the caller: the ledger keeps newest
  // first, but this card is also rendered from filtered slices, and an outcome
  // the Curator just caused appearing below a stale one reads as a bug.
  const ordered = [...outcomes].sort((a, b) => b.createdAt - a.createdAt);

  function rollRow(
    outcome: PendingOutcome,
    target: OutcomeTarget,
    consequence: OutcomeConsequence,
    // The memo for ONE pass over several targets. `setRolled` is a queued state
    // update: nothing written through it is readable again until the pass is
    // over, so a caller that rolls for more than one target in a single go and
    // relies on `rolled` alone hands each body in the radius a DIFFERENT number
    // while the header above them reads "One shared damage roll for everyone".
    // Nothing on screen contradicts it either — the only evidence is the amounts.
    pass?: Map<string, number | null>
  ): number | null {
    const key = rollKey(outcome, target, consequence);
    // Under one shared roll the first target to ask does the rolling and every
    // other target reads that answer back. Re-rolling per target here would
    // silently turn "one shared roll" into 23 of them while the label still
    // claimed otherwise.
    if (outcome.damageRoll === "shared") {
      if (pass?.has(key)) return pass.get(key) as number | null;
      const prior = rolled[key];
      if (prior !== undefined) return prior;
    }
    const total = onRoll(outcome, consequence);
    pass?.set(key, total);
    setRolled((prior) => ({ ...prior, [key]: total }));
    return total;
  }

  function applyRow(
    outcome: PendingOutcome,
    target: OutcomeTarget,
    consequence: OutcomeConsequence,
    amount: number
  ) {
    onApplyDamage(outcome, target, consequence, amount);
    setCommitted((prior) => ({ ...prior, [committedKey(outcome, target, consequence)]: Math.abs(amount) }));
  }

  /**
   * The one act: every armed consequence, against every target that landed on
   * this verdict, in a single pass.
   *
   * Reads its work from `batchPlan` rather than walking the targets itself, so
   * the count on the button and the writes this makes come from one enumeration
   * — a button that said 18 and wrote 19 would be unfalsifiable at the table.
   *
   * Rolls go through `rollRow` with a one-pass memo rather than through a second
   * copy of the shared-roll rule written out here. Two implementations of "one
   * number for everybody" is how one of them ends up without a memo, and the
   * mode then means different things depending on which button was pressed.
   */
  function applyBatch(outcome: PendingOutcome, verdict: "fail" | "pass") {
    const pass = new Map<string, number | null>();
    const sent: CommittedTotals = {};
    for (const step of batchPlan(outcome, verdict)) {
      for (const consequence of step.consequences) {
        if (consequence.kind === "condition") {
          onApplyCondition(outcome, step.target, consequence);
          continue;
        }
        const total = rollRow(outcome, step.target, consequence, pass);
        // Dice nothing could read leave that target's row armed with its own
        // Roll button rather than taking a number the card made up.
        if (total == null) continue;
        // The halving is still each target's own: one shared 27 is 27 to the
        // targets that failed and 13 to the ones that passed.
        const magnitude = damageAfterVerdict(step.target, consequence, total);
        const amount = consequence.kind === "heal" ? -magnitude : magnitude;
        onApplyDamage(outcome, step.target, consequence, amount);
        sent[committedKey(outcome, step.target, consequence)] = Math.abs(amount);
      }
    }
    setCommitted((prior) => ({ ...prior, ...sent }));
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
          onSetDamageRoll={onSetDamageRoll}
          onApplyBatch={applyBatch}
          onDismiss={onDismiss}
        />
      ))}
    </div>
  );
}
