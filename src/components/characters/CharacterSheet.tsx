import { useCallback, useEffect, useRef, useState } from "react";
import { getCharacter, updateCharacter, type CharacterRecord } from "../../lib/characters";
import { logRoll } from "../../lib/rolls";
import {
  ATTRIBUTES,
  SPECIALTIES,
  SPEC_MAX,
  ATTR_MIN,
  ATTR_MAX,
  RANK_MAX,
  effectiveAttributes,
  effectiveSpecialties,
  aggregateEquip,
  mergeMods,
  computeDerived,
  sizeOf,
  rollGeneric,
  bgBonuses,
  rollMod,
  specRollMod,
  signedMod,
  rankMult,
  genusSlots,
  cipherSlots,
  specialtyRemaining,
  validateSheet,
  getSpecies,
  getParadigm,
  rollAttribute,
  rollSpecialty,
  type AttrKey,
  type SpecKey,
  type RollResult,
  type EquipmentItem,
} from "../../game/wte";
import { DerivedPreview } from "./DerivedPreview";
import { RollFeed, useRollFeed } from "./RollFeed";
import { SpeciesVariantsPanel } from "./SpeciesVariantsPanel";
import { EquipmentPanel } from "./EquipmentPanel";
import { AbilitiesPanel } from "./AbilitiesPanel";
import { ActionsRail } from "./ActionsRail";
import { loadoutMods, loadoutNC, weaponSlotsUsed, WEAPON_SLOTS } from "../../lib/codex";

interface Props {
  characterId: string;
  campaignId: string;
  curator: boolean;
  onBack: () => void;
  onChanged: () => void;
}

function intOf(v: string): number {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : 0;
}

