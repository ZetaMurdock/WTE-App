import { codexCtx, resolveGenusLoadout, usableGenusResolved } from "../../game/resolvedGenus";
import { useCodex } from "../../game/useCodex";
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
  usableCiphers,
  usableRacial,
  getIncept,
  wrydeTier,
  wrydeTierFor,
  rollAttribute,
  rollSpecialty,
  attributeRollProfile,
  specialtyRollProfile,
  DERIVED,
  type AttrKey,
  type SpecKey,
  type DerivedKey,
  type RollResult,
  type EquipmentItem,
  sizeOf,
  ATTR_KEYS,
  SPEC_KEYS,
} from "../../game/wte";
import { DerivedPreview } from "./DerivedPreview";
import { CharacterVitals } from "./CharacterVitals";
import { ConfirmButton } from "../ui/ConfirmButton";
import { PortraitFrame } from "./PortraitFrame";
import { RollFeed, useRollFeed } from "./RollFeed";
import { SpeciesVariantsBody } from "./SpeciesVariantsPanel";
import { WeaponsBody, InventoryBody } from "./EquipmentPanel";
import { AbilitiesBody } from "./AbilitiesPanel";
import { CodexLookup } from "../codex/CodexLookup";
import { GenusMigration } from "./GenusMigration";
import { listRuleLayers } from "../../lib/ruleLayerRepo";
import type { RuleLayer } from "../../game/ruleLayers";
import { openCodexPage } from "../../lib/openCodexPage";
import { ActionsTable } from "./ActionsTable";
import { PressureEngine } from "./PressureEngine";
import { NegotiationPanel } from "./NegotiationPanel";
import { getWeapon, loadoutMods, loadoutNC, weaponSlotsUsed, WEAPON_SLOTS } from "../../lib/codex";
import type { Weapon } from "../../models/codex";
import { useNet } from "../../net/NetContext";
import { loadRules, sheetCaps, type CampaignRules } from "../../lib/campaignRules";
import {
  FOCUS_PER_RANK,
  focusRemaining,
  knownGenus,
  parseSpend,
  talentHolderBonus,
  focusBudgetWith,
  earthMoldRange,
  totalFocusSpent,
  TALENT_HOLDER_DC,
  type FocusSpend,
} from "../../game/synapticFocus";
import { RollButton } from "./RollButton";
import { RollAxisPanel } from "./RollAxisPanel";
import type { RollAxisStats } from "../../game/rollAxis";
import { GenusContestPanel } from "./GenusContestPanel";
import { CorruptSheetNotice } from "./CorruptSheetNotice";
import { SheetChangeNotice } from "./SheetChangeNotice";
import { registerSaver } from "../../lib/saveQueue";
import { pushUndo } from "../../lib/undoRedo";
import { BioFields } from "./BioFields";
import { parseBioFields, type BioField } from "../../lib/bioFields";

interface Props {
  characterId: string;
  campaignId: string;
  curator: boolean;
  onBack: () => void;
  onChanged: () => void;
}

type SheetTab = "stats" | "actions" | "resolve" | "inventory" | "loadout" | "bio";
const SHEET_TABS: { id: SheetTab; label: string }[] = [
  { id: "stats", label: "Stats" },
  { id: "actions", label: "Actions" },
  { id: "resolve", label: "Resolve" },
  { id: "inventory", label: "Inventory" },
  { id: "loadout", label: "Loadout" },
  { id: "bio", label: "Bio" },
];

function intOf(v: string): number {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : 0;
}

