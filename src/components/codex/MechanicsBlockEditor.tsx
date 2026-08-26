// Block-based editing for Genus and Cipher pages: each mechanic field is a
// card with a plain-language explanation, and the effect prose gets phrase
// builders that only emit shapes parseAbilityActions is proven to read.
//
// The source of truth stays the page markdown. The model is scanned from it,
// edits rebuild it (mechanicsModel.ts), and a live strip shows the actions the
// sheet/VTT will actually derive — so "did my change still work?" is answered
// while typing, not after a save.
import { useEffect, useMemo, useRef, useState } from "react";
import { parseAbilityActions } from "../../game/abilityActions";
import { DAMAGE_TYPE_WORDS } from "../../game/abilityActions";
import { effectStepLabel, parseAbilityEffects } from "../../game/abilityEffects";
import { hasLintWarnings, lintDeclaredAgainstProse } from "../../game/abilityLint";
import {
  DETAIL_SEGMENTS,
  IDENTITY_KEYS,
  MECHANIC_BLOCKS,
  ROLL_AXIS_PATHS,
  SAVE_STATS,
  damagePhrase,
  hazardousEffectLines,
  rebuildMechanicsPage,
  rollAxisPhrase,
  savePhrase,
  scanMechanicsPage,
  type MechanicsKind,
  type MechanicsModel,
} from "./mechanicsModel";

interface Props {
  value: string;
  onChange: (next: string) => void;
  kind: MechanicsKind;
}

const AXIS_ROUTES = ROLL_AXIS_PATHS.flatMap((path) =>
  path.directions.map((direction) => ({
    key: `${path.id}:${direction}`,
    path,
    direction,
    label: `${path.name} — ${path.axis === "physical" ? "Physical" : "Mental"} ${direction === "check" ? "Check" : "Save"}`,
  }))
);

