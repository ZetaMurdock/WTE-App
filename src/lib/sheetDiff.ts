// What changed on a character sheet, said the way the table says it.
//
// WHY THIS EXISTS: the Curator can now open and edit a player's sheet whether or
// not that player is connected. Without a record of what was touched, a player
// who logs in after a week of Curator edits sees different numbers and no
// explanation — which reads as "the app lost my character", the exact complaint
// the corrupt-record work was about. This module turns two CharacterRecords into
// lines a player can read: "Rank 3 → 4", "Blight 2 → 5", "unlocked Talent Holder".
//
// TWO RULES, both of which a naive field-by-field dump gets wrong:
//
// 1. NOTHING IS SAID IN THE DATA MODEL'S LANGUAGE. `hpDamage 8 → 16` is not what
//    happened; `HP 32 → 24` is. `focusSpend.genus.Pyrokinesis` is not a sentence.
//    Keys, JSON and internal ids never reach the player.
//
// 2. A CHANGE THAT MEANS NOTHING PRODUCES NOTHING. Re-saving a sheet rewrites it
//    through the codec, which fills in defaults ("" notes, [] loadouts, sizeId
//    "auto", a migrated focusSpend). Comparing raw stored objects would fire a
//    notice on every save, and a notice that always fires is one the player
//    learns to ignore. Both sides are therefore normalised through the SAME codec
//    that partySheets' content hash trusts, so "no real change" means here what it
//    means there.
import type { CharacterRecord } from "./characters";
import type { CharacterSheet } from "../models/character";
import { parseSheetSafe, serializeSheet, type SheetKey } from "./sheetCodec";
import { parseBioFields } from "./bioFields";
import { getWeapon, getEquipment, loadoutMods } from "./codex";
import {
  ATTRIBUTES,
  SPECIALTIES,
  DERIVED,
  aggregateEquip,
  mergeMods,
  computeDerived,
  bgBonuses,
  bgSpecBonuses,
  getSpecies,
  getParadigm,
  getSector,
  moralityState,
  sizeOf,
  type AttrKey,
  type SpecKey,
  type DerivedKey,
  type EquipmentItem,
} from "../game/wte";

/** Table policy that moves the derived pools. Both sides of a diff belong to the
 *  same character, so one value covers them; the caller passes what the campaign
 *  actually runs so the HP in the notice matches the HP on the sheet. */
export interface SheetDiffOpts {
  poolCompensation?: boolean;
}

// ── Normalisation ───────────────────────────────────────────────────────────────

/** Put a sheet through the storage round trip, so a record built in memory and one
 *  read back out of the database are compared on equal terms. Anything that
 *  survives this and still differs is a real edit. */
function normalize(sheet: CharacterSheet): CharacterSheet {
  return parseSheetSafe(serializeSheet(sheet)).sheet;
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((v, i) => deepEqual(v, b[i]));
  }
  const ao = a as Record<string, unknown>;
  const bo = b as Record<string, unknown>;
  // Key ORDER must not count: two records that reached us by different routes
  // (one parsed from the wire, one rebuilt by the sheet) carry the same fields in
  // different order, and a stringify comparison would call that an edit.
  const ak = Object.keys(ao).filter((k) => ao[k] !== undefined);
  const bk = Object.keys(bo).filter((k) => bo[k] !== undefined);
  if (ak.length !== bk.length) return false;
  return ak.every((k) => k in bo && deepEqual(ao[k], bo[k]));
}

// ── Shared phrasing ─────────────────────────────────────────────────────────────

const signed = (n: number): string => (n > 0 ? `+${n}` : String(n));

/** "Rank 3 → 4", or nothing when the number did not move. */
function num(label: string, a: number | undefined, b: number | undefined, fmt: (n: number) => string = String): string[] {
  const x = a ?? 0;
  const y = b ?? 0;
  return x === y ? [] : [`${label} ${fmt(x)} → ${fmt(y)}`];
}

