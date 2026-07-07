import { useCallback, useEffect, useRef, useState } from "react";
import { getCharacter, updateCharacter, type CharacterRecord } from "../../lib/characters";
import { logRoll, recentRolls, type RollEntry } from "../../lib/rolls";
import {
  ATTRIBUTES,
  SPECIALTIES,
  SPEC_MAX,
  ATTR_MIN,
  ATTR_MAX,
  effectiveAttributes,
  specialtyRemaining,
  validateSheet,
  getSpecies,
  getParadigm,
  rollAttribute,
  rollSpecialty,
  type AttrKey,
  type SpecKey,
  type RollResult,
} from "../../game/wte";
import { DerivedPreview } from "./DerivedPreview";

interface Props {
  characterId: string;
  campaignId: string;
  onBack: () => void;
  onChanged: () => void;
}

function intOf(v: string): number {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : 0;
}

export function CharacterSheet({ characterId, campaignId, onBack, onChanged }: Props) {
  const [rec, setRec] = useState<CharacterRecord | null>(null);
  const [rolls, setRolls] = useState<RollEntry[]>([]);
  const saveTimer = useRef<number | undefined>(undefined);
  const pending = useRef<CharacterRecord | null>(null);

  const loadRolls = useCallback(async () => {
    setRolls(await recentRolls(campaignId, 12));
  }, [campaignId]);

  // write the latest unsaved edit through, cancelling any queued debounce
  const flush = useCallback(() => {
    window.clearTimeout(saveTimer.current);
    const p = pending.current;
    if (p) {
      pending.current = null;
      void updateCharacter(p.id, { name: p.name, sheet: p.sheet }).then(onChanged);
    }
  }, [onChanged]);

  useEffect(() => {
    let alive = true;
    getCharacter(characterId).then((r) => {
      if (alive) setRec(r ?? null);
    });
    void loadRolls();
    return () => {
      alive = false;
    };
  }, [characterId, loadRolls]);

  // flush any pending debounced save when leaving the sheet, so a quick "← Vault" never drops an edit
  useEffect(() => flush, [flush]);

  if (!rec) {
    return (
      <div className="dashboard">
        <p className="list-empty">Loading…</p>
      </div>
    );
  }

  const sheet = rec.sheet;
  const eff = effectiveAttributes(sheet.attributes, sheet.speciesId);
  const remaining = specialtyRemaining(sheet.specialties);
  const validation = validateSheet(sheet.attributes, sheet.specialties);
  const species = getSpecies(sheet.speciesId);
  const paradigm = getParadigm(sheet.paradigmId);

  function persist(next: CharacterRecord) {
    setRec(next);
    pending.current = next;
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      const p = pending.current;
      if (!p) return;
      pending.current = null;
      void updateCharacter(p.id, { name: p.name, sheet: p.sheet }).then(onChanged);
    }, 400);
  }
  function setAttr(k: AttrKey, v: number) {
    persist({
      ...rec!,
      sheet: { ...sheet, attributes: { ...sheet.attributes, [k]: Math.max(ATTR_MIN, Math.min(ATTR_MAX, v)) } },
    });
  }
  function setSpec(k: SpecKey, v: number) {
    persist({
      ...rec!,
      sheet: { ...sheet, specialties: { ...sheet.specialties, [k]: Math.max(0, Math.min(SPEC_MAX, v)) } },
    });
  }
  function setNotes(v: string) {
    persist({ ...rec!, sheet: { ...sheet, notes: v } });
  }

  async function doRoll(roll: RollResult) {
    await logRoll(campaignId, rec!.id, roll);
    await loadRolls();
  }

  return (
    <div className="dashboard char-sheet">
      <div className="dash-header">
        <div>
          <div className="dash-eyebrow">
            {[species?.name, paradigm?.name].filter(Boolean).join(" · ") || "Inquisitor"}
          </div>
          <h1 className="dash-title">{rec.name}</h1>
        </div>
        <button className="ghost-btn" onClick={onBack}>
          ← Vault
        </button>
      </div>

      {!validation.ok && (
        <ul className="validation-list">
          {validation.errors.map((err, i) => (
            <li key={i}>{err}</li>
          ))}
        </ul>
      )}

      <div className="sheet-layout">
        <div className="sheet-col">
          <div className="panel-title">Attributes</div>
          <div className="stat-editor">
            {ATTRIBUTES.map((a) => (
              <div className="stat-row" key={a.key}>
                <div className="stat-info">
                  <span className="stat-short">{a.short}</span>
                  <span className="stat-eff">= {eff[a.key]}</span>
                </div>
                <input
                  className="stat-input"
                  type="number"
                  min={ATTR_MIN}
                  max={ATTR_MAX}
                  value={sheet.attributes[a.key]}
                  onChange={(e) => setAttr(a.key, intOf(e.target.value))}
                />
                <button
                  className="roll-btn"
                  title={`Roll ${a.short} (1d20 + ${eff[a.key]})`}
                  onClick={() => doRoll(rollAttribute(`${a.short} Check`, eff[a.key]))}
                >
                  d20
                </button>
              </div>
            ))}
          </div>

          <div className="panel-title mt">Specialties</div>
          <div className={"points-banner small" + (remaining < 0 ? " over" : "")}>
            {remaining >= 0 ? `${remaining} points remaining` : `Over budget by ${-remaining}`}
          </div>
          <div className="stat-editor">
            {SPECIALTIES.map((s) => (
              <div className="stat-row" key={s.key}>
                <div className="stat-info">
                  <span className="stat-short">{s.label}</span>
                </div>
                <input
                  className={"stat-input" + (sheet.specialties[s.key] > SPEC_MAX ? " bad" : "")}
                  type="number"
                  min={0}
                  max={SPEC_MAX}
                  value={sheet.specialties[s.key]}
                  onChange={(e) => setSpec(s.key, intOf(e.target.value))}
                />
                <button
                  className="roll-btn"
                  title={`Roll ${s.label} (1d40 + ${Math.min(SPEC_MAX, sheet.specialties[s.key])})`}
                  onClick={() => doRoll(rollSpecialty(`${s.label} Check`, Math.min(SPEC_MAX, sheet.specialties[s.key])))}
                >
                  d40
                </button>
              </div>
            ))}
          </div>
        </div>

        <div className="sheet-col">
          <div className="panel-title">Derived stats</div>
          <DerivedPreview attributes={sheet.attributes} specialties={sheet.specialties} speciesId={sheet.speciesId} />

          <div className="panel-title mt">Roll feed</div>
          {rolls.length === 0 ? (
            <p className="list-empty">No rolls yet — hit a d20 or d40 button.</p>
          ) : (
            <ul className="roll-feed">
              {rolls.map((r) => (
                <li className="roll-item" key={r.id}>
                  <span className="roll-label">{r.label}</span>
                  <span className="roll-formula">{r.formula}</span>
                  <span className="roll-result">{r.result}</span>
                </li>
              ))}
            </ul>
          )}

          <div className="panel-title mt">Notes</div>
          <textarea
            className="sheet-notes"
            placeholder="Background, gear notes, hooks…"
            value={sheet.notes || ""}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>
      </div>
    </div>
  );
}