export function MechanicsBlockEditor({ value, onChange, kind }: Props) {
  const [model, setModel] = useState<MechanicsModel>(() => scanMechanicsPage(value, kind));
  // Re-scan only when the source changed under us (mode switch, template
  // insert) — not in response to our own rebuilds, which would trim the text
  // the user is mid-way through typing.
  const lastEmitted = useRef<string | null>(null);
  useEffect(() => {
    if (value !== lastEmitted.current) setModel(scanMechanicsPage(value, kind));
  }, [value, kind]);

  function commit(next: MechanicsModel) {
    setModel(next);
    const source = rebuildMechanicsPage(next);
    lastEmitted.current = source;
    onChange(source);
  }

  const setRow = (key: string, rowValue: string) =>
    commit({ ...model, rows: model.rows.map((row) => (row.key === key ? { ...row, value: rowValue } : row)) });
  const removeRow = (key: string) => commit({ ...model, rows: model.rows.filter((row) => row.key !== key) });
  const addRow = (key: string, rowKey: string) =>
    commit({ ...model, rows: [...model.rows, { key, rawKey: rowKey, value: "" }] });
  const appendEffect = (phrase: string) =>
    commit({ ...model, effect: model.effect.trim() ? `${model.effect.replace(/\s+$/, "")}\n${phrase}` : phrase });

  const identity = model.rows.filter((row) => IDENTITY_KEYS.has(row.key));
  const blocks = MECHANIC_BLOCKS.filter((info) => info.kinds.includes(kind));
  const blockKeys = new Set(blocks.map((info) => info.key));
  const present = new Set(model.rows.map((row) => row.key));
  const missing = blocks.filter((info) => !present.has(info.key));
  const extras = model.rows.filter((row) => !IDENTITY_KEYS.has(row.key) && !blockKeys.has(row.key));

  // What the sheet and VTT will actually derive from the effect text.
  const actions = useMemo(() => parseAbilityActions(model.effect), [model.effect]);
  const hazards = useMemo(() => hazardousEffectLines(model.effect), [model.effect]);
  // The declared block, read by the same parser the engine uses, and the two
  // halves of the page checked against each other. Both are empty for a page
  // that declares nothing, so a prose-only ability gains no new furniture.
  const declared = useMemo(() => parseAbilityEffects(model.actions), [model.actions]);
  // A step that is not a bullet is not a step, and the pre-parser lifts a bare
  // `Target: one creature` out of ANY section into the spec table — so the line
  // leaves the block, overwrites the mechanic above it, and the page stops
  // scanning faithfully and drops to the Code editor with nothing said.
  const stepHazards = useMemo(() => hazardousEffectLines(model.actions), [model.actions]);
  const findings = useMemo(() => lintDeclaredAgainstProse(model.effect, model.actions), [model.effect, model.actions]);

  // Phrase-builder state.
  const [saveStat, setSaveStat] = useState<string>("Endurance");
  const [saveDc, setSaveDc] = useState("");
  const [dice, setDice] = useState("2d10");
  const [damageType, setDamageType] = useState<string>(DAMAGE_TYPE_WORDS[0]);
  const [route, setRoute] = useState(AXIS_ROUTES[0].key);

  return (
    <div className="mech-editor">
      <p className="mech-guide">
        These blocks are the rule as the character sheet and VTT read it. Remove a block to keep
        inheriting the official value; the Effect text is scanned for saves, damage and checks —
        the chips at the bottom show exactly what the sheet will see.
      </p>

      {identity.length > 0 && (
        <div className="mech-identity" title="This page's permanent identity — managed automatically on save">
          {identity.map((row) => (
            <span key={row.key}>
              {row.rawKey.trim()} · {row.value || "—"}
            </span>
          ))}
        </div>
      )}

      <div className="mech-blocks">
        {blocks
          .filter((info) => present.has(info.key))
          .map((info) => {
            const row = model.rows.find((r) => r.key === info.key)!;
            return (
              <div className="mech-block" key={info.key}>
                <div className="mech-block-head">
                  <span className="mech-block-label">{info.label}</span>
                  <button
                    className="mech-block-x"
                    title={`Remove ${info.label} — the official value stays in force`}
                    onClick={() => removeRow(info.key)}
                  >
                    ×
                  </button>
                </div>
                {info.options ? (
                  <select className="bg-select full" value={row.value} onChange={(e) => setRow(info.key, e.target.value)}>
                    {!info.options.includes(row.value) && <option value={row.value}>{row.value || "—"}</option>}
                    {info.options.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    className="bg-select full"
                    value={row.value}
                    inputMode={info.numeric ? "numeric" : undefined}
                    onChange={(e) => setRow(info.key, e.target.value)}
                  />
                )}
                <p className="mech-hint">{info.hint}</p>
              </div>
            );
          })}
        {extras.map((row, index) => (
          <div className="mech-block" key={`${row.key}:${index}`}>
            <div className="mech-block-head">
              <span className="mech-block-label">{row.rawKey.trim()}</span>
              <button className="mech-block-x" title="Remove this field" onClick={() => removeRow(row.key)}>
                ×
              </button>
            </div>
            <input className="bg-select full" value={row.value} onChange={(e) => setRow(row.key, e.target.value)} />
            <p className="mech-hint">Custom field — kept on the page exactly as written.</p>
          </div>
        ))}
      </div>

      {missing.length > 0 && (
        <div className="mech-palette">
          {missing.map((info) => (
            <button key={info.key} className="chip" title={info.hint} onClick={() => addRow(info.key, info.rowKey ?? info.label)}>
              + {info.label}
            </button>
          ))}
        </div>
      )}

      <div className="mech-block mech-effect">
        <div className="mech-block-head">
          <span className="mech-block-label">Effect</span>
        </div>
        <textarea
          className="mech-effect-text"
          rows={8}
          value={model.effect}
          placeholder="What the ability does, in plain prose…"
          onChange={(e) => commit({ ...model, effect: e.target.value })}
        />
        <p className="mech-hint">
          The rule itself. Saves, dice and checks written here become clickable rolls — use the
          builders below to add them in a shape the sheet is guaranteed to read.
        </p>
        {hazards.length > 0 && (
          <p className="mech-warn">
            Some effect lines are shaped like spec rows ({hazards.join(", ")}) — the game reads
            those as table fields, not prose, so they vanish from the effect and can override the
            blocks above. Reword them or use the matching block instead.
          </p>
        )}

        <div className="mech-tools">
          <div className="mech-tool" title="A save the TARGET rolls to resist. Appears as a save chip with its DC.">
            <span className="mech-tool-label">Save</span>
            <select className="bg-select" value={saveStat} onChange={(e) => setSaveStat(e.target.value)}>
              {SAVE_STATS.map((stat) => (
                <option key={stat} value={stat}>
                  {stat}
                </option>
              ))}
            </select>
            <input
              className="bg-select mech-dc"
              placeholder="DC"
              inputMode="numeric"
              value={saveDc}
              onChange={(e) => setSaveDc(e.target.value.replace(/[^0-9]/g, ""))}
            />
            <button className="chip" onClick={() => appendEffect(savePhrase(saveStat, saveDc ? parseInt(saveDc, 10) : undefined))}>
              Add
            </button>
          </div>
          <div className="mech-tool" title="Damage the ability deals. The dice become a one-click roll.">
            <span className="mech-tool-label">Damage</span>
            <input
              className="bg-select mech-dice"
              value={dice}
              placeholder="2d10"
              onChange={(e) => setDice(e.target.value)}
            />
            <select className="bg-select" value={damageType} onChange={(e) => setDamageType(e.target.value)}>
              {DAMAGE_TYPE_WORDS.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>
            <button
              className="chip"
              disabled={!/^\d*d\d+([+-]\d+)?$/i.test(dice.trim())}
              onClick={() => appendEffect(damagePhrase(dice, damageType))}
            >
              Add
            </button>
          </div>
          <div
            className="mech-tool"
            title="A full Roll Axis route (source + derived modifier). Only legal path/direction pairs are offered."
          >
            <span className="mech-tool-label">Roll Axis</span>
            <select className="bg-select" value={route} onChange={(e) => setRoute(e.target.value)}>
              {AXIS_ROUTES.map((r) => (
                <option key={r.key} value={r.key}>
                  {r.label}
                </option>
              ))}
            </select>
            <button
              className="chip"
              onClick={() => {
                const r = AXIS_ROUTES.find((candidate) => candidate.key === route) ?? AXIS_ROUTES[0];
                appendEffect(rollAxisPhrase(r.path, r.direction));
              }}
            >
              Add
            </button>
          </div>
        </div>

        <div className="mech-segments">
          {DETAIL_SEGMENTS.map((segment) => (
            <button
              key={segment.label}
              className="chip"
              title={segment.hint}
              onClick={() => appendEffect(`${segment.label}: `)}
            >
              + {segment.label}
            </button>
          ))}
        </div>
      </div>

      <div className="mech-block mech-effect">
        <div className="mech-block-head">
          <span className="mech-block-label">Declared steps</span>
        </div>
        <textarea
          className="mech-effect-text mech-steps-text"
          rows={5}
          value={model.actions}
          placeholder={"- Cost: 6 SS\n- Save (target): Physical Save — Recovery, DV 18\n- Fail: Damage: 3d10 Cold, half on success"}
          onChange={(e) => commit({ ...model, actions: e.target.value })}
        />
        <p className="mech-hint">
          Optional. One step per line — Cost, Roll, Save, Damage, Heal, Condition, Modify, Ruling —
          with Fail: or Success: in front of a step that only happens on that outcome. Leave it empty
          and the ability runs from its prose exactly as it always has; declare part of it and the
          rest stays prose the table reads.
        </p>
        {stepHazards.length > 0 && (
          <p className="mech-warn">
            These lines ({stepHazards.join(", ")}) are not bullets, so the game reads them as table
            fields: they will leave this block on save and overwrite the mechanic of the same name.
            Start each step with “-”.
          </p>
        )}
        {declared.steps.length > 0 && (
          <div className="mech-actions" title="Read back from the block by the same parser the engine runs">
            <span className="mech-block-label">Declared</span>
            {declared.steps.map((step, index) => (
              <span key={index} className="mech-action">
                {effectStepLabel(step)}
              </span>
            ))}
          </div>
        )}
        {findings.length > 0 && (
          // Prose and block are two statements of one rule, and only a human can
          // say which is right — so this reports and never edits.
          <div className={hasLintWarnings(findings) ? "mech-lint warn" : "mech-lint"}>
            {findings.map((finding, index) => (
              <p key={index} className={finding.severity === "warning" ? "mech-warn" : "mech-hint"}>
                {finding.message}
              </p>
            ))}
          </div>
        )}
      </div>

      <div className="mech-actions" title="Derived live from the effect text by the same parser the sheet uses">
        <span className="mech-block-label">The sheet will read</span>
        {actions.length === 0 ? (
          <span className="mech-action none">no rolls — descriptive text only</span>
        ) : (
          actions.map((action, index) => (
            <span key={index} className={`mech-action ${action.kind}`}>
              {action.kind === "self" ? "roll" : action.kind}: {action.label}
            </span>
          ))
        )}
      </div>
    </div>
  );
}
