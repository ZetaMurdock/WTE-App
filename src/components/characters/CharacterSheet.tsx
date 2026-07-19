import { useCallback, useEffect, useRef, useState } from "react";
import { getCharacter, updateCharacter, deleteCharacter, type CharacterRecord } from "../../lib/characters";
import { logRoll } from "../../lib/rolls";
import { reportSaveFailure } from "../../lib/appToast";
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
  bgSpecBonuses,
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
  getSector,
  moralityState,
  moralityMods,
  eminenceState,
  PE_MAX,
  PE_DEFAULT,
  usableGenus,
  usableCiphers,
  usableRacial,
  rollAttribute,
  rollSpecialty,
  DERIVED,
  type AttrKey,
  type SpecKey,
  type DerivedKey,
  type RollResult,
  type EquipmentItem,
} from "../../game/wte";
import { DerivedPreview } from "./DerivedPreview";
import { CharacterVitals } from "./CharacterVitals";
import { ConfirmButton } from "../ui/ConfirmButton";
import { PortraitFrame } from "./PortraitFrame";
import { RollFeed, useRollFeed } from "./RollFeed";
import { SpeciesVariantsBody } from "./SpeciesVariantsPanel";
import { WeaponsBody, InventoryBody } from "./EquipmentPanel";
import { AbilitiesBody } from "./AbilitiesPanel";
import { ActionsTable } from "./ActionsTable";
import { PressureEngine } from "./PressureEngine";
import { getWeapon, loadoutMods, loadoutNC, weaponSlotsUsed, WEAPON_SLOTS } from "../../lib/codex";
import type { Weapon } from "../../models/codex";
import { useNet } from "../../net/NetContext";
import { RollButton } from "./RollButton";

interface Props {
  characterId: string;
  campaignId: string;
  curator: boolean;
  onBack: () => void;
  onChanged: () => void;
}

type SheetTab = "stats" | "actions" | "pressure" | "inventory" | "loadout" | "bio";
const SHEET_TABS: { id: SheetTab; label: string }[] = [
  { id: "stats", label: "Stats" },
  { id: "actions", label: "Actions" },
  { id: "pressure", label: "Pressure" },
  { id: "inventory", label: "Inventory" },
  { id: "loadout", label: "Loadout" },
  { id: "bio", label: "Bio" },
];

function intOf(v: string): number {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : 0;
}

