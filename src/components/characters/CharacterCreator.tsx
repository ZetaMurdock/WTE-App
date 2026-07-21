import { useState } from "react";
import {
  ATTRIBUTES,
  SPECIALTIES,
  SPECIES,
  PARADIGMS,
  BACKGROUNDS,
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
  speciesInnate,
  type AttrKey,
  type SpecKey,
  type Attributes,
  type Specialties,
  SECTORS,
  getSector,
  moralityState,
  moralityMods,
  SIZE_CLASSES,
  sizeOf,
  type BgMode,
  type Background,
  type CodexBackground,
} from "../../game/wte";
import type { CharacterSheet } from "../../models/character";
import { createCharacter, updateCharacter, type CharacterRecord } from "../../lib/characters";
import { attrBudgetState, loadRules, sheetCaps } from "../../lib/campaignRules";
import { DerivedPreview } from "./DerivedPreview";
import { AttributeRoller } from "./AttributeRoller";
import { PortraitFrame } from "./PortraitFrame";

const STEPS = ["Identity", "Species", "Origin", "Paradigm", "Attributes", "Specialties", "Review"];

interface Props {
  campaignId: string;
  /** Present = EDIT an existing character through the same wizard; fields not
   *  covered by the wizard (rank, loadouts, equipment, pressure…) survive. */
  edit?: CharacterRecord;
  onDone: (id?: string) => void;
  onCancel: () => void;
}

function intOf(v: string): number {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : 0;
}

/** Fixed background bonuses as display rows (attribute short + specialty labels). */
function statBonusRows(b: CodexBackground): { label: string; amount: number }[] {
  const rows: { label: string; amount: number }[] = [];
  for (const a of ATTRIBUTES) {
    const v = b.attrBonus?.[a.key];
    if (v) rows.push({ label: a.short, amount: v });
  }
  for (const s of SPECIALTIES) {
    const v = b.specBonus?.[s.key];
    if (v) rows.push({ label: s.label, amount: v });
  }
  return rows;
}