/** "Species Human → Annunaki", "Sector cleared", "Sector set to Ninth". */
function named(label: string, a: string | undefined, b: string | undefined): string[] {
  const x = a?.trim() || "";
  const y = b?.trim() || "";
  if (x === y) return [];
  if (!x) return [`${label} set to ${y}`];
  if (!y) return [`${label} cleared (was ${x})`];
  return [`${label} ${x} → ${y}`];
}

/** Gains and losses in a list of names — loadouts, tags, Incepts, innates. */
function listDelta(gained: string, lost: string, a: string[], b: string[]): string[] {
  const before = new Set(a);
  const after = new Set(b);
  const out: string[] = [];
  for (const n of b) if (!before.has(n)) out.push(`${gained} ${n}`);
  for (const n of a) if (!after.has(n)) out.push(`${lost} ${n}`);
  return out;
}

// ── Derived pools ───────────────────────────────────────────────────────────────

/** The pool ceilings as the sheet itself computes them, so "HP 32 → 24" is the
 *  number the player is looking at and not a raw damage counter. */
function poolsOf(sheet: CharacterSheet, opts: SheetDiffOpts): { hpMax: number; dhpMax: number; ssMax: number } {
  const equip = mergeMods(
    aggregateEquip(sheet.equipment ?? []),
    loadoutMods(sheet.weaponLoadout ?? [], sheet.gearLoadout ?? [])
  );
  const d = computeDerived(sheet.attributes, sheet.specialties, {
    speciesId: sheet.speciesId,
    rank: sheet.rank ?? 0,
    bgBonuses: bgBonuses(sheet.background),
    bgSpec: bgSpecBonuses(sheet.background),
    equip,
    sizeId: sheet.sizeId,
    morality: sheet.morality,
    overrides: sheet.derivedOverrides,
    poolCompensation: opts.poolCompensation ?? false,
  });
  return { hpMax: d.hpMax, dhpMax: d.dhp, ssMax: d.ss };
}

/** A pool reported as the CURRENT value, and only when the spend/damage counter
 *  itself moved. A ceiling that shifted because Rank or Endurance went up is
 *  already explained by the Rank/Endurance line — saying it twice is noise. */
function pool(label: string, key: "hpDamage" | "dhpDamage" | "ssSpent", max: "hpMax" | "dhpMax" | "ssMax") {
  return (a: CharacterSheet, b: CharacterSheet, o: SheetDiffOpts): string[] => {
    const spentA = a[key] ?? 0;
    const spentB = b[key] ?? 0;
    if (spentA === spentB) return [];
    return [`${label} ${poolsOf(a, o)[max] - spentA} → ${poolsOf(b, o)[max] - spentB}`];
  };
}

// ── Per-field reporters ─────────────────────────────────────────────────────────

type Reporter = (before: CharacterSheet, after: CharacterSheet, opts: SheetDiffOpts) => string[];

/** Sheet fields that are deliberately silent, each for a reason:
 *
 *  - `folderId` files the character in THIS device's vault. The Curator's folders
 *    are not the player's, so a folder move says nothing to the person reading.
 *  - `genusLoadout` is the legacy flat list kept only so pre-Focus sheets migrate;
 *    `focusSpend.genus` is the source of truth and reports the same facts. Diffing
 *    both would fire a spurious notice on every sheet the migration touches. */
const SILENT_KEYS = ["folderId", "genusLoadout"] as const;
type SilentKey = (typeof SILENT_KEYS)[number];

/** Everything else must be reported by name below. This is a Record over the key
 *  union, so adding a field to CharacterSheet and forgetting it here is a BUILD
 *  ERROR rather than a change the player is never told about — the same guard
 *  sheetCodec uses, for the same reason. Declaration order is display order. */