export function CharacterSheet({ characterId, campaignId, curator, onBack, onChanged }: Props) {
  const [rec, setRec] = useState<CharacterRecord | null>(null);
  const [tab, setTab] = useState<SheetTab>("stats");
  const { items: feedItems, push: pushFeed } = useRollFeed();
  const net = useNet();
  const saveTimer = useRef<number | undefined>(undefined);
  const pending = useRef<CharacterRecord | null>(null);

  const flush = useCallback(() => {
    window.clearTimeout(saveTimer.current);
    const p = pending.current;
    if (p) {
      pending.current = null;
      void reportSaveFailure(updateCharacter(p.id, { name: p.name, sheet: p.sheet }), "this character").then(onChanged);
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
  const genusLoadout = sheet.genusLoadout ?? [];
  const cipherLoadout = sheet.cipherLoadout ?? [];
  const equip = mergeMods(aggregateEquip(sheet.equipment), loadoutMods(weaponLoadout, gearLoadout));
  // Soul mechanics fold into the shown effective values (Process: +3 INT / +3 Control).
  const soulMods = moralityMods(sheet.morality);
  const bgPlusSoul = { ...bgBonuses(sheet.background) };
  for (const [k, v] of Object.entries(soulMods.attr)) bgPlusSoul[k as AttrKey] = (bgPlusSoul[k as AttrKey] || 0) + (v || 0);
  const eff = effectiveAttributes(sheet.attributes, sheet.speciesId, bgPlusSoul, equip.attr);
  const specPlusSoul = { ...equip.spec };
  for (const [k, v] of Object.entries(soulMods.spec)) specPlusSoul[k as SpecKey] = (specPlusSoul[k as SpecKey] || 0) + (v || 0);
  for (const [k, v] of Object.entries(bgSpecBonuses(sheet.background))) specPlusSoul[k as SpecKey] = (specPlusSoul[k as SpecKey] || 0) + (v || 0);
  const effSpec = effectiveSpecialties(sheet.specialties, specPlusSoul);
  const remaining = specialtyRemaining(sheet.specialties);
  const derived = computeDerived(sheet.attributes, sheet.specialties, {
    speciesId: sheet.speciesId,
    rank,
    bgBonuses: bgBonuses(sheet.background),
    bgSpec: bgSpecBonuses(sheet.background),
    equip,
    sizeId: sheet.sizeId,
    morality: sheet.morality,
    overrides: sheet.derivedOverrides,
  });
  // Same, minus equipment/loadout — so vitals can show the gear contribution.
  const derivedBase = computeDerived(sheet.attributes, sheet.specialties, {
    speciesId: sheet.speciesId,
    rank,
    bgBonuses: bgBonuses(sheet.background),
    bgSpec: bgSpecBonuses(sheet.background),
    sizeId: sheet.sizeId,
    morality: sheet.morality,
  });
  const maxSS = derived.ss;
  const ssSpent = sheet.ssSpent ?? 0;
  const currentSS = maxSS - ssSpent;
  const ssPct = maxSS > 0 ? Math.max(0, Math.min(100, (currentSS / maxSS) * 100)) : 0;
  const maxNC = derived.nc;
  const ncUsed = loadoutNC(weaponLoadout, gearLoadout);
  const slotsUsed = weaponSlotsUsed(weaponLoadout);
  const validation = validateSheet(sheet.attributes, sheet.specialties);
  const species = getSpecies(sheet.speciesId);
  const paradigm = getParadigm(sheet.paradigmId);
  const equippedWeapons = weaponLoadout.map((n) => getWeapon(n)).filter((w): w is Weapon => !!w);
  const racial = usableRacial(sheet.speciesId, sheet.variantName, sheet.variantOption);

  function persist(next: CharacterRecord) {
    setRec(next);
    pending.current = next;
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      const p = pending.current;
      if (!p) return;
      pending.current = null;
      void reportSaveFailure(updateCharacter(p.id, { name: p.name, sheet: p.sheet }), "this character").then(onChanged);
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
  function setPortrait(dataUrl: string | null) {
    persist({ ...rec!, sheet: { ...sheet, portrait: dataUrl ?? undefined } });
  }
  function setVariant(name: string | undefined) {
    persist({ ...rec!, sheet: { ...sheet, variantName: name } });
  }
  function setSize(sizeId: string) {
    persist({ ...rec!, sheet: { ...sheet, sizeId } });
  }
  function setMorality(v: number) {
    persist({ ...rec!, sheet: { ...sheet, morality: Math.max(0, Math.min(100, v)) } });
  }
  function setAllowOverrides(v: boolean) {
    persist({ ...rec!, sheet: { ...sheet, allowOverrides: v || undefined } });
  }
  function setOverride(k: DerivedKey | "hpMax", raw: string) {
    const cur: Record<string, number> = { ...(sheet.derivedOverrides ?? {}) };
    const n = parseInt(raw, 10);
    if (raw.trim() === "" || !Number.isFinite(n)) delete cur[k];
    else cur[k] = n;
    persist({ ...rec!, sheet: { ...sheet, derivedOverrides: Object.keys(cur).length ? cur : undefined } });
  }
  function setEminence(v: number) {
    persist({ ...rec!, sheet: { ...sheet, eminence: Math.max(-20, Math.min(20, v)) } });
  }
  function setPressure(v: number) {
    persist({ ...rec!, sheet: { ...sheet, pressure: Math.max(0, Math.min(PE_MAX, v)) } });
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
  function shareToParty() {
    net.publish({
      t: "party",
      charId: rec!.id,
      name: rec!.name,
      summary: { species: species?.name, paradigm: paradigm?.name, rank, hp: derived.hpMax, ss: maxSS, nc: maxNC },
    });
  }

  return (
    <div className="dashboard char-sheet">
      <div className="sheet-banner">
        <PortraitFrame src={sheet.portrait} onChange={setPortrait} size="md" />
        <div className="sheet-banner-body">
          <div className="dash-eyebrow">
            {[species?.name, sheet.variantName, paradigm?.name].filter(Boolean).join(" · ") || "Inquisitor"}
          </div>
          <h1 className="dash-title">{rec.name}</h1>
          <div className="sheet-soul-line">
            {getSector(sheet.sector) && <span>{getSector(sheet.sector)!.name} · {getSector(sheet.sector)!.epithet}</span>}
            <span
              className="sheet-soul"
              title={
                "Polarized Soul — 0 Process · 100 Resonance. Shifts in play." +
                (moralityMods(sheet.morality).note ? `\nActive: ${moralityMods(sheet.morality).note}` : "")
              }
            >
              Soul
              <input
                className="sheet-stat-num"
                type="number"
                min={0}
                max={100}
                value={sheet.morality ?? 50}
                onChange={(e) => setMorality(parseInt(e.target.value, 10) || 0)}
              />
              · {moralityState(sheet.morality ?? 50).label}
            </span>
            <span
              className="sheet-soul"
              title="Eminence — System Alignment Index (−20 liability … +20 asset, start 0). Curator-adjusted by impact, not intent; shapes HOW advancement manifests. See the built-in Eminence page."
            >
              Eminence
              <input
                className="sheet-stat-num"
                type="number"
                min={-20}
                max={20}
                value={sheet.eminence ?? 0}
                onChange={(e) => setEminence(parseInt(e.target.value, 10) || 0)}
              />
              · {eminenceState(sheet.eminence ?? 0)}
            </span>
            {moralityMods(sheet.morality).note && <span className="sheet-soul-note">{moralityMods(sheet.morality).note}</span>}
          </div>
        </div>
        <div className="sheet-banner-actions">
          {net.status === "connected" && (
            <button className="ghost-btn" onClick={shareToParty} title="Broadcast this character's summary to the room">
              Share to party
            </button>
          )}
          <ConfirmButton
            className="ghost-btn"
            label="Delete"
            confirmLabel="Delete forever"
            title="Delete this character"
            onConfirm={async () => {
              await deleteCharacter(rec!.id);
              onBack();
            }}
          />
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
            onChange={(e) => setRank(intOf(e.target.value))}
          />
        </div>
        <div className="rank-item"><span className="rank-lbl">HP mult</span><span className="rank-val">×{rankMult(rank).toFixed(2)}</span></div>
        <div className="rank-item"><span className="rank-lbl">Genus slots</span><span className="rank-val">{genusSlots(rank)}</span></div>
        <div className="rank-item"><span className="rank-lbl">Cipher slots</span><span className="rank-val">{cipherSlots(rank)}</span></div>
        <span className="rank-spacer" />
        {curator && <span className="curator-flag on">Curator Mode</span>}
      </div>

      <CharacterVitals derived={derived} derivedBase={derivedBase} ssSpent={ssSpent} />

      <div className="sheet-derived-under">
        <div className="panel-title">Derived Statistics</div>
        <DerivedPreview
          attributes={sheet.attributes}
          specialties={sheet.specialties}
          speciesId={sheet.speciesId}
          rank={rank}
          background={sheet.background}
          equipment={sheet.equipment}
          sizeId={sheet.sizeId}
          exclude={["dhp", "mv", "ss"]}
          showHp={false}
        />
      </div>

      {!validation.ok && (
        <ul className="validation-list">
          {validation.errors.map((err, i) => (
            <li key={i}>{err}</li>
          ))}
        </ul>
      )}

      <div className="sheet-layout">
        <div className="sheet-rail">
          <div className="ss-bar">
            <div className="ss-line">
              <span className="ss-lbl">Synaptic Space</span>
              <span className={"ss-val" + (currentSS < 0 ? " neg" : "")}>{currentSS} / {maxSS}</span>
            </div>
            <div className="ss-track">
              <div className={"ss-fill" + (currentSS < 0 ? " neg" : "")} style={{ width: `${ssPct}%` }} />
            </div>
            <button className="ghost-btn ss-rest" onClick={restSS}>Rest</button>
          </div>
          <div className="panel-title">Roll feed</div>
          <RollFeed items={feedItems} />
        </div>

        <div className="sheet-tabbox">
          <div className="sheet-tabstrip" role="tablist">
            {SHEET_TABS.map((t) => (
              <button
                key={t.id}
                role="tab"
                aria-selected={tab === t.id}
                className={"sheet-tab" + (tab === t.id ? " active" : "")}
                onClick={() => setTab(t.id)}
              >
                {t.label}
              </button>
            ))}
          </div>

          <div className="sheet-tabpanel">
            {tab === "stats" && (
              <div className="stats-grid">
                <div className="stats-col">
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
                        {eff[a.key] !== sheet.attributes[a.key] && (
                          <span className="stat-eff" title="Effective value — includes species, background & equipped gear bonuses">
                            ={eff[a.key]}
                          </span>
                        )}
                        <input
                          className="stat-input"
                          type="number"
                          min={ATTR_MIN}
                          max={ATTR_MAX}
                          value={sheet.attributes[a.key]}
                          onChange={(e) => setAttr(a.key, intOf(e.target.value))}
                        />
                        <RollButton
                          className="roll-btn"
                          title={`Roll ${a.short}`}
                          make={() => rollAttribute(`${a.short} Check`, eff[a.key])}
                          onLocal={doRoll}
                        >
                          d20
                        </RollButton>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="stats-col">
                  <div className="panel-title">
                    Specialties
                    <span className={"points-inline" + (remaining < 0 ? " over" : "")}>
                      {remaining >= 0 ? `${remaining} left` : `−${-remaining}`}
                    </span>
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
                            onChange={(e) => setSpec(s.key, intOf(e.target.value))}
                          />
                          <RollButton className="roll-btn" title={`Roll ${s.label}`} make={() => rollSpecialty(`${s.label} Check`, pts)} onLocal={doRoll}>
                            d20
                          </RollButton>
                        </div>
                      );
                    })}
                  </div>
                </div>

              </div>
            )}
            {tab === "stats" && (
              <div className="overrides-block">
                <div className="panel-title">
                  Stat overrides
                  {curator ? (
                    <button
                      className={"chip" + (sheet.allowOverrides ? " active" : "")}
                      style={{ marginLeft: 10 }}
                      onClick={() => setAllowOverrides(!sheet.allowOverrides)}
                      title="Let this character's player hand-edit these overrides themselves"
                    >
                      {sheet.allowOverrides ? "Player editing allowed" : "Curator only"}
                    </button>
                  ) : (
                    !sheet.allowOverrides && <span className="points-inline">locked by Curator</span>
                  )}
                </div>
                {curator || sheet.allowOverrides ? (
                  <>
                    <p className="inv-sub">Blank = computed by the formulas. A number replaces the computed value everywhere — sheet, actions, and VTT token.</p>
                    <div className="override-grid">
                      {DERIVED.map((d) => (
                        <label key={d.key} className="override-cell" title={d.label}>
                          <span>{d.short}</span>
                          <input
                            type="number"
                            placeholder={String(derived[d.key])}
                            value={sheet.derivedOverrides?.[d.key] ?? ""}
                            onChange={(e) => setOverride(d.key, e.target.value)}
                          />
                        </label>
                      ))}
                      <label className="override-cell" title="Maximum hit points">
                        <span>Max HP</span>
                        <input
                          type="number"
                          placeholder={String(derived.hpMax)}
                          value={sheet.derivedOverrides?.hpMax ?? ""}
                          onChange={(e) => setOverride("hpMax", e.target.value)}
                        />
                      </label>
                    </div>
                  </>
                ) : (
                  <p className="inv-sub">Your Curator can unlock hand-editing of derived stats for this character.</p>
                )}
              </div>
            )}

            {tab === "actions" && (
              <ActionsTable
                weapons={equippedWeapons}
                genus={usableGenus(sheet.paradigmId, genusLoadout)}
                ciphers={usableCiphers(sheet.paradigmId, cipherLoadout)}
                atk={derived.atk}
                phyMod={rollMod(eff.phy)}
                dexMod={rollMod(eff.dex)}
                paradigmId={sheet.paradigmId}
                onRoll={doRoll}
                onSpend={spendSS}
                onManage={() => setTab("loadout")}
              />
            )}

            {tab === "pressure" && (
              <PressureEngine
                attrs={eff}
                specs={effSpec}
                rank={rank}
                morality={sheet.morality}
                pressure={net.status === "connected" ? net.bp : sheet.pressure ?? PE_DEFAULT}
                onPressure={net.status === "connected" ? net.setSharedBp : setPressure}
                shared={net.status === "connected"}
                onRoll={doRoll}
              />
            )}

            {tab === "inventory" && (
              <InventoryBody
                speciesId={sheet.speciesId}
                sizeId={sheet.sizeId}
                equipment={sheet.equipment}
                weaponLoadout={weaponLoadout}
                gearLoadout={gearLoadout}
                maxNC={maxNC}
                ncUsed={ncUsed}
                curator={true}
                onSize={setSize}
                onEquipment={setEquipment}
                onGear={setGear}
              />
            )}

            {tab === "loadout" && (
              <div className="loadout-grid">
                <div>
                  <div className="panel-title">Weapons</div>
                  <WeaponsBody
                    weaponLoadout={weaponLoadout}
                    maxNC={maxNC}
                    ncUsed={ncUsed}
                    slotsUsed={slotsUsed}
                    slotsMax={WEAPON_SLOTS}
                    curator={true}
                    onWeapons={setWeapons}
                  />
                </div>
                <div>
                  <div className="panel-title">Genus &amp; Ciphers</div>
                  <AbilitiesBody
                    paradigmId={sheet.paradigmId}
                    rank={rank}
                    genusLoadout={genusLoadout}
                    cipherLoadout={cipherLoadout}
                    onGenus={setGenus}
                    onCiphers={setCiphers}
                  />
                </div>
              </div>
            )}

            {tab === "bio" && (
              <>
                <div className="panel-title">Features &amp; Traits</div>
                {racial.length ? (
                  <ul className="variant-abilities">
                    {racial.map((a, i) => (
                      <li key={i}>
                        <b>{a.name}</b>
                        {a.effect ? ` — ${a.effect}` : ""}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="list-empty">No innate features.</p>
                )}
                <div className="bio-grid mt">
                  <div>
                    <div className="panel-title">Species Variants</div>
                    <SpeciesVariantsBody
                      speciesId={sheet.speciesId}
                      selected={sheet.variantName}
                      curator={curator}
                      onSelect={setVariant}
                    />
                  </div>
                  <div>
                    <div className="panel-title">Notes</div>
                    <textarea
                      className="sheet-notes"
                      placeholder="Background, gear notes, hooks…"
                      value={sheet.notes || ""}
                      onChange={(e) => setNotes(e.target.value)}
                    />
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