export function CharacterSheet({ characterId, campaignId, curator, onBack, onChanged }: Props) {
  const [rec, setRec] = useState<CharacterRecord | null>(null);
  const [variantsOpen, setVariantsOpen] = useState(false);
  const [equipmentOpen, setEquipmentOpen] = useState(false);
  const [abilitiesOpen, setAbilitiesOpen] = useState(false);
  const { items: feedItems, push: pushFeed } = useRollFeed();
  const saveTimer = useRef<number | undefined>(undefined);
  const pending = useRef<CharacterRecord | null>(null);

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
    return () => {
      alive = false;
    };
  }, [characterId]);

  useEffect(() => flush, [flush]);

  if (!rec) {
    return (
      <div className="dashboard">
        <p className="list-empty">Loading…</p>
      </div>
    );
  }

  const sheet = rec.sheet;
  const rank = sheet.rank ?? 0;
  const weaponLoadout = sheet.weaponLoadout ?? [];
  const gearLoadout = sheet.gearLoadout ?? [];
  const equip = mergeMods(aggregateEquip(sheet.equipment), loadoutMods(weaponLoadout, gearLoadout));
  const eff = effectiveAttributes(sheet.attributes, sheet.speciesId, bgBonuses(sheet.background), equip.attr);
  const effSpec = effectiveSpecialties(sheet.specialties, equip.spec);
  const remaining = specialtyRemaining(sheet.specialties);
  const derived = computeDerived(sheet.attributes, sheet.specialties, {
    speciesId: sheet.speciesId,
    rank,
    bgBonuses: bgBonuses(sheet.background),
    equip,
    sizeMove: sizeOf(sheet.sizeId, sheet.speciesId).move,
  });
  const maxSS = derived.ss;
  const ssSpent = sheet.ssSpent ?? 0;
  const maxNC = derived.nc;
  const ncUsed = loadoutNC(weaponLoadout, gearLoadout);
  const slotsUsed = weaponSlotsUsed(weaponLoadout);
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
    persist({ ...rec!, sheet: { ...sheet, attributes: { ...sheet.attributes, [k]: Math.max(ATTR_MIN, Math.min(ATTR_MAX, v)) } } });
  }
  function setSpec(k: SpecKey, v: number) {
    persist({ ...rec!, sheet: { ...sheet, specialties: { ...sheet.specialties, [k]: Math.max(0, Math.min(SPEC_MAX, v)) } } });
  }
  function setRank(v: number) {
    persist({ ...rec!, sheet: { ...sheet, rank: Math.max(0, Math.min(RANK_MAX, v)) } });
  }
  function setNotes(v: string) {
    persist({ ...rec!, sheet: { ...sheet, notes: v } });
  }
  function setVariant(name: string | undefined) {
    persist({ ...rec!, sheet: { ...sheet, variantName: name } });
  }
  function setSize(sizeId: string) {
    persist({ ...rec!, sheet: { ...sheet, sizeId } });
  }
  function setEquipment(items: EquipmentItem[]) {
    persist({ ...rec!, sheet: { ...sheet, equipment: items } });
  }
  function setWeapons(names: string[]) {
    persist({ ...rec!, sheet: { ...sheet, weaponLoadout: names } });
  }
  function setGear(names: string[]) {
    persist({ ...rec!, sheet: { ...sheet, gearLoadout: names } });
  }
  function setGenus(names: string[]) {
    persist({ ...rec!, sheet: { ...sheet, genusLoadout: names } });
  }
  function setCiphers(names: string[]) {
    persist({ ...rec!, sheet: { ...sheet, cipherLoadout: names } });
  }
  function spendSS(cost: number) {
    persist({ ...rec!, sheet: { ...sheet, ssSpent: (sheet.ssSpent ?? 0) + cost } });
  }
  function restSS() {
    persist({ ...rec!, sheet: { ...sheet, ssSpent: 0 } });
  }

  async function doRoll(roll: RollResult) {
    pushFeed(roll);
    await logRoll(campaignId, rec!.id, roll);
  }

  return (
    <div className="dashboard char-sheet">
      <div className="dash-header">
        <div>
          <div className="dash-eyebrow">
            {[species?.name, sheet.variantName, paradigm?.name].filter(Boolean).join(" · ") || "Inquisitor"}
          </div>
          <h1 className="dash-title">{rec.name}</h1>
        </div>
        <div className="sheet-head-actions">
          <button className="ghost-btn" onClick={() => setAbilitiesOpen(true)}>
            Abilities
          </button>
          <button className="ghost-btn" onClick={() => setEquipmentOpen(true)}>
            Loadout & Size
          </button>
          <button className="ghost-btn" onClick={() => setVariantsOpen(true)}>
            Species Variants
          </button>
          <button className="ghost-btn" onClick={onBack}>
            ← Vault
          </button>
        </div>
      </div>

      <div className="rank-bar">
        <div className="rank-item">
          <span className="rank-lbl">Rank</span>
          <input
            className="rank-input"
            type="number"
            min={0}
            max={RANK_MAX}
            value={rank}
            disabled={!curator}
            onChange={(e) => setRank(intOf(e.target.value))}
          />
        </div>
        <div className="rank-item"><span className="rank-lbl">HP mult</span><span className="rank-val">×{rankMult(rank).toFixed(2)}</span></div>
        <div className="rank-item"><span className="rank-lbl">Genus slots</span><span className="rank-val">{genusSlots(rank)}</span></div>
        <div className="rank-item"><span className="rank-lbl">Cipher slots</span><span className="rank-val">{cipherSlots(rank)}</span></div>
        <span className="rank-spacer" />
        <span className={"curator-flag" + (curator ? " on" : "")}>{curator ? "Curator Mode" : "Player view · stats locked"}</span>
      </div>

      {!validation.ok && (
        <ul className="validation-list">
          {validation.errors.map((err, i) => (
            <li key={i}>{err}</li>
          ))}
        </ul>
      )}

      <div className="sheet-layout">
        <ActionsRail
          paradigmId={sheet.paradigmId}
          speciesId={sheet.speciesId}
          variantName={sheet.variantName}
          variantOption={sheet.variantOption}
          genusLoadout={sheet.genusLoadout ?? []}
          cipherLoadout={sheet.cipherLoadout ?? []}
          weaponLoadout={weaponLoadout}
          maxSS={maxSS}
          ssSpent={ssSpent}
          onSpend={spendSS}
          onRest={restSS}
          onRoll={(label) => doRoll(rollGeneric(label))}
        />
        <div className="sheet-col">
          <div className="panel-title">Attributes</div>
          <div className="stat-editor">
            {ATTRIBUTES.map((a) => (
              <div className="stat-row" key={a.key}>
                <div className="stat-info">
                  <span className="stat-short">{a.short}</span>
                </div>
                <span className="mod-box" title="Roll modifier">
                  {signedMod(rollMod(eff[a.key]))}
                </span>
                <input
                  className="stat-input"
                  type="number"
                  min={ATTR_MIN}
                  max={ATTR_MAX}
                  value={sheet.attributes[a.key]}
                  disabled={!curator}
                  onChange={(e) => setAttr(a.key, intOf(e.target.value))}
                />
                <button
                  className="roll-btn"
                  title={`Roll ${a.short}`}
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
            {SPECIALTIES.map((s) => {
              const pts = Math.min(SPEC_MAX, effSpec[s.key]);
              return (
                <div className="stat-row" key={s.key}>
                  <div className="stat-info">
                    <span className="stat-short">{s.label}</span>
                  </div>
                  <span className="mod-box" title="Roll modifier (incl. under-25 penalty)">
                    {signedMod(specRollMod(pts))}
                  </span>
                  <input
                    className={"stat-input" + (sheet.specialties[s.key] > SPEC_MAX ? " bad" : "")}
                    type="number"
                    min={0}
                    max={SPEC_MAX}
                    value={sheet.specialties[s.key]}
                    disabled={!curator}
                    onChange={(e) => setSpec(s.key, intOf(e.target.value))}
                  />
                  <button className="roll-btn" title={`Roll ${s.label}`} onClick={() => doRoll(rollSpecialty(`${s.label} Check`, pts))}>
                    d40
                  </button>
                </div>
              );
            })}
          </div>
        </div>

        <div className="sheet-col">
          <div className="panel-title">Derived stats</div>
          <DerivedPreview
            attributes={sheet.attributes}
            specialties={sheet.specialties}
            speciesId={sheet.speciesId}
            rank={rank}
            background={sheet.background}
            equipment={sheet.equipment}
            sizeId={sheet.sizeId}
          />

          {(sheet.genusLoadout?.length ?? 0) + (sheet.cipherLoadout?.length ?? 0) > 0 && (
            <>
              <div className="panel-title mt">Loadout</div>
              <div className="chip-list">
                {(sheet.genusLoadout ?? []).map((n) => (
                  <span key={"g" + n} className="load-chip">
                    {n}
                  </span>
                ))}
                {(sheet.cipherLoadout ?? []).map((n) => (
                  <span key={"c" + n} className="load-chip cipher">
                    {n}
                  </span>
                ))}
              </div>
            </>
          )}

          <div className="panel-title mt">Roll feed</div>
          <RollFeed items={feedItems} />

          <div className="panel-title mt">Notes</div>
          <textarea
            className="sheet-notes"
            placeholder="Background, gear notes, hooks…"
            value={sheet.notes || ""}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>
      </div>

      <AbilitiesPanel
        open={abilitiesOpen}
        onClose={() => setAbilitiesOpen(false)}
        paradigmId={sheet.paradigmId}
        rank={rank}
        genusLoadout={sheet.genusLoadout ?? []}
        cipherLoadout={sheet.cipherLoadout ?? []}
        onGenus={setGenus}
        onCiphers={setCiphers}
      />
      <EquipmentPanel
        open={equipmentOpen}
        onClose={() => setEquipmentOpen(false)}
        speciesId={sheet.speciesId}
        paradigmId={sheet.paradigmId}
        sizeId={sheet.sizeId}
        equipment={sheet.equipment}
        weaponLoadout={weaponLoadout}
        gearLoadout={gearLoadout}
        maxNC={maxNC}
        ncUsed={ncUsed}
        slotsUsed={slotsUsed}
        slotsMax={WEAPON_SLOTS}
        curator={curator}
        onSize={setSize}
        onEquipment={setEquipment}
        onWeapons={setWeapons}
        onGear={setGear}
      />
      <SpeciesVariantsPanel
        open={variantsOpen}
        onClose={() => setVariantsOpen(false)}
        speciesId={sheet.speciesId}
        selected={sheet.variantName}
        curator={curator}
        onSelect={setVariant}
      />
    </div>
  );
}