const REPORTERS: Record<Exclude<SheetKey, SilentKey>, Reporter> = {
  rank: (a, b) => num("Rank", a.rank, b.rank),

  hpDamage: pool("HP", "hpDamage", "hpMax"),
  dhpDamage: pool("DHP", "dhpDamage", "dhpMax"),
  ssSpent: pool("Synaptic Space", "ssSpent", "ssMax"),

  attributes: (a, b) =>
    ATTRIBUTES.flatMap(({ key, label }) => num(label, a.attributes?.[key as AttrKey], b.attributes?.[key as AttrKey])),
  specialties: (a, b) =>
    SPECIALTIES.flatMap(({ key, label }) =>
      num(label, a.specialties?.[key as SpecKey], b.specialties?.[key as SpecKey])
    ),

  pressure: (a, b) => num("Pressure", a.pressure ?? 50, b.pressure ?? 50),
  morality: (a, b) => {
    const x = a.morality ?? 50;
    const y = b.morality ?? 50;
    return x === y ? [] : [`Polarized Soul ${x} → ${y} (${moralityState(y).label})`];
  },
  eminence: (a, b) => num("Eminence", a.eminence ?? 0, b.eminence ?? 0, signed),

  counterTracks: (a, b) => {
    const before = new Map((a.counterTracks ?? []).map((t) => [t.name, t]));
    const after = new Map((b.counterTracks ?? []).map((t) => [t.name, t]));
    const out: string[] = [];
    for (const [name, t] of after) {
      const was = before.get(name);
      if (!was) out.push(`Gained the ${name} track (${t.value}${t.cap != null ? ` of ${t.cap}` : ""})`);
      else {
        out.push(...num(name, was.value, t.value));
        if ((was.cap ?? null) !== (t.cap ?? null)) {
          out.push(t.cap == null ? `${name} cap removed` : `${name} cap ${was.cap ?? "none"} → ${t.cap}`);
        }
      }
    }
    for (const [name] of before) if (!after.has(name)) out.push(`${name} track removed`);
    return out;
  },

  // The TITLE is quoted and the body is not: a handout can run to paragraphs, and
  // a notice is a "go and look", not a reader. Titles are what the player scans
  // their notes for, so the notice must use the same words the entry does.
  handouts: (a, b) => {
    const before = new Map((a.handouts ?? []).map((h) => [h.id, h]));
    const after = new Map((b.handouts ?? []).map((h) => [h.id, h]));
    const out: string[] = [];
    for (const [id, h] of after) if (!before.has(id)) out.push(`Handed to you: “${h.title}” — it is in your Notes`);
    for (const [id, h] of before) if (!after.has(id)) out.push(`“${h.title}” was taken back`);
    return out;
  },

  speciesId: (a, b) => named("Species", getSpecies(a.speciesId)?.name ?? a.speciesId, getSpecies(b.speciesId)?.name ?? b.speciesId),
  variantName: (a, b) => named("Lineage", a.variantName, b.variantName),
  variantOption: (a, b) => named("Lineage option", a.variantOption, b.variantOption),
  paradigmId: (a, b) =>
    named("Paradigm", getParadigm(a.paradigmId)?.name ?? a.paradigmId, getParadigm(b.paradigmId)?.name ?? b.paradigmId),
  sector: (a, b) => named("Sector", getSector(a.sector)?.name ?? a.sector, getSector(b.sector)?.name ?? b.sector),
  sizeId: (a, b) => named("Size", sizeOf(a.sizeId, a.speciesId).label, sizeOf(b.sizeId, b.speciesId).label),

  background: (a, b) => {
    if (deepEqual(a.background, b.background)) return [];
    const x = a.background?.name?.trim() || "";
    const y = b.background?.name?.trim() || "";
    // A renamed background is the headline; a re-spread of the same background is
    // real but has no name to quote, so it is reported as what it is.
    if (x !== y) return named("Background", x, y);
    return [y ? `Background ${y} was re-spread` : "Background bonuses were changed"];
  },

  // Empty and absent both mean "all four innates active" on a pre-choose-2-of-4
  // sheet, so neither is treated as a loss of the other's abilities.
  innateChoice: (a, b) => {
    const x = a.innateChoice ?? [];
    const y = b.innateChoice ?? [];
    if (x.length === 0 && y.length === 0) return [];
    return listDelta("Innate ability made active:", "Innate ability set aside:", x, y);
  },

  focusSpend: (a, b) => {
    const x = a.focusSpend ?? { genus: {}, incepts: [] };
    const y = b.focusSpend ?? { genus: {}, incepts: [] };
    const out: string[] = [];
    for (const [g, lvl] of Object.entries(y.genus)) {
      const was = x.genus[g];
      if (was == null) out.push(`Gained the ${g} genus at Focus ${lvl}`);
      else out.push(...num(`${g} Focus`, was, lvl));
    }
    for (const g of Object.keys(x.genus)) if (y.genus[g] == null) out.push(`Lost the ${g} genus`);
    out.push(...listDelta("Unlocked the Incept", "Lost the Incept", x.incepts, y.incepts));
    return out;
  },
  focusBonus: (a, b) => num("Banked Focus", a.focusBonus, b.focusBonus),
  // The rank a Talent Holder roll was already made at — bookkeeping that stops
  // rank-cycling from farming the bonus. The bonus itself is reported above.
  focusBonusRank: () => [],

  favoredAttr: (a, b) =>
    named("Favored attribute", ATTRIBUTES.find((x) => x.key === a.favoredAttr)?.label ?? a.favoredAttr,
      ATTRIBUTES.find((x) => x.key === b.favoredAttr)?.label ?? b.favoredAttr),
  favoredSpec: (a, b) =>
    named("Favored specialty", SPECIALTIES.find((x) => x.key === a.favoredSpec)?.label ?? a.favoredSpec,
      SPECIALTIES.find((x) => x.key === b.favoredSpec)?.label ?? b.favoredSpec),

  cipherLoadout: (a, b) => listDelta("Gained the Cipher", "Lost the Cipher", a.cipherLoadout ?? [], b.cipherLoadout ?? []),
  weaponLoadout: (a, b) =>
    listDelta("Equipped", "Unequipped", a.weaponLoadout ?? [], b.weaponLoadout ?? []).map((s) =>
      // Name the catalog entry so "Equipped Kessari" is not mistaken for gear.
      s.replace(/^(Equipped|Unequipped) (.+)$/, (_m, verb, n) => `${verb} the weapon ${getWeapon(n)?.name ?? n}`)
    ),
  gearLoadout: (a, b) =>
    listDelta("Equipped", "Unequipped", a.gearLoadout ?? [], b.gearLoadout ?? []).map((s) =>
      s.replace(/^(Equipped|Unequipped) (.+)$/, (_m, verb, n) => `${verb} the gear ${getEquipment(n)?.name ?? n}`)
    ),

  equipment: (a, b) => {
    // Matched by NAME, not by id: an item re-added by hand gets a fresh id, and an
    // id-keyed diff would report that as "lost X" plus "gained X".
    const qty = (i: EquipmentItem) => Math.max(1, Math.trunc(i.qty ?? 1));
    const before = new Map((a.equipment ?? []).map((i) => [i.name, i]));
    const after = new Map((b.equipment ?? []).map((i) => [i.name, i]));
    const out: string[] = [];
    for (const [name, item] of after) {
      const was = before.get(name);
      if (!was) {
        out.push(`Gained ${name}${qty(item) > 1 ? ` ×${qty(item)}` : ""}`);
        continue;
      }
      if (qty(was) !== qty(item)) out.push(`${name} ×${qty(was)} → ×${qty(item)}`);
      if (was.equipped !== item.equipped) out.push(`${item.equipped ? "Equipped" : "Unequipped"} ${name}`);
      if (was.mods !== item.mods) out.push(`${name}'s modifiers were changed`);
    }
    for (const [name, item] of before) if (!after.has(name)) out.push(`Lost ${name}${qty(item) > 1 ? ` ×${qty(item)}` : ""}`);
    return out;
  },

  bioFields: (a, b) => {
    // Keyed by LABEL for the same reason equipment is keyed by name: the player
    // knows the field as "Callsign", never as its generated id.
    const before = new Map(parseBioFields(a.bioFields).map((f) => [f.label, f.value]));
    const after = new Map(parseBioFields(b.bioFields).map((f) => [f.label, f.value]));
    const out: string[] = [];
    for (const [label, value] of after) {
      if (!before.has(label)) out.push(`Added ${label}: ${value || "(empty)"}`);
      else if (before.get(label) !== value) out.push(`${label} ${before.get(label) || "(empty)"} → ${value || "(empty)"}`);
    }
    for (const [label] of before) if (!after.has(label)) out.push(`Removed the ${label} field`);
    return out;
  },

  negotiation: (a, b) => {
    const x = a.negotiation ?? {};
    const y = b.negotiation ?? {};
    return [
      ...named("Negotiation client", x.client, y.client),
      ...num("Client resistance", x.resistance, y.resistance),
      ...num("Eminence required", x.eminenceReq, y.eminenceReq, signed),
    ];
  },

  allowOverrides: (a, b) =>
    !!a.allowOverrides === !!b.allowOverrides
      ? []
      : [b.allowOverrides ? "Hand-editing of derived stats was turned ON" : "Hand-editing of derived stats was turned OFF"],
  derivedOverrides: (a, b) => {
    const x = a.derivedOverrides ?? {};
    const y = b.derivedOverrides ?? {};
    const label = (k: string) => (k === "hpMax" ? "Max HP" : k === "ncMod" ? "NC modifier" : DERIVED.find((d) => d.key === k)?.label ?? k);
    const keys = [...new Set([...Object.keys(x), ...Object.keys(y)])];
    const out: string[] = [];
    for (const k of keys) {
      const bx = x[k as DerivedKey];
      const by = y[k as DerivedKey];
      if (bx === by) continue;
      if (by == null) out.push(`${label(k)} override removed (was ${bx})`);
      else if (bx == null) out.push(`${label(k)} set to ${by} by hand`);
      else out.push(`${label(k)} override ${bx} → ${by}`);
    }
    return out;
  },

  tags: (a, b) => listDelta("Tagged", "Untagged", a.tags ?? [], b.tags ?? []),

  // The text itself is not quoted: notes run to paragraphs, and a notice is a
  // one-line "go and look", not a diff viewer.
  notes: (a, b) => ((a.notes ?? "") === (b.notes ?? "") ? [] : ["Your notes were edited"]),
  notesMd: (a, b) => ((a.notesMd ?? "") === (b.notesMd ?? "") ? [] : ["Your journal was edited"]),

  portrait: (a, b) => {
    const x = a.portrait ?? "";
    const y = b.portrait ?? "";
    if (x === y) return [];
    return [y ? (x ? "Your portrait was replaced" : "A portrait was added") : "Your portrait was removed"];
  },
};

/** Display order — the Record's own key order, captured once. */
const REPORT_ORDER = Object.keys(REPORTERS) as (keyof typeof REPORTERS)[];

/**
 * Every change worth telling a player about, between two versions of their
 * character. Empty when nothing semantic moved — a plain re-save, a codec
 * normalisation, or a field this module deliberately keeps quiet about.
 */
export function diffSheetRecords(before: CharacterRecord, after: CharacterRecord, opts: SheetDiffOpts = {}): string[] {
  const a = normalize(before.sheet);
  const b = normalize(after.sheet);
  const out: string[] = [];
  const an = (before.name ?? "").trim();
  const bn = (after.name ?? "").trim();
  if (an !== bn) out.push(`Renamed ${an || "(unnamed)"} → ${bn || "(unnamed)"}`);
  for (const key of REPORT_ORDER) out.push(...REPORTERS[key](a, b, opts));
  return out;
}
