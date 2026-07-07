import { useState } from "react";
import {
  ATTRIBUTES,
  SPECIALTIES,
  SPECIES,
  PARADIGMS,
  SPEC_TOTAL,
  SPEC_MAX,
  ATTR_MIN,
  ATTR_MAX,
  zeroAttributes,
  zeroSpecialties,
  specialtyRemaining,
  validateSheet,
  getSpecies,
  getParadigm,
  type AttrKey,
  type SpecKey,
  type Attributes,
  type Specialties,
} from "../../game/wte";
import type { CharacterSheet } from "../../models/character";
import { createCharacter } from "../../lib/characters";
import { DerivedPreview } from "./DerivedPreview";

const STEPS = ["Identity", "Species", "Paradigm", "Attributes", "Specialties", "Review"];

interface Props {
  campaignId: string;
  onDone: (id?: string) => void;
  onCancel: () => void;
}

function intOf(v: string): number {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : 0;
}

export function CharacterCreator({ campaignId, onDone, onCancel }: Props) {
  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [speciesId, setSpeciesId] = useState<string | undefined>();
  const [paradigmId, setParadigmId] = useState<string | undefined>();
  const [attributes, setAttributes] = useState<Attributes>(zeroAttributes());
  const [specialties, setSpecialties] = useState<Specialties>(zeroSpecialties());
  const [saving, setSaving] = useState(false);

  const remaining = specialtyRemaining(specialties);
  const validation = validateSheet(attributes, specialties);
  const species = getSpecies(speciesId);
  const paradigm = getParadigm(paradigmId);

  function setAttr(k: AttrKey, v: number) {
    setAttributes((a) => ({ ...a, [k]: Math.max(ATTR_MIN, Math.min(ATTR_MAX, v)) }));
  }
  function setSpec(k: SpecKey, v: number) {
    setSpecialties((s) => ({ ...s, [k]: Math.max(0, Math.min(SPEC_MAX, v)) }));
  }

  async function finish() {
    setSaving(true);
    const sheet: CharacterSheet = { attributes, specialties, speciesId, paradigmId, notes: "" };
    try {
      const rec = await createCharacter(campaignId, name, sheet);
      onDone(rec.id);
    } catch (e) {
      alert("Could not create character: " + (e instanceof Error ? e.message : String(e)));
      setSaving(false);
    }
  }

  const canNext = step === 0 ? name.trim().length > 0 : true;
  const isLast = step === STEPS.length - 1;

  return (
    <div className="dashboard">
      <div className="dash-header">
        <div>
          <div className="dash-eyebrow">New character</div>
          <h1 className="dash-title">{STEPS[step]}</h1>
        </div>
        <button className="ghost-btn" onClick={onCancel}>
          Cancel
        </button>
      </div>

      <ol className="wizard-steps">
        {STEPS.map((s, i) => (
          <li key={s} className={"wizard-step" + (i === step ? " active" : "") + (i < step ? " done" : "")}>
            {s}
          </li>
        ))}
      </ol>

      <div className="wizard-body">
        {step === 0 && (
          <div className="wizard-pane">
            <label className="field-label">Character name</label>
            <input
              className="picker-input"
              type="text"
              placeholder="Name your Inquisitor…"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
            />
          </div>
        )}

        {step === 1 && (
          <div className="pick-grid">
            {SPECIES.map((sp) => (
              <button
                key={sp.id}
                className={"pick-card" + (speciesId === sp.id ? " selected" : "")}
                onClick={() => setSpeciesId(sp.id)}
              >
                <div className="pick-fam">{sp.family}</div>
                <div className="pick-name">{sp.name}</div>
                <div className="pick-bonus">
                  {Object.keys(sp.bonuses).length
                    ? Object.entries(sp.bonuses).map(([k, v]) => `+${v} ${k.toUpperCase()}`).join(", ")
                    : "No fixed bonus"}
                </div>
                <div className="pick-innate">{sp.innate.join(" · ")}</div>
              </button>
            ))}
          </div>
        )}

        {step === 2 && (
          <div className="pick-grid">
            {PARADIGMS.map((p) => (
              <button
                key={p.id}
                className={"pick-card" + (paradigmId === p.id ? " selected" : "")}
                onClick={() => setParadigmId(p.id)}
              >
                <div className="pick-fam">{p.group}</div>
                <div className="pick-name">{p.name}</div>
                <div className="pick-bonus">Weapons: {p.weapons.join(", ")}</div>
                <div className="pick-innate">Domains: {p.domains.join(", ")}</div>
              </button>
            ))}
          </div>
        )}

        {step === 3 && (
          <div className="wizard-split">
            <div className="stat-editor">
              {ATTRIBUTES.map((a) => (
                <div className="stat-row" key={a.key}>
                  <div className="stat-info">
                    <span className="stat-short">{a.short}</span>
                    <span className="stat-desc">{a.desc}</span>
                    {species && species.bonuses[a.key] ? (
                      <span className="stat-bonus">+{species.bonuses[a.key]} species</span>
                    ) : null}
                  </div>
                  <input
                    className="stat-input"
                    type="number"
                    min={ATTR_MIN}
                    max={ATTR_MAX}
                    value={attributes[a.key]}
                    onChange={(e) => setAttr(a.key, intOf(e.target.value))}
                  />
                </div>
              ))}
            </div>
            <div className="wizard-aside">
              <div className="aside-title">Derived preview</div>
              <DerivedPreview attributes={attributes} specialties={specialties} speciesId={speciesId} />
            </div>
          </div>
        )}

        {step === 4 && (
          <div className="wizard-split">
            <div className="stat-editor">
              <div className={"points-banner" + (remaining < 0 ? " over" : "")}>
                {remaining >= 0
                  ? `${remaining} / ${SPEC_TOTAL} points remaining`
                  : `Over budget by ${-remaining} points`}
              </div>
              {SPECIALTIES.map((s) => (
                <div className="stat-row" key={s.key}>
                  <div className="stat-info">
                    <span className="stat-short">{s.label}</span>
                    <span className="stat-desc">{s.desc}</span>
                  </div>
                  <input
                    className={"stat-input" + (specialties[s.key] > SPEC_MAX ? " bad" : "")}
                    type="number"
                    min={0}
                    max={SPEC_MAX}
                    value={specialties[s.key]}
                    onChange={(e) => setSpec(s.key, intOf(e.target.value))}
                  />
                </div>
              ))}
            </div>
            <div className="wizard-aside">
              <div className="aside-title">Derived preview</div>
              <DerivedPreview attributes={attributes} specialties={specialties} speciesId={speciesId} />
            </div>
          </div>
        )}

        {step === 5 && (
          <div className="wizard-pane review">
            <div className="review-row"><span>Name</span><b>{name || "Unnamed Inquisitor"}</b></div>
            <div className="review-row"><span>Species</span><b>{species?.name || "—"}</b></div>
            <div className="review-row"><span>Paradigm</span><b>{paradigm?.name || "—"}</b></div>
            <div className="review-row"><span>Specialty points</span><b>{SPEC_TOTAL - remaining} / {SPEC_TOTAL}</b></div>
            {!validation.ok && (
              <ul className="validation-list">
                {validation.errors.map((err, i) => (
                  <li key={i}>{err}</li>
                ))}
              </ul>
            )}
            <DerivedPreview attributes={attributes} specialties={specialties} speciesId={speciesId} />
          </div>
        )}
      </div>

      <div className="wizard-nav">
        <button className="ghost-btn" disabled={step === 0} onClick={() => setStep((s) => s - 1)}>
          Back
        </button>
        {isLast ? (
          <button className="primary-btn" disabled={saving || !validation.ok} onClick={finish}>
            {saving ? "Creating…" : "Create character"}
          </button>
        ) : (
          <button className="primary-btn" disabled={!canNext} onClick={() => setStep((s) => s + 1)}>
            Next
          </button>
        )}
      </div>
    </div>
  );
}
