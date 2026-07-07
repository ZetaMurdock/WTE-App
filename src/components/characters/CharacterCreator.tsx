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
  effectiveAttributes,
  bgBonuses,
  bgAmounts,
  rollMod,
  specRollMod,
  signedMod,
  getSpecies,
  getParadigm,
  type AttrKey,
  type SpecKey,
  type Attributes,
  type Specialties,
  type BgMode,
  type Background,
} from "../../game/wte";
import type { CharacterSheet } from "../../models/character";
import { createCharacter } from "../../lib/characters";
import { DerivedPreview } from "./DerivedPreview";

const STEPS = ["Identity", "Species", "Background", "Paradigm", "Attributes", "Specialties", "Review"];

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
  const [variantName, setVariantName] = useState<string | undefined>();
  const [variantOption, setVariantOption] = useState<string | undefined>();
  const [paradigmId, setParadigmId] = useState<string | undefined>();
  const [attributes, setAttributes] = useState<Attributes>(zeroAttributes());
  const [specialties, setSpecialties] = useState<Specialties>(zeroSpecialties());
  const [bgName, setBgName] = useState("");
  const [bgMode, setBgMode] = useState<BgMode>("standard");
  const [bgAssign, setBgAssign] = useState<(AttrKey | null)[]>([null, null, null, null]);
  const [saving, setSaving] = useState(false);

  const background: Background = { name: bgName.trim() || undefined, mode: bgMode, assign: bgAssign };
  const remaining = specialtyRemaining(specialties);
  const validation = validateSheet(attributes, specialties);
  const species = getSpecies(speciesId);
  const selectedVariant = species?.variants.find((v) => v.name === variantName);
  const paradigm = getParadigm(paradigmId);
  const eff = effectiveAttributes(attributes, speciesId, bgBonuses(background));

  function setAttr(k: AttrKey, v: number) {
    setAttributes((a) => ({ ...a, [k]: Math.max(ATTR_MIN, Math.min(ATTR_MAX, v)) }));
  }
  function setSpec(k: SpecKey, v: number) {
    setSpecialties((s) => ({ ...s, [k]: Math.max(0, Math.min(SPEC_MAX, v)) }));
  }
  function setMode(mode: BgMode) {
    setBgMode(mode);
    setBgAssign(bgAmounts(mode).map(() => null));
  }
  function setAssign(i: number, k: AttrKey | null) {
    setBgAssign((a) => {
      const n = [...a];
      n[i] = k;
      return n;
    });
  }

  async function finish() {
    setSaving(true);
    const sheet: CharacterSheet = { attributes, specialties, speciesId, variantName, variantOption, paradigmId, rank: 0, background, notes: "" };
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
          <div>
            <div className="pick-grid">
              {SPECIES.map((sp) => (
                <button
                  key={sp.id}
                  className={"pick-card" + (speciesId === sp.id ? " selected" : "")}
                  onClick={() => {
                    setSpeciesId(sp.id);
                    setVariantName(undefined);
                    setVariantOption(undefined);
                  }}
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

            {species && species.variants.length > 0 && (
              <div className="variant-choose">
                <div className="aside-title">Choose a {species.name} variant — permanent once created</div>
                <div className="pick-grid">
                  {species.variants.map((v) => (
                    <button
                      key={v.name}
                      className={"pick-card" + (variantName === v.name ? " selected" : "")}
                      onClick={() => {
                        setVariantName(variantName === v.name ? undefined : v.name);
                        setVariantOption(undefined);
                      }}
                    >
                      <div className="pick-name">{v.name}</div>
                      <div className="pick-innate">{v.abilities.map((a) => a.name).join(" · ")}</div>
                    </button>
                  ))}
                </div>

                {selectedVariant?.options && (
                  <div className="variant-options">
                    <div className="aside-title">{selectedVariant.name} — choose one</div>
                    <div className="chip-row">
                      {selectedVariant.options.map((o) => (
                        <button
                          key={o.label}
                          className={"chip" + (variantOption === o.label ? " active" : "")}
                          onClick={() => setVariantOption(o.label)}
                        >
                          {o.label} → {o.ability.name}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {step === 2 && (
          <div className="wizard-split">
            <div className="stat-editor">
              <input
                className="picker-input"
                type="text"
                placeholder="Background name (optional)…"
                value={bgName}
                onChange={(e) => setBgName(e.target.value)}
              />
              <div className="chip-row">
                <button className={"chip" + (bgMode === "standard" ? " active" : "")} onClick={() => setMode("standard")}>
                  Standard · +2 +2 +1 +1
                </button>
                <button className={"chip" + (bgMode === "focused" ? " active" : "")} onClick={() => setMode("focused")}>
                  Focused · +4 +2
                </button>
              </div>
              {bgAmounts(bgMode).map((amt, i) => (
                <div className="stat-row" key={i}>
                  <div className="stat-info">
                    <span className="stat-short">+{amt} to</span>
                  </div>
                  <select
                    className="bg-select"
                    value={bgAssign[i] ?? ""}
                    onChange={(e) => setAssign(i, (e.target.value || null) as AttrKey | null)}
                  >
                    <option value="">—</option>
                    {ATTRIBUTES.map((a) => (
                      <option key={a.key} value={a.key}>
                        {a.short}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
            <div className="wizard-aside">
              <div className="aside-title">Derived preview</div>
              <DerivedPreview attributes={attributes} specialties={specialties} speciesId={speciesId} background={background} />
            </div>
          </div>
        )}

        {step === 3 && (
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

        {step === 4 && (
          <div className="wizard-split">
            <div className="stat-editor">
              {ATTRIBUTES.map((a) => (
                <div className="stat-row" key={a.key}>
                  <div className="stat-info">
                    <span className="stat-short">{a.short}</span>
                    <span className="stat-desc">{a.desc}</span>
                  </div>
                  <span className="mod-box" title="Roll modifier">
                    {signedMod(rollMod(eff[a.key]))}
                  </span>
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
              <DerivedPreview attributes={attributes} specialties={specialties} speciesId={speciesId} background={background} />
            </div>
          </div>
        )}

        {step === 5 && (
          <div className="wizard-split">
            <div className="stat-editor">
              <div className={"points-banner" + (remaining < 0 ? " over" : "")}>
                {remaining >= 0 ? `${remaining} / ${SPEC_TOTAL} points remaining` : `Over budget by ${-remaining} points`}
              </div>
              {SPECIALTIES.map((s) => (
                <div className="stat-row" key={s.key}>
                  <div className="stat-info">
                    <span className="stat-short">{s.label}</span>
                  </div>
                  <span className="mod-box" title="Roll modifier">
                    {signedMod(specRollMod(specialties[s.key]))}
                  </span>
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
              <DerivedPreview attributes={attributes} specialties={specialties} speciesId={speciesId} background={background} />
            </div>
          </div>
        )}

        {step === 6 && (
          <div className="wizard-pane review">
            <div className="review-row"><span>Name</span><b>{name || "Unnamed Inquisitor"}</b></div>
            <div className="review-row"><span>Species</span><b>{species?.name || "—"}{variantName ? ` · ${variantName}` : ""}</b></div>
            <div className="review-row"><span>Background</span><b>{bgName.trim() || "—"} ({bgMode})</b></div>
            <div className="review-row"><span>Paradigm</span><b>{paradigm?.name || "—"}</b></div>
            <div className="review-row"><span>Specialty points</span><b>{SPEC_TOTAL - remaining} / {SPEC_TOTAL}</b></div>
            {!validation.ok && (
              <ul className="validation-list">
                {validation.errors.map((err, i) => (
                  <li key={i}>{err}</li>
                ))}
              </ul>
            )}
            <DerivedPreview attributes={attributes} specialties={specialties} speciesId={speciesId} background={background} />
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
