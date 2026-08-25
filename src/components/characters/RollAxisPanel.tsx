import { useState } from "react";
import { ATTRIBUTES, SPECIALTIES, signedMod, type AttrKey, type RollResult, type SpecKey } from "../../game/wte";
import { affinityLabel } from "../../game/paradigmAffinity";
import {
  ROLL_AXIS_PATHS,
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
  /** Remnant's Field Affinity Selection — shown only when the paradigm declares
   *  a choice slot. Quick Hack's Field Reconfiguration retunes it mid-scene,
   *  which is why this lives on the sheet rather than in the creator. */
  fieldAffinity?: {
    attr?: AttrKey;
    spec?: SpecKey;
    fixedAttr: AttrKey[];
    fixedSpec: SpecKey[];
    onChange: (attr: AttrKey | undefined, spec: SpecKey | undefined) => void;
  };
}

// Only stats that govern SOME Roll Axis path may be chosen as Favored —
// Inspiration, Weight and Control appear on no path, so "favoring" one would
// silently grant nothing, forever.
const ON_AXIS_ATTRS = new Set<string>(ROLL_AXIS_PATHS.map((path) => path.attribute.key));
const ON_AXIS_SPECS = new Set<string>(ROLL_AXIS_PATHS.map((path) => path.specialty.key));

/** Character-sheet Roll Axis: axis → direction → path → source die. The source
 * and derived modifiers remain visible separately all the way to the feed. */
export function RollAxisPanel({ stats, onRoll, fieldAffinity }: Props) {
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
      <p className="inv-sub">Axis, then Check or Save, then the Roll Path. Each path rolls its Attribute (d20) or its Specialty (d40); the linked Derived modifier is always applied.</p>

      {fieldAffinity && (
        <div className="field-affinity" aria-label="Field Affinity Selection">
          <span className="roll-axis-step-name" title="Remnant doctrine: Dexterity and Adaptation are always Favored; you choose the rest">Favored</span>
          <span className="field-affinity-fixed">
            {[
              ...fieldAffinity.fixedAttr.map((key) => ATTRIBUTES.find((attribute) => attribute.key === key)?.label ?? key),
              ...fieldAffinity.fixedSpec.map((key) => SPECIALTIES.find((specialty) => specialty.key === key)?.label ?? key),
            ].join(" · ")}
          </span>
          <select
            className="field-affinity-pick"
            value={fieldAffinity.attr ?? ""}
            onChange={(event) => fieldAffinity.onChange((event.target.value || undefined) as AttrKey | undefined, fieldAffinity.spec)}
            aria-label="Chosen Favored Attribute"
          >
            <option value="">+ Attribute…</option>
            {ATTRIBUTES.filter((attribute) => !fieldAffinity.fixedAttr.includes(attribute.key) && ON_AXIS_ATTRS.has(attribute.key)).map((attribute) => (
              <option key={attribute.key} value={attribute.key}>{attribute.label}</option>
            ))}
          </select>
          <select
            className="field-affinity-pick"
            value={fieldAffinity.spec ?? ""}
            onChange={(event) => fieldAffinity.onChange(fieldAffinity.attr, (event.target.value || undefined) as SpecKey | undefined)}
            aria-label="Chosen Favored Specialty"
          >
            <option value="">+ Specialty…</option>
            {SPECIALTIES.filter((specialty) => !fieldAffinity.fixedSpec.includes(specialty.key) && ON_AXIS_SPECS.has(specialty.key)).map((specialty) => (
              <option key={specialty.key} value={specialty.key}>{specialty.label}</option>
            ))}
          </select>
        </div>
      )}

      <div className="roll-axis-step" aria-label="Axis">
        <span className="roll-axis-step-name">Axis</span>
        <button className={"chip axis-chip" + (axis === "physical" ? " active" : "")} onClick={() => pickAxis("physical")}>Physical</button>
        <button className={"chip axis-chip" + (axis === "mental" ? " active" : "")} onClick={() => pickAxis("mental")}>Mental</button>
      </div>

      {axis && (
        <div className="roll-axis-step" aria-label="Direction">
          <span className="roll-axis-step-name">Roll</span>
          <button className={"chip axis-chip" + (direction === "check" ? " active" : "")} onClick={() => pickDirection("check")}>Check — you act</button>
          <button className={"chip axis-chip" + (direction === "save" ? " active" : "")} onClick={() => pickDirection("save")}>Save — you resist</button>
        </div>
      )}

      {direction && (
        <div className="roll-axis-paths" aria-label="Roll Path">
          {paths.map((candidate) => (
            <button
              key={candidate.id}
              className={"roll-axis-path" + (pathId === candidate.id ? " active" : "")}
              onClick={() => setPathId(pathId === candidate.id ? null : candidate.id)}
            >
              <span className="roll-axis-path-name">{candidate.name} {direction === "check" ? "Check" : "Save"}</span>
              <small>
                {candidate.attribute.short} · {candidate.specialty.label} · +{candidate.derived.short}
              </small>
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
              <span>
                {choice.sourceLabel}
                {choice.affinity && (
                  <em className={"affinity-badge" + (choice.affinity.convergence ? " convergence" : "")} title={choice.affinity.convergence ? "Convergence — both Favored pools apply" : "Paradigm Affinity — Favored dice"}>
                    {affinityLabel(choice.affinity)}
                  </em>
                )}
              </span>
              <small>
                d{choice.die} {signedMod(choice.sourceMod)} {choice.sourceShort} {signedMod(choice.derivedMod)} {path.derived.short}
                <b>= d{choice.die} {signedMod(choice.totalMod)}{choice.affinity ? ` ${affinityLabel(choice.affinity)}` : ""}</b>
              </small>
            </RollButton>
          ))}
        </div>
      )}
    </section>
  );
}
