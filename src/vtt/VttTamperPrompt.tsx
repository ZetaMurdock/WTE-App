import { useState } from "react";
import type { DeclaredTamper, TamperProposal } from "./data/tamperPlan";
import type { TamperTarget } from "./data/tamperTargets";

interface Props {
  abilityName: string;
  /** The `Tamper:` bullets this page declared. */
  steps: readonly DeclaredTamper[];
  /** Everything on the scene this verb could act on, in the Curator's words. */
  targets: readonly TamperTarget[];
  /** What the picked step would do to the picked target, computed against the
   *  LIVE scene by the caller. Recomputed on every render on purpose: a 2-round
   *  field can expire while this dialog is open, and the answer has to be about
   *  the scene as it is, not as it was when the list was built. */
  preview: (step: DeclaredTamper, targetId: string) => TamperProposal | null;
  onConfirm: (step: DeclaredTamper, targetId: string) => void;
  onCancel: () => void;
}

const VERB: Readonly<Record<string, string>> = {
  negate: "Negate",
  end: "End",
  reflect: "Reflect",
  delay: "Delay",
  redirect: "Redirect",
  copy: "Copy",
};

function stepLabel(step: DeclaredTamper): string {
  const verb = VERB[step.mode] ?? step.mode;
  const span = step.rounds ? ` ${step.rounds} round${step.rounds === 1 ? "" : "s"}` : "";
  const branch = step.on === "always" ? "" : step.on === "fail" ? " · on a failed save" : " · on a success";
  return `${verb}${span}${branch}`;
}

/**
 * The Curator's confirmation for a declared `Tamper:` step.
 *
 * Nothing has been touched while this is on screen. It exists because tamper is
 * the one verb in the arc that REMOVES state — a field, the pips it granted, the
 * countdowns watching them — and a removal the Curator did not get to read first
 * is a removal they cannot check afterwards. So the proposal is shown in full
 * before the button: every line it will write, and every piece of state it
 * provably cannot reach.
 *
 * The caveats are the load-bearing half. A cascade that quietly left a counter
 * track behind, or a cleanse the next round would silently undo, is worse than a
 * refusal — the Curator would have no reason to look.
 */
export function VttTamperPrompt({ abilityName, steps, targets, preview, onConfirm, onCancel }: Props) {
  const [stepId, setStepId] = useState<string>(steps[0]?.id ?? "");
  const [targetId, setTargetId] = useState<string>("");

  const step = steps.find((candidate) => candidate.id === stepId) ?? steps[0] ?? null;
  const proposal = step && targetId ? preview(step, targetId) : null;
  const ready = !!proposal && proposal.verdict !== "refused";

  return (
    <div className="vtt2-aoe-backdrop" onMouseDown={onCancel}>
      <div className="vtt2-aoe" onMouseDown={(e) => e.stopPropagation()}>
        <div className="vtt2-aoe-title">Tamper · {abilityName}</div>

        {steps.length > 1 && (
          <>
            <div className="vtt2-aoe-label">Which step</div>
            <div className="vtt2-aoe-modes">
              {steps.map((candidate) => (
                <button
                  key={candidate.id}
                  className={"chip" + (candidate.id === step?.id ? " active" : "")}
                  onClick={() => setStepId(candidate.id)}
                >
                  {stepLabel(candidate)}
                </button>
              ))}
            </div>
          </>
        )}

        <div className="vtt2-aoe-label">
          {step ? stepLabel(step) : "Tamper"} — which effect?
        </div>

        {targets.length === 0 ? (
          <p className="list-empty">
            Nothing on this scene has an ability behind it. Tamper acts on effects an ability placed, on live condition
            countdowns and on counter tracks — a template drawn by hand is the Curator's own and is removed the ordinary
            way.
          </p>
        ) : (
          <div className="vtt2-aoe-modes">
            {targets.map((target) => (
              <button
                key={target.id}
                className={"chip" + (target.id === targetId ? " active" : "")}
                onClick={() => setTargetId(target.id)}
                title={target.detail}
              >
                {target.label}
              </button>
            ))}
          </div>
        )}

        {proposal && (
          <div className="vtt2-aoe-effect">
            {proposal.verdict === "refused" && <div className="equip-warn">{proposal.refusal}</div>}
            {proposal.verdict === "ruling" && (
              <>
                <div>
                  <strong>This one is yours to rule.</strong>
                </div>
                <div>{proposal.ruling}</div>
              </>
            )}
            {proposal.verdict === "commit" && (
              <>
                {proposal.lines.map((line) => (
                  <div key={line}>{line}</div>
                ))}
                {proposal.caveats.map((caveat) => (
                  <div key={caveat} className="equip-warn">
                    {caveat}
                  </div>
                ))}
              </>
            )}
          </div>
        )}

        <div className="vtt2-aoe-actions">
          <button className="ghost-btn" onClick={onCancel}>
            Cancel
          </button>
          <button
            className="ghost-btn strong"
            onClick={() => step && targetId && onConfirm(step, targetId)}
            disabled={!ready}
          >
            {proposal?.verdict === "ruling" ? "Open the ruling" : step ? stepLabel(step).split(" · ")[0] : "Confirm"}
          </button>
        </div>
        {step && step.on !== "always" && (
          <div className="vtt2-aoe-hint">
            The page arms this step {step.on === "fail" ? "on a failed save" : "on a success"}. That verdict is settled
            on the Resolution Card, not here — this dialog does not read it, so confirming is your call about whether
            the branch was met.
          </div>
        )}
        <div className="vtt2-aoe-hint">
          Everything here goes on the undo stack — a tamper you did not mean comes back with Ctrl+Z, pips and
          countdowns together.
        </div>
      </div>
    </div>
  );
}