export function CharacterCreator({ campaignId, edit, onDone, onCancel }: Props) {
  const es = edit?.sheet;
  const [step, setStep] = useState(0);
  const [name, setName] = useState(edit?.name ?? "");
  const [speciesId, setSpeciesId] = useState<string | undefined>(es?.speciesId);
  const [variantName, setVariantName] = useState<string | undefined>(es?.variantName);
  const [variantOption, setVariantOption] = useState<string | undefined>(es?.variantOption);
  // Legacy characters (made before the choose-2-of-4 rule) seed the first N
  // innates as a sensible default the player can re-pick; fresh ones start empty.
  const [innateChoice, setInnateChoice] = useState<string[]>(
    es?.innateChoice ??
      (es?.speciesId
        ? speciesInnate(es.speciesId)
            .slice(0, getSpecies(es.speciesId)?.innateSelect ?? 0)
            .map((a) => a.name)
        : [])
  );
  const [paradigmId, setParadigmId] = useState<string | undefined>(es?.paradigmId);
  const [attributes, setAttributes] = useState<Attributes>(es ? { ...es.attributes } : zeroAttributes());
  const [specialties, setSpecialties] = useState<Specialties>(es ? { ...es.specialties } : zeroSpecialties());
  const [bgName, setBgName] = useState(es?.background?.name ?? "");
  const [bgMode, setBgMode] = useState<BgMode>(es?.background?.mode ?? "standard");
  const [bgAssign, setBgAssign] = useState<(AttrKey | null)[]>(
    es?.background?.assign?.length ? [...es.background.assign] : [null, null, null, null]
  );
  const [selectedBg, setSelectedBg] = useState<CodexBackground | null>(() =>
    es?.background && (es.background.attrBonus || es.background.specBonus)
      ? ({ name: es.background.name ?? "Background", mode: es.background.mode, attrBonus: es.background.attrBonus, specBonus: es.background.specBonus } as CodexBackground)
      : null
  );
  const [backstory, setBackstory] = useState(es?.notes ?? "");
  const [sector, setSector] = useState<string | undefined>(es?.sector);
  const [morality, setMorality] = useState(es?.morality ?? 50);
  const [sizeId, setSizeId] = useState(es?.sizeId ?? "auto");
  const [attrMode, setAttrMode] = useState<"manual" | "roll">("manual");
  const [portrait, setPortrait] = useState<string | undefined>(es?.portrait);
  const [saving, setSaving] = useState(false);

  // A Codex background with fixed bonuses overrides the manual mode/assign spread.
  const bgFixed = !!(selectedBg && (selectedBg.attrBonus || selectedBg.specBonus));
  const background: Background = bgFixed
    ? { name: bgName.trim() || selectedBg!.name, mode: selectedBg!.mode ?? bgMode, assign: [], attrBonus: selectedBg!.attrBonus, specBonus: selectedBg!.specBonus }
    : { name: bgName.trim() || undefined, mode: bgMode, assign: bgAssign };
  // The Curator's budgets for this table. Read once per mount — they change from
  // the vault, which unmounts the creator anyway.
  const [rules] = useState(() => loadRules(campaignId));
  const caps = sheetCaps(rules);
  const remaining = specialtyRemaining(specialties, rules.specTotal);
  const validation = validateSheet(attributes, specialties, caps);
  const budget = attrBudgetState(
    ATTRIBUTES.reduce((t, a) => t + (attributes[a.key] || 0), 0),
    rules
  );
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
    const fields = { attributes, specialties, speciesId, variantName, variantOption, innateChoice, paradigmId, portrait, background, sizeId, sector, morality, notes: backstory };
    try {
      if (edit) {
        // merge OVER the existing sheet — rank/loadouts/equipment/etc. survive
        await updateCharacter(edit.id, { name: name.trim() || edit.name, sheet: { ...edit.sheet, ...fields } });
        onDone(edit.id);
      } else {
        const rec = await createCharacter(campaignId, name, { rank: 0, ...fields } as CharacterSheet);
        onDone(rec.id);
      }
    } catch (e) {
      alert("Could not save character: " + (e instanceof Error ? e.message : String(e)));
      setSaving(false);
    }
  }

  // Step 0 (Origin) gate: a name, and — once a species is picked — its variant
  // (a Variant must be chosen) plus the full 2-of-4 innate selection.
  const innateComplete = !species?.innateSelect || innateChoice.length === species.innateSelect;
  const variantComplete = !species || species.variants.length === 0 || !!variantName;
  const canNext = step === 0 ? name.trim().length > 0 && (!speciesId || (variantComplete && innateComplete)) : true;
  const canFinish = validation.ok && !budget.over;
  const isLast = step === STEPS.length - 1;
  // Jump to any step by clicking its tab — the only gate is a name on Identity.
  function goStep(i: number) {
    if (i === step) return;
    if (name.trim().length === 0 && i > 0) {
      setStep(0);
      return;
    }
    setStep(i);
  }

  return (
    <div className="dashboard">
      <div className="dash-header">
        <div>
          <div className="dash-eyebrow">{edit ? `Editing ${edit.name}` : "New character"}</div>
          <h1 className="dash-title">{STEPS[step]}</h1>
        </div>
        <button className="ghost-btn" onClick={onCancel}>
          Cancel
        </button>
      </div>

      <nav className="wizard-steps">
        {STEPS.map((s, i) => (
          <button
            key={s}
            className={"wizard-step" + (i === step ? " active" : "") + (i < step ? " done" : "")}
            onClick={() => goStep(i)}
          >
            <span className="wizard-step-n">{i + 1}</span>
            <span className="wizard-step-label">{s}</span>
          </button>
        ))}
      </nav>

      <div className="wizard-body">
        {step === 0 && (
          <div>
            <div className="wizard-pane identity-pane">
              <PortraitFrame src={portrait} onChange={(u) => setPortrait(u ?? undefined)} size="lg" />
              <div className="identity-fields">
                <label className="field-label">Character name</label>
                <input
                  className="picker-input"
                  type="text"
                  placeholder="Name your Inquisitor…"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  autoFocus
                />
                <p className="identity-hint">Upload a portrait (PNG) — hover the frame. You can change it later on the sheet.</p>
              </div>
            </div>

            {/* Background + backstory live here — the personal story is one section. */}
            <div className="wizard-pane" style={{ marginTop: 22 }}>
              <label className="field-label">Background</label>
              {BACKGROUNDS.length > 0 && (
                <div className="chip-row" style={{ flexWrap: "wrap", marginBottom: 8 }}>
                  {BACKGROUNDS.map((b) => (
                    <button
                      key={b.name}
                      className={"chip" + (selectedBg?.name === b.name ? " active" : "")}
                      title={b.note || undefined}
                      onClick={() => {
                        setSelectedBg(b);
                        setBgName(b.name);
                        if (b.mode) setMode(b.mode);
                      }}
                    >
                      {b.name}
                    </button>
                  ))}
                </div>
              )}
              <input
                className="picker-input"
                type="text"
                placeholder={BACKGROUNDS.length ? "…or a custom background name" : "Background name (optional)…"}
                value={bgName}
                onChange={(e) => {
                  setSelectedBg(null); // typing a custom name reverts to manual assignment
                  setBgName(e.target.value);
                }}
              />
              {bgFixed ? (
                <div className="bg-fixed">
                  <div className="picker-label">Fixed bonuses (from this background)</div>
                  <ul className="bg-fixed-list">
                    {statBonusRows(selectedBg!).map((r) => (
                      <li key={r.label}>
                        <span className="bg-fixed-amt">+{r.amount}</span> {r.label}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <>
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
                </>
              )}
              <label className="field-label" style={{ marginTop: 16 }}>Backstory & personal notes</label>
              <textarea
                className="sheet-notes"
                style={{ minHeight: 100 }}
                placeholder="Who are they? Where did they come from? Hooks, scars, debts…"
                value={backstory}
                onChange={(e) => setBackstory(e.target.value)}
              />
            </div>
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
                    setInnateChoice([]);
                  }}
                >
                  <div className="pick-fam">{sp.family}</div>
                  <div className="pick-name">{sp.name}</div>
                  <div className="pick-bonus">
                    {Object.keys(sp.bonuses).length
                      ? Object.entries(sp.bonuses).map(([k, v]) => `+${v} ${k.toUpperCase()}`).join(", ")
                      : "No fixed bonus"}
                  </div>
                  {(sp.dom != null || sp.eminence) && (
                    <div className="pick-genetics">
                      {sp.dom != null ? `Dom ${sp.dom} · Rec ${sp.rec}` : ""}
                      {sp.eminence ? ` · ${sp.eminence}` : ""}
                    </div>
                  )}
                  <div className="pick-innate">
                    {sp.innateSelect ? `Choose ${sp.innateSelect} of ${sp.innate.length}: ` : ""}
                    {sp.innate.join(" · ")}
                  </div>
                </button>
              ))}
            </div>

            {species && species.innateSelect && (() => {
              const innates = speciesInnate(species.id);
              const need = species.innateSelect;
              const toggle = (name: string) =>
                setInnateChoice((cur) =>
                  cur.includes(name) ? cur.filter((n) => n !== name) : cur.length >= need ? cur : [...cur, name]
                );
              return (
                <div className="variant-choose">
                  <div className="aside-title">
                    Choose {need} of {innates.length} innate abilities — the other {innates.length - need} become locked Incept seeds
                    <span className={"points-inline" + (innateChoice.length === need ? "" : " over")} style={{ marginLeft: 8 }}>
                      {innateChoice.length}/{need} chosen
                    </span>
                  </div>
                  <div className="pick-grid">
                    {innates.map((ab) => {
                      const sel = innateChoice.includes(ab.name);
                      const full = !sel && innateChoice.length >= need;
                      return (
                        <button
                          key={ab.name}
                          className={"pick-card innate-card" + (sel ? " selected" : "") + (full ? " dim" : "")}
                          onClick={() => toggle(ab.name)}
                          title={ab.effect}
                        >
                          <div className="pick-name">{ab.name}</div>
                          <div className="pick-innate">{ab.effect.length > 160 ? ab.effect.slice(0, 158) + "…" : ab.effect}</div>
                          <div className="innate-tag">{sel ? "ACTIVE" : full ? "—" : "Incept seed"}</div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })()}

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
              <label className="field-label">Sector — where you joined your Paradigm</label>
              <div className="chip-row" style={{ flexWrap: "wrap" }}>
                {SECTORS.map((s) => (
                  <button
                    key={s.id}
                    className={"chip" + (sector === s.id ? " active" : "")}
                    title={s.epithet}
                    onClick={() => setSector(sector === s.id ? undefined : s.id)}
                  >
                    {s.name}
                  </button>
                ))}
              </div>
              {sector && <p className="identity-hint">{getSector(sector)?.epithet} — see “The 16 Sectors” in the Codex.</p>}

              <label className="field-label" style={{ marginTop: 18 }}>
                Morality — the Polarized Soul · {morality} ({moralityState(morality).label})
              </label>
              <div className="chip-row">
                {[
                  { label: "Pure Process", v: 10 },
                  { label: "Leaning Process", v: 30 },
                  { label: "Neutral", v: 50 },
                  { label: "Leaning Resonance", v: 70 },
                  { label: "Apex Resonance", v: 90 },
                ].map((p) => (
                  <button key={p.label} className={"chip" + (morality === p.v ? " active" : "")} onClick={() => setMorality(p.v)}>
                    {p.label}
                  </button>
                ))}
              </div>
              <input
                type="range"
                min={0}
                max={100}
                value={morality}
                onChange={(e) => setMorality(parseInt(e.target.value, 10))}
                style={{ width: "100%", marginTop: 8 }}
              />
              <p className="identity-hint">
                0 = Process (the Numb) · 100 = Resonance (the Volatile).{moralityMods(morality).note ? ` Wired: ${moralityMods(morality).note}` : ""} Advancement shape is governed by Eminence — see the built-in page.
              </p>

              <label className="field-label" style={{ marginTop: 18 }}>Size</label>
              <div className="chip-row" style={{ flexWrap: "wrap" }}>
                <button className={"chip" + (sizeId === "auto" ? " active" : "")} onClick={() => setSizeId("auto")}>
                  Auto · {sizeOf("auto", speciesId).label} (species)
                </button>
                {SIZE_CLASSES.map((s) => (
                  <button key={s.key} className={"chip" + (sizeId === s.key ? " active" : "")} title={s.note} onClick={() => setSizeId(s.key)}>
                    {s.label}
                  </button>
                ))}
              </div>
              <p className="identity-hint">{sizeOf(sizeId, speciesId).note}</p>
            </div>
            <div className="wizard-aside">
              <div className="aside-title">Derived preview</div>
              <DerivedPreview attributes={attributes} specialties={specialties} speciesId={speciesId} background={background} sizeId={sizeId} morality={morality} />
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
            <div className="stat-editor-wrap">
              <div className="chip-row">
                <button className={"chip" + (attrMode === "manual" ? " active" : "")} onClick={() => setAttrMode("manual")}>
                  Manual entry
                </button>
                <button className={"chip" + (attrMode === "roll" ? " active" : "")} onClick={() => setAttrMode("roll")}>
                  Roll &amp; assign
                </button>
              </div>
              {budget.enforced && (
                <div className={"points-banner" + (budget.over ? " over" : "")} title="This table's Curator caps total attribute points">
                  {budget.over
                    ? `Over the Curator's attribute budget by ${-budget.remaining} points`
                    : `${budget.remaining} / ${budget.cap} attribute points remaining`}
                </div>
              )}
              {attrMode === "manual" ? (
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
              ) : (
                <AttributeRoller attributes={attributes} onSet={setAttributes} />
              )}
            </div>
            <div className="wizard-aside">
              <div className="aside-title">Derived preview</div>
              <DerivedPreview attributes={attributes} specialties={specialties} speciesId={speciesId} background={background} morality={morality} />
            </div>
          </div>
        )}

        {step === 5 && (
          <div className="wizard-split">
            <div className="stat-editor">
              <div className={"points-banner" + (remaining < 0 ? " over" : "")}>
                {remaining >= 0 ? `${remaining} / ${rules.specTotal} points remaining` : `Over budget by ${-remaining} points`}
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
              <DerivedPreview attributes={attributes} specialties={specialties} speciesId={speciesId} background={background} morality={morality} />
            </div>
          </div>
        )}

        {step === 6 && (
          <div className="wizard-pane review">
            <div className="review-head">
              <PortraitFrame src={portrait} size="md" />
              <div>
                <div className="dash-eyebrow">
                  {[species?.name, variantName, paradigm?.name].filter(Boolean).join(" · ") || "Inquisitor"}
                </div>
                <h2 className="dash-title" style={{ margin: 0 }}>{name || "Unnamed Inquisitor"}</h2>
              </div>
            </div>
            <div className="review-row"><span>Name</span><b>{name || "Unnamed Inquisitor"}</b></div>
            <div className="review-row"><span>Species</span><b>{species?.name || "—"}{variantName ? ` · ${variantName}` : ""}</b></div>
            <div className="review-row"><span>Background</span><b>{bgName.trim() || "—"} ({bgMode})</b></div>
            <div className="review-row"><span>Paradigm</span><b>{paradigm?.name || "—"}</b></div>
            <div className="review-row"><span>Sector</span><b>{getSector(sector) ? `${getSector(sector)!.name} · ${getSector(sector)!.epithet}` : "—"}</b></div>
            <div className="review-row"><span>Morality</span><b>{morality} · {moralityState(morality).label}</b></div>
            <div className="review-row"><span>Size</span><b>{sizeOf(sizeId, speciesId).label}{sizeId === "auto" ? " (species)" : ""}</b></div>
            <div className="review-row"><span>Specialty points</span><b>{rules.specTotal - remaining} / {rules.specTotal}</b></div>
            {budget.enforced && (
              <div className="review-row"><span>Attribute points</span><b>{budget.spent} / {budget.cap}</b></div>
            )}
            {!canFinish && (
              <ul className="validation-list">
                {validation.errors.map((err, i) => (
                  <li key={i}>{err}</li>
                ))}
              </ul>
            )}
            <DerivedPreview attributes={attributes} specialties={specialties} speciesId={speciesId} background={background} morality={morality} />
            <button className="primary-btn full mt" disabled={saving || !canFinish} onClick={finish}>
              {saving ? "Saving…" : edit ? "Save changes" : "Create character"}
            </button>
          </div>
        )}
      </div>

      {/* Side navigators: an orb that morphs into an arrow on hover. */}
      {step > 0 && (
        <button className="edge-nav left" title="Back" onClick={() => setStep((s) => s - 1)}>
          <span className="edge-line" aria-hidden />
          <span className="edge-orb" aria-hidden />
          <span className="edge-arrow" aria-hidden>
            ‹
          </span>
        </button>
      )}
      {isLast ? (
        <button
          className={"edge-nav right finish" + (saving || !canFinish ? " off" : "")}
          title={canFinish ? "Create character" : "Finish the required steps first"}
          onClick={() => !saving && canFinish && finish()}
        >
          <span className="edge-line" aria-hidden />
          <span className="edge-orb" aria-hidden />
          <span className="edge-arrow" aria-hidden>
            {saving ? "…" : "✦"}
          </span>
        </button>
      ) : (
        <button className={"edge-nav right" + (canNext ? "" : " off")} title="Next" onClick={() => canNext && setStep((s) => s + 1)}>
          <span className="edge-line" aria-hidden />
          <span className="edge-orb" aria-hidden />
          <span className="edge-arrow" aria-hidden>
            ›
          </span>
        </button>
      )}
    </div>
  );
}