export function CharacterSheet({ characterId, campaignId, curator, onBack, onChanged }: Props) {
  // A campaign override arriving after this sheet mounted must reach the rows.
  useCodex();
  // The sheet KNOWS who is looking; it does not have to consult a per-machine
  // toggle to find out.
  const role: "player" | "curator" = curator ? "curator" : "player";
  // The contextual card: which stored reference the reader asked about, if any.
  const [lookUp, setLookUp] = useState<string | null>(null);
  // Layers are loaded once and filtered per lookup, rather than queried on every
  // click. A failed read leaves the card showing the definition without a
  // breakdown, which is honest — it never invents one.
  const [ruleLayers, setRuleLayers] = useState<RuleLayer[]>([]);
  useEffect(() => {
    if (!campaignId) return;
    let live = true;
    listRuleLayers(campaignId)
      .then((ls) => live && setRuleLayers(ls))
      .catch(() => live && setRuleLayers([]));
    return () => {
      live = false;
    };
  }, [campaignId]);
  const [rec, setRec] = useState<CharacterRecord | null>(null);
  const [tab, setTab] = useState<SheetTab>("stats");
  const [resolveMode, setResolveMode] = useState<"pressure" | "diplomacy">("pressure");
  const [contestAbility, setContestAbility] = useState<import("../../game/wte").UsableAbility | null>(null);
  const { items: feedItems, push: pushFeed } = useRollFeed();
  const net = useNet();
  const saveTimer = useRef<number | undefined>(undefined);
  const pending = useRef<CharacterRecord | null>(null);

  // Returns a promise so flushAll() on app close can actually AWAIT the write.
  // It used to fire and forget, which meant closing the app dropped whatever was
  // still inside the 400ms debounce.
  const flush = useCallback(async (): Promise<void> => {
    window.clearTimeout(saveTimer.current);
    const p = pending.current;
    if (!p) return;
    pending.current = null;
    await reportSaveFailure(updateCharacter(p.id, { name: p.name, sheet: p.sheet }), "this character");
    onChanged();
  }, [onChanged]);

  // Make this sheet's outstanding write visible to the save indicator and to the
  // close handler.
  const saver = useRef<ReturnType<typeof registerSaver> | null>(null);
  useEffect(() => {
    const s = registerSaver("this character", () => flush());
    saver.current = s;
    return () => {
      s.unregister();
      saver.current = null;
    };
  }, [flush]);

  useEffect(() => {
    let alive = true;
    getCharacter(characterId).then((r) => {
      if (alive) setRec(r ?? null);
    });
    return () => {
      alive = false;
    };
  }, [characterId]);

  // Flush on unmount too — navigating away from the sheet must not lose the last
  // edit either.
  useEffect(() => {
    return () => {
      void flush();
    };
  }, [flush]);

  if (!rec) {
    return (
      <div className="dashboard">
        <p className="list-empty">Loading…</p>
      </div>
    );
  }

  // A row whose `data` could not be parsed never reaches the editable sheet. The
  // sheet is state-first and autosaves 400ms after any interaction, so rendering
  // it here would write the reader's blank placeholder over the only copy of the
  // real data — which is exactly what used to happen.
  if (rec.corrupt) {
    return (
      <CorruptSheetNotice
        id={rec.id}
        name={rec.name}
        raw={rec.rawData ?? ""}
        error={rec.corruptError}
        onBack={onBack}
        onResolved={() => {
          void getCharacter(characterId).then((r) => setRec(r ?? null));
          onChanged();
        }}
      />
    );
  }

  const sheet = rec.sheet;
  const rank = sheet.rank ?? 0;
  const weaponLoadout = sheet.weaponLoadout ?? [];
  const gearLoadout = sheet.gearLoadout ?? [];
  const cipherLoadout = sheet.cipherLoadout ?? [];
  // Focus is the source of truth for genus; parseSheet migrates legacy loadouts.
  const spend = parseSpend(sheet.focusSpend);
  const knownGenusNames = knownGenus(spend);
  // Talent Holder banks extra Focus at rank-up; the bank widens the budget.
  const focusBonus = Math.max(0, Math.trunc(sheet.focusBonus ?? 0) || 0);
  const hasTalentHolder = spend.incepts.some((n) => n.toLowerCase() === "talent holder");
  const rankRolledFor = sheet.focusBonusRank ?? rank;
  const focusSpentTotal = totalFocusSpent(spend, sheet.speciesId);
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
  // Live table budgets — a Curator who lowers a cap flags every sheet that no
  // longer fits, rather than grandfathering builds nobody can rebuild.
  const rules: CampaignRules = loadRules(campaignId);
  const caps = sheetCaps(rules);
  const remaining = specialtyRemaining(sheet.specialties, caps.specTotal);
  const derived = computeDerived(sheet.attributes, sheet.specialties, {
    speciesId: sheet.speciesId,
    rank,
    bgBonuses: bgBonuses(sheet.background),
    bgSpec: bgSpecBonuses(sheet.background),
    equip,
    sizeId: sheet.sizeId,
    morality: sheet.morality,
    overrides: sheet.derivedOverrides,
    poolCompensation: rules.poolCompensation,
  });
  // Same, minus equipment/loadout — so vitals can show the gear contribution.
  const derivedBase = computeDerived(sheet.attributes, sheet.specialties, {
    speciesId: sheet.speciesId,
    rank,
    bgBonuses: bgBonuses(sheet.background),
    bgSpec: bgSpecBonuses(sheet.background),
    sizeId: sheet.sizeId,
    morality: sheet.morality,
    poolCompensation: rules.poolCompensation,
  });
  const maxSS = derived.ss;
  const ssSpent = sheet.ssSpent ?? 0;
  const currentSS = maxSS - ssSpent;
  const ssPct = maxSS > 0 ? Math.max(0, Math.min(100, (currentSS / maxSS) * 100)) : 0;
  const maxNC = derived.nc;
  const rollAxisStats: RollAxisStats = {
    attr: {
      phy: rollMod(eff.phy), ap: rollMod(eff.ap + sizeOf(sheet.sizeId, sheet.speciesId).apMod), dex: rollMod(eff.dex), end: rollMod(eff.end),
      wis: rollMod(eff.wis), int: rollMod(eff.int), cha: rollMod(eff.cha),
    },
    spec: {
      wm: specRollMod(Math.min(SPEC_MAX, effSpec.wm)), pre: specRollMod(Math.min(SPEC_MAX, effSpec.pre)),
      bal: specRollMod(Math.min(SPEC_MAX, effSpec.bal)), adp: specRollMod(Math.min(SPEC_MAX, effSpec.adp)),
      mf: specRollMod(Math.min(SPEC_MAX, effSpec.mf)), per: specRollMod(Math.min(SPEC_MAX, effSpec.per)),
      cun: specRollMod(Math.min(SPEC_MAX, effSpec.cun)),
    },
    derived: { atk: derived.atk, ad: derived.ad, ev: derived.ev, rr: derived.rr, nc: derived.ncMod, pr: derived.pr, inf: derived.inf },
    // Paradigm Affinity: favored-stat dice, unless this table turned them off.
    ...(rules.paradigmAffinity
      ? {
          affinity: {
            paradigmId: sheet.paradigmId,
            rank,
            extraAttr: ATTR_KEYS.includes(sheet.favoredAttr as AttrKey) ? (sheet.favoredAttr as AttrKey) : undefined,
            extraSpec: SPEC_KEYS.includes(sheet.favoredSpec as SpecKey) ? (sheet.favoredSpec as SpecKey) : undefined,
          },
        }
      : {}),
  };
  const ncUsed = loadoutNC(weaponLoadout, gearLoadout);
  const slotsUsed = weaponSlotsUsed(weaponLoadout);
  const validation = validateSheet(sheet.attributes, sheet.specialties, caps);
  const species = getSpecies(sheet.speciesId);
  const paradigm = getParadigm(sheet.paradigmId);
  const equippedWeapons = weaponLoadout.map((n) => getWeapon(n)).filter((w): w is Weapon => !!w);
  const racial = usableRacial(sheet.speciesId, sheet.variantName, sheet.variantOption, sheet.innateChoice);
  // Only the Incepts this character actually unlocked, with their Wryde weight.
  const unlockedIncepts = spend.incepts.map((n) => getIncept(sheet.speciesId, n)).filter((i): i is NonNullable<typeof i> => !!i);
  const sheetWryde = wrydeTierFor(sheet.speciesId, spend.incepts);
  const bioFields = parseBioFields(sheet.bioFields);

  function persist(next: CharacterRecord, forUndo: "user" | "history" = "user") {
    if (forUndo === "user" && rec) {
      const before = rec;
      pushUndo({
        label: `edit ${next.name || "character"}`,
        undo: () => persist(before, "history"),
        redo: () => persist(next, "history"),
      });
    }
    setRec(next);
    pending.current = next;
    saver.current?.markPending();
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      const p = pending.current;
      if (!p) return;
      pending.current = null;
      void reportSaveFailure(updateCharacter(p.id, { name: p.name, sheet: p.sheet }), "this character")
        .then(() => {
          saver.current?.markSaved();
          onChanged();
        })
        .catch((e) => saver.current?.markFailed(e instanceof Error ? e.message : String(e)));
    }, 400);
  }
  function setAttr(k: AttrKey, v: number) {
    persist({ ...rec!, sheet: { ...sheet, attributes: { ...sheet.attributes, [k]: Math.max(ATTR_MIN, Math.min(ATTR_MAX, v)) } } });
  }
  function setSpec(k: SpecKey, v: number) {
    persist({ ...rec!, sheet: { ...sheet, specialties: { ...sheet.specialties, [k]: Math.max(0, Math.min(SPEC_MAX, v)) } } });
  }
  function setRank(v: number) {
    const next = Math.max(0, Math.min(RANK_MAX, v));
    // Hyomen's Talent Holder rolls once per rank GAINED, ever. focusBonusRank is
    // a high-water mark: it is written on EVERY rank change and only ever climbs,
    // so a given rank number can pay out exactly once for the life of the
    // character. That is what makes the payout safe on a number input — clearing
    // the field reads as rank 0, and typing the old number back pays nothing.
    // It also means an existing high-rank character is not paid out retroactively
    // when they first take the incept.
    const ratchet = Math.max(rankRolledFor, next);
    if (!hasTalentHolder || next <= rankRolledFor) {
      persist({ ...rec!, sheet: { ...sheet, rank: next, focusBonusRank: ratchet } });
      return;
    }
    let gained = 0;
    const rolls: number[] = [];
    for (let r = rankRolledFor + 1; r <= next; r++) {
      const d100 = 1 + Math.floor(Math.random() * 100);
      rolls.push(d100);
      gained += talentHolderBonus(d100);
    }
    persist({
      ...rec!,
      sheet: { ...sheet, rank: next, focusBonus: focusBonus + gained, focusBonusRank: ratchet },
    });
    void doRoll({
      formula: `Talent Holder · rank ${rankRolledFor} → ${next}`,
      result: rolls[rolls.length - 1] ?? 0,
      detail: {
        die: 100,
        roll: rolls[rolls.length - 1] ?? 0,
        modifier: 0,
        label: `${rolls.join(", ")} vs ${TALENT_HOLDER_DC}+ · ${gained ? `+${gained} SF` : "no gain"}`,
      },
    });
  }
  function setBioFields(next: BioField[]) {
    persist({ ...rec!, sheet: { ...sheet, bioFields: next } });
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
  function setOverride(k: DerivedKey | "hpMax" | "ncMod", raw: string) {
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
  function setSpend(next: FocusSpend) {
    // genusLoadout is the COMPATIBILITY field: a flat list of what this character
    // knows, for the legacy sheet, exports and any older reader. Those readers
    // match on DISPLAY NAMES.
    //
    // knownGenus returns the raw Focus-map keys, which after a stable-id
    // migration are ids — so keeping the two literally "in step" filled the
    // compatibility field with `wte.genus.lark` strings that no legacy reader
    // matches, turning a migration into visible damage on the exact surface that
    // exists to prevent it. Project resolved names instead; an unresolved key
    // still comes through as whatever the character stored, so nothing is lost.
    persist({
      ...rec!,
      sheet: {
        ...sheet,
        focusSpend: next,
        genusLoadout: resolveGenusLoadout(knownGenus(next), codexCtx(campaignId, characterId, role)).map(
          (r) => r.displayName
        ),
      },
    });
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

      {/* What someone else changed on this sheet while its owner was not looking.
          Sits under the banner and above the stats: high enough to be seen on
          open, low enough that it never displaces the character's identity. */}
      <SheetChangeNotice characterId={rec.id} />

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
        <div
          className="rank-item"
          title={
            `${FOCUS_PER_RANK} Synaptic Focus per rank; spent on Genus and Incepts` +
            (focusBonus > 0 ? ` · +${focusBonus} banked by Talent Holder` : "")
          }
        >
          <span className="rank-lbl">Focus left</span>
          <span className={"rank-val" + (focusRemaining(rank, spend, sheet.speciesId, focusBonus) < 0 ? " over" : "")}>
            {focusRemaining(rank, spend, sheet.speciesId, focusBonus)} / {focusBudgetWith(rank, focusBonus)}
            {focusBonus > 0 && <span className="focus-banked"> +{focusBonus}</span>}
          </span>
        </div>
        <div className="rank-item"><span className="rank-lbl">Cipher slots</span><span className="rank-val">{cipherSlots(rank)}</span></div>
        <span className="rank-spacer" />
        {curator && <span className="curator-flag on">Curator Mode</span>}
      </div>

      <CharacterVitals
        derived={derived}
        derivedBase={derivedBase}
        ssSpent={ssSpent}
        hpDamage={sheet.hpDamage}
        dhpDamage={sheet.dhpDamage}
        curator={curator}
        onUpdateVitals={({ hpDamage, dhpDamage, ssSpent, hpMaxOverride, dhpOverride }) => {
          const nextSheet = { ...sheet };
          if (hpDamage !== undefined) nextSheet.hpDamage = Math.max(0, hpDamage);
          if (dhpDamage !== undefined) nextSheet.dhpDamage = Math.max(0, dhpDamage);
          if (ssSpent !== undefined) nextSheet.ssSpent = Math.max(0, ssSpent);
          if (hpMaxOverride !== undefined || dhpOverride !== undefined) {
            const overrides = { ...(sheet.derivedOverrides ?? {}) };
            if (hpMaxOverride !== undefined) overrides.hpMax = hpMaxOverride;
            if (dhpOverride !== undefined) overrides.dhp = dhpOverride;
            nextSheet.derivedOverrides = overrides;
          }
          persist({ ...rec!, sheet: nextSheet });
        }}
      />

      <div className="sheet-derived-under">
        <div className="panel-title">Derived Statistics</div>
        <DerivedPreview
          attributes={sheet.attributes}
          specialties={sheet.specialties}
          speciesId={sheet.speciesId}
          rank={rank}
          background={sheet.background}
          equipMods={equip}
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

        {contestAbility && (
          <GenusContestPanel
            ability={contestAbility}
            control={effSpec.ctrl}
            rank={rank}
            canBorrow={spend.incepts.some((n) => n.toLowerCase() === "identity theft")}
            onRoll={doRoll}
            onClose={() => setContestAbility(null)}
          />
        )}

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
              <RollAxisPanel
                stats={rollAxisStats}
                onRoll={doRoll}
                fieldAffinity={
                  paradigm?.favoredChoice
                    ? {
                        attr: ATTR_KEYS.includes(sheet.favoredAttr as AttrKey) ? (sheet.favoredAttr as AttrKey) : undefined,
                        spec: SPEC_KEYS.includes(sheet.favoredSpec as SpecKey) ? (sheet.favoredSpec as SpecKey) : undefined,
                        fixedAttr: paradigm.favoredAttrs ?? [],
                        fixedSpec: paradigm.favoredSpecs ?? [],
                        onChange: (attr, spec) =>
                          persist({ ...rec!, sheet: { ...sheet, favoredAttr: attr, favoredSpec: spec } }),
                      }
                    : undefined
                }
              />
            )}
            {tab === "stats" && (
              <div className="stats-grid">
                <div className="stats-col">
                  <div className="panel-title">Attributes</div>
                  <div className="stat-editor">
                    {ATTRIBUTES.map((a) => {
                      const score = eff[a.key] + (a.key === "ap" ? sizeOf(sheet.sizeId, sheet.speciesId).apMod : 0);
                      const profile = attributeRollProfile(score);
                      return <div className="stat-row" key={a.key}>
                        <div className="stat-info">
                          <span className="stat-short">{a.short}</span>
                        </div>
                        <span className="mod-box" title={profile.codexFormulaId ? "Modifier from the campaign Codex Roll Formula" : "Roll modifier"}>
                          {signedMod(profile.modifier)}
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
                          make={(mode) => rollAttribute(`${a.short} Check`, score, mode)}
                          onLocal={doRoll}
                        >
                          d{profile.die}
                        </RollButton>
                      </div>
                    })}
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
                      const profile = specialtyRollProfile(pts);
                      return (
                        <div className="stat-row" key={s.key}>
                          <div className="stat-info">
                            <span className="stat-short">{s.label}</span>
                          </div>
                          <span className="mod-box" title={profile.codexFormulaId ? "Modifier from the campaign Codex Roll Formula" : "Roll modifier (incl. under-25 penalty)"}>
                            {signedMod(profile.modifier)}
                          </span>
                          <input
                            className={"stat-input" + (sheet.specialties[s.key] > SPEC_MAX ? " bad" : "")}
                            type="number"
                            min={0}
                            max={SPEC_MAX}
                            value={sheet.specialties[s.key]}
                            onChange={(e) => setSpec(s.key, intOf(e.target.value))}
                          />
                          <RollButton className="roll-btn" title={`Roll ${s.label}`} make={(mode) => rollSpecialty(`${s.label} Check`, pts, mode)} onLocal={doRoll}>
                            d{profile.die}
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
                      <label className="override-cell" title="Neuronal Capacity CHECK modifier (the NC number above is the equipment budget)">
                        <span>NC mod</span>
                        <input
                          type="number"
                          placeholder={String(derived.ncMod)}
                          value={sheet.derivedOverrides?.ncMod ?? ""}
                          onChange={(e) => setOverride("ncMod", e.target.value)}
                        />
                      </label>
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
                rollAxisStats={rollAxisStats}
                weapons={equippedWeapons}
                genus={usableGenusResolved(knownGenusNames, codexCtx(campaignId, characterId, role), spend.genus, ruleLayers)}
                ciphers={usableCiphers(sheet.paradigmId, cipherLoadout)}
                atk={derived.atk}
                phyMod={rollMod(eff.phy)}
                dexMod={rollMod(eff.dex)}
                paradigmId={sheet.paradigmId}
                onRoll={doRoll}
                onSpend={spendSS}
                ssLeft={currentSS}
                onManage={() => setTab("loadout")}
                // Contests are the Curator's move: they hold the opposing
                // numbers, and the VTT resolves them automatically from records.
                onContest={curator ? (a) => setContestAbility(a) : undefined}
              />
            )}

            {/* Pressure and Negotiation run the same chassis — a situation vs a
                person — so they live on one tab, switched rather than separate. */}
            {tab === "resolve" && (
              <>
                <div className="chip-row resolve-switch">
                  <button
                    className={"chip" + (resolveMode === "pressure" ? " active" : "")}
                    onClick={() => setResolveMode("pressure")}
                  >
                    Pressure
                  </button>
                  <button
                    className={"chip" + (resolveMode === "diplomacy" ? " active" : "")}
                    onClick={() => setResolveMode("diplomacy")}
                  >
                    Diplomacy
                  </button>
                  <span className="resolve-hint">
                    {resolveMode === "pressure"
                      ? "A situation pushing back — multi-skill AAV vs Pressure."
                      : "A person pushing back — the same chassis, plus Influence and Eminence."}
                  </span>
                </div>
                {resolveMode === "pressure" ? (
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
                ) : (
                  <NegotiationPanel
                    attrs={eff}
                    specs={effSpec}
                    rank={rank}
                    morality={sheet.morality}
                    influenceMod={derived.inf}
                    eminence={sheet.eminence ?? 0}
                    client={sheet.negotiation ?? {}}
                    onClient={(next) => persist({ ...rec!, sheet: { ...sheet, negotiation: next } })}
                    onRoll={doRoll}
                  />
                )}
              </>
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
                    speciesId={sheet.speciesId}
                    innateChoice={sheet.innateChoice}
                    rank={rank}
                    spend={spend}
                    bonusFocus={focusBonus}
                    cipherLoadout={cipherLoadout}
                    onSpend={setSpend}
                    onCiphers={setCiphers}
                    onLookUp={setLookUp}
                    campaignId={campaignId}
                    characterId={characterId}
                    layers={ruleLayers}
                    role={role}
                  />
                  {/* Deliberate, and the only thing that rewrites ability keys. */}
                  <GenusMigration
                    spend={spend}
                    campaignId={campaignId}
                    characterId={characterId}
                    role={role}
                    onApply={(genus) => setSpend({ ...spend, genus })}
                  />
                </div>
              </div>
            )}

            {/* Bio shows only what THIS character actually has — no empty
                scaffolding for things they never took. */}
            {tab === "bio" && (
              <>
                {racial.length > 0 && (
                  <>
                    <div className="panel-title">
                      Innate Features{" "}
                      <span className="load-badge">
                        {racial.length}
                        {species ? " · " + species.name : ""}
                      </span>
                    </div>
                    <ul className="variant-abilities">
                      {racial.map((a, i) => (
                        <li key={i}>
                          <b>{a.name}</b>
                          {a.effect ? ` — ${a.effect}` : ""}
                        </li>
                      ))}
                    </ul>
                  </>
                )}

                {unlockedIncepts.length > 0 && (
                  <>
                    <div className="panel-title mt">
                      Incepts <span className="load-badge">{unlockedIncepts.length} · Wryde {sheetWryde.label}</span>
                    </div>
                    <ul className="variant-abilities">
                      {unlockedIncepts.map((i) => (
                        <li key={i.name}>
                          <b>{i.name}</b>
                          <span className={"wryde-badge t" + wrydeTier(i.weight).tier}>{i.weight}</span>
                          {/* Incepts that scale off Focus spent are worked out here rather
                              than left as arithmetic in the player's head. */}
                          {i.name === "Earth Mold" && (
                            <span
                              className="incept-derived"
                              title={
                                `${focusSpentTotal} Focus spent = ${Math.floor(focusSpentTotal / 2)} steps · ` +
                                `half NC mod (${Math.floor(derived.ncMod / 2)}) + Control mod (${rollMod(effSpec.ctrl)}) per step`
                              }
                            >
                              Range {earthMoldRange(focusSpentTotal, derived.ncMod, rollMod(effSpec.ctrl))} ft
                            </span>
                          )}
                          {i.name === "Talent Holder" && (
                            <span className="incept-derived" title={`Rolled through rank ${rankRolledFor}`}>
                              {focusBonus > 0 ? `+${focusBonus} SF banked` : "nothing banked yet"}
                            </span>
                          )}
                          {i.memory ? <em className="incept-memory"> {i.memory}</em> : null}
                          {i.effect ? ` — ${i.effect}` : ""}
                        </li>
                      ))}
                    </ul>
                  </>
                )}

                <div className="panel-title mt">Personal Details</div>
                <BioFields fields={bioFields} onChange={setBioFields} />

                <div className="bio-grid mt">
                  {species && species.variants.length > 0 && (
                    <div>
                      <div className="panel-title">
                        {species.name} Variants{" "}
                        {sheet.variantName && <span className="load-badge">{sheet.variantName}</span>}
                      </div>
                      <SpeciesVariantsBody
                        speciesId={sheet.speciesId}
                        selected={sheet.variantName}
                        curator={curator}
                        onSelect={setVariant}
                      />
                    </div>
                  )}
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

                {!species && racial.length === 0 && (
                  <p className="list-empty mt">
                    Choose a species to see innate features, variants and an Incept pool.
                  </p>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {/* What does this term mean HERE? Resolved against this campaign, this
          character and this session — and it asks rather than guesses when the
          Codex cannot decide. */}
      {lookUp && (
        <CodexLookup
          storedRef={lookUp}
          campaignId={campaignId}
          characterId={characterId}
          role={role}
          layers={ruleLayers}
          onOpenPage={(stem, anchor) => {
            openCodexPage(stem, anchor);
            setLookUp(null);
          }}
          onClose={() => setLookUp(null)}
        />
      )}
    </div>
  );
}
