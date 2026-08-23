import { useState } from "react";
import { signedMod, type RollResult } from "../../game/wte";
import {
  rollAxisChoices,
  rollAxisPaths,
  rollAxisRoll,
  type RollAxis,
  type RollAxisPath,
  type RollAxisStats,
  type RollDirection,
} from "../../game/rollAxis";
import { RollButton } from "./RollButton";

interface Props {
  stats: RollAxisStats;
  onRoll: (roll: RollResult) => void;
}

/** Character-sheet Roll Axis: axis → direction → path → source die. The source
 * and derived modifiers remain visible separately all the way to the feed. */
export function RollAxisPanel({ stats, onRoll }: Props) {
  const [axis, setAxis] = useState<RollAxis | null>(null);
  const [direction, setDirection] = useState<RollDirection | null>(null);
  const [pathId, setPathId] = useState<RollAxisPath["id"] | null>(null);
  const paths = axis && direction ? rollAxisPaths(axis, direction) : [];
  const path = paths.find((candidate) => candidate.id === pathId) ?? null;

  function pickAxis(next: RollAxis) {
    setAxis(axis === next ? null : next);
    setDirection(null);
    setPathId(null);
  }

  function pickDirection(next: RollDirection) {
    setDirection(direction === next ? null : next);
    setPathId(null);
  }

  return (
    <section className="roll-axis-panel" aria-label="Roll Axis">
      <div className="panel-title">Roll Axis</div>
      <p className="inv-sub">Choose an axis, Check or Save, then the governing Attribute or Specialty. The linked Derived modifier is always applied.</p>

      <div className="roll-axis-step" aria-label="Axis">
        <button className={"chip" + (axis === "physical" ? " active" : "")} onClick={() => pickAxis("physical")}>Physical</button>
        <button className={"chip" + (axis === "mental" ? " active" : "")} onClick={() => pickAxis("mental")}>Mental</button>
      </div>

      {axis && (
        <div className="roll-axis-step" aria-label="Direction">
          <button className={"chip" + (direction === "check" ? " active" : "")} onClick={() => pickDirection("check")}>Checks</button>
          <button className={"chip" + (direction === "save" ? " active" : "")} onClick={() => pickDirection("save")}>Saves</button>
        </div>
      )}

      {direction && (
        <div className="roll-axis-step" aria-label="Roll Path">
          {paths.map((candidate) => (
            <button key={candidate.id} className={"chip" + (pathId === candidate.id ? " active" : "")} onClick={() => setPathId(pathId === candidate.id ? null : candidate.id)}>
              {candidate.name} {direction === "check" ? "Check" : "Save"}
            </button>
          ))}
        </div>
      )}

      {path && direction && (
        <div className="roll-axis-source-grid">
          {rollAxisChoices(path, direction, stats).map((choice) => (
            <RollButton
              key={choice.source}
              className="roll-axis-source"
              title={`${choice.sourceLabel} ${signedMod(choice.sourceMod)} plus ${path.derived.label} ${signedMod(choice.derivedMod)}`}
              make={(mode) => rollAxisRoll(choice, mode)}
              onLocal={onRoll}
            >
              <span>{choice.sourceLabel}</span>
              <small>
                d{choice.die} {signedMod(choice.sourceMod)} {choice.sourceShort} {signedMod(choice.derivedMod)} {path.derived.short}
                <b>= d{choice.die} {signedMod(choice.totalMod)}</b>
              </small>
            </RollButton>
          ))}
        </div>
      )}
    </section>
  );
}
