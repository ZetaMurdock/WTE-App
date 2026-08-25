// The data-driven Codex pull: species, paradigms, weapons, gear, genus, and
// ciphers are sourced from PULLED Codex pages (pageMeta.pulled, Engineer-set) and
// overlaid onto the baked/hardcoded base data at app boot — so uploading pages
// changes character-creation options and sheet/VTT catalogs without a rebuild.
// Base data always remains the fallback; parse failures skip the page silently.
import {
  bakedCiphers,
  registerCodexGameData,
  type Species,
  type SpeciesFamily,
  type SpeciesVariant,
  type SpeciesVariantAbility,
  type Incept,
  type InceptWeight,
  type CodexSpeciesDefinition,
  type SpeciesMechanicField,
  type Paradigm,
  type AttrKey,
  type GenusAbility,
  type CipherAbility,
  type CodexBackground,
  type BgMode,
  type SpecKey,
} from "../game/wte";
import { CIPHER_BODY_MARKER, parseCodexEntry, splitCipherEffect } from "./codexParse";
import { codexPlainSource } from "./codexPlain";
import { parseInceptGrants } from "../game/inceptGrants";
import { setCodexCatalog, setCodexRuntimeEntries } from "./codex";
import { applyCodexPages, beginCodexLoad, codexLoadIsCurrent, noCodexPages, type PageSkip } from "../game/codexService";
import { scanGenusCorpus, type RawPage } from "./genusCorpus";
import { mergeVisibility, type GenusPage } from "../game/codexGenusSource";
import { overriddenId, parseId } from "../game/codexId";
import { getActiveCampaignId } from "./repo";
import { activeRoomCodex, listCampaignMechanicPages, markRoomCodexReady } from "./campaignCodex";
import type { CodexEntry, Weapon, Equipment } from "../models/codex";
import {
  parseRollFormulaPage,
  setCodexRollFormulas,
  type CodexRollFormula,
} from "../game/rollFormula";

/**
 * Is this page a campaign's own rule, or a mirror of an official one?
 *
 * It has to SAY so. Guessing from the title is what let an unrelated page take
 * over an official concept, so the signal is explicit: it declares which official
 * rule it replaces, or it carries a campaign-scoped id of its own.
 */
function declaresCampaignScope(p: GenusPage): boolean {
  if (p.overrides && p.overrides.trim()) return true;
  const parsed = p.id ? parseId(p.id) : null;
  return parsed?.scope === "campaign";
}

const ATTRS: AttrKey[] = ["phy", "dex", "end", "ap", "wis", "cha", "int"];

function nullRecord<T>(): Record<string, T> {
  return Object.create(null) as Record<string, T>;
}

function ownRecordValue<T>(values: Readonly<Record<string, T>>, key: string): T | undefined {
  return Object.prototype.hasOwnProperty.call(values, key) ? values[key] : undefined;
}

const strip = (s: string) => (s || "").replace(/<[^>]*>/g, "").replace(/\*\*/g, "").trim();

/** Read `| K | V |`, `**K:** V`, or `K: V` spec fields from a page (same
 *  conventions as codexParse, kept independent so its behaviour never shifts). */
function readFields(source: string): Record<string, string> {
  const md = codexPlainSource(source);
  const out: Record<string, string> = {};
  for (const line of md.split("\n")) {
    let k = "";
    let v = "";
    const tbl = line.match(/^\s*\|([^|]+)\|([^|]+)\|/);
    const bold = line.match(/^\s*(?:[-*]\s*)?\*\*([^*]+)\*\*:?\s*(.+)$/);
    const plain = line.match(/^\s*([A-Za-z][A-Za-z ]{1,14}?):[ \t]+(.+)$/);
    if (tbl) [k, v] = [tbl[1], tbl[2]];
    else if (bold) [k, v] = [bold[1], bold[2]];
    else if (plain) [k, v] = [plain[1], plain[2]];
    else continue;
    k = strip(k).replace(/:$/, "").toLowerCase();
    if (k && !/^:?-+:?$/.test(k)) out[k] = strip(v);
  }
  return out;
}
function titleOf(source: string, fallback: string): string {
  const md = codexPlainSource(source);
  const m = md.match(/^#{1,4}\s+(.+)$/m);
  return strip(m ? m[1] : fallback).replace(/_/g, " ");
}
function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "");
}
function csv(v?: string): string[] {
  return (v || "").split(/[,;·]/).map((s) => s.trim()).filter(Boolean);
}
/** "STR +2, END +2" or "+2 STR" pairs → attribute bonus map.
 *  PHY is still accepted — it was this attribute's name until v0.8.37, and older
 *  Codex pages and homebrew packs are full of it. */
function parseBonuses(v?: string): Partial<Record<AttrKey, number>> {
  const out: Partial<Record<AttrKey, number>> = {};
  if (!v || /^(none|—|-)$/i.test(v.trim())) return out;
  const re = /(str|phy|dex|end|ap|wis|cha|int)\s*([+-]?\d+)|([+-]\d+)\s*(str|phy|dex|end|ap|wis|cha|int)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(v))) {
    const tok = (m[1] || m[4]).toLowerCase();
    const key = (tok === "str" ? "phy" : tok) as AttrKey;
    const n = parseInt(m[2] || m[3], 10);
    if (ATTRS.includes(key) && Number.isFinite(n)) out[key] = n;
  }
  return out;
}
/** `- **Ability** — effect` — the bullet form shared by innate and variant lists. */
const ABILITY_BULLET = /^\s*[-*]\s*\*\*([^*]+)\*\*\s*[—–:-]\s*(.+)$/;
/** `- Option: Label — **Ability** — effect` — a creation-time choice within a
 *  variant (the Annunaki head shapes). Anchored on the bold ability name, so a
 *  label or an effect containing a dash cannot split it in the wrong place. */
const OPTION_BULLET = /^\s*[-*]\s*Option:\s*(.+?)\s*[—–-]\s*\*\*([^*]+)\*\*\s*[—–:-]\s*(.+)$/i;

/** `### Variant` blocks under a `## Variants` heading; `- **Ability** — effect`
 *  bullets, plus `- Option: …` creation-time choices. */
function parseVariants(source: string): SpeciesVariant[] {
  const md = codexPlainSource(source);
  const sec = md.split(/^#{2,3}\s+Variants\s*$/im)[1];
  if (!sec) return [];
  const out: SpeciesVariant[] = [];
  let cur: SpeciesVariant | null = null;
  for (const line of sec.split("\n")) {
    if (/^#{1,2}\s/.test(line)) break; // next top-level section
    const h = line.match(/^#{3,4}\s+(.+)$/);
    if (h) {
      cur = { name: strip(h[1]), abilities: [] };
      out.push(cur);
      continue;
    }
    // Checked BEFORE the plain ability bullet, because an option line also
    // carries a bold ability name. Before this it fell through to the note
    // branch and a creation-time choice was silently flattened into prose.
    const opt = line.match(OPTION_BULLET);
    if (opt && cur) {
      (cur.options ??= []).push({
        label: strip(opt[1]),
        ability: { name: opt[2].trim(), effect: strip(opt[3]) },
      });
      continue;
    }
    const ab = line.match(ABILITY_BULLET);
    if (ab && cur) {
      cur.abilities.push({ name: ab[1].trim(), effect: strip(ab[2]) });
      continue;
    }
    if (cur && line.trim() && !line.startsWith("|")) cur.note = ((cur.note || "") + " " + line.trim()).trim();
  }
  return out.filter((v) => v.name);
}

/** `- **Innate** — effect` bullets under an `## Innate` heading.
 *
 *  The `Innate` table row can only ever carry names, and effect prose otherwise
 *  comes solely from the baked wiki export keyed by species id — so a campaign
 *  that renamed an innate, or invented one, had no way to describe it. */
function parseInnateAbilities(source: string): SpeciesVariantAbility[] {
  const md = codexPlainSource(source);
  const sec = md.split(/^#{2,3}\s+Innate(?:\s+Abilities)?\s*$/im)[1];
  if (!sec) return [];
  const out: SpeciesVariantAbility[] = [];
  for (const line of sec.split("\n")) {
    if (/^#{1,3}\s/.test(line)) break; // next section, `### Variants` included
    const ab = line.match(ABILITY_BULLET);
    if (ab) out.push({ name: ab[1].trim(), effect: strip(ab[2]) });
  }
  return out;
}

/** Everything under a `## <Name>` heading, up to the next one. */
function section(md: string, name: string): string {
  const re = new RegExp(String.raw`^#{2,3}\s+${name}\s*$`, "im");
  const at = md.split(re)[1];
  if (at === undefined) return "";
  return at.split(/^#{1,3}\s/m)[0];
}

/**
 * `Type: Incept` — one Incept, belonging to a species' pool.
 *
 * Weight is required and drives two live systems (Synaptic Focus cost and the
 * Wryde chaos tier), so an unreadable one is not defaulted quietly. Grants are
 * optional: an Incept that has not been converted to Roll Axis yet still reads
 * on the sheet, it just has nothing to roll.
 */
export function parseInceptPage(md: string, stem: string): { speciesId: string; incept: Incept } | null {
  const f = readFields(md);
  if ((f["type"] || "").toLowerCase() !== "incept") return null;
  const name = f["name"] || titleOf(md, stem);
  const speciesId = slug(f["species"] || f["pool"] || "");
  if (!speciesId || !name) return null;
  const weightRaw = (f["weight"] || "").trim().toLowerCase();
  const weight: InceptWeight =
    weightRaw === "heavy" ? "Heavy" : weightRaw === "light" ? "Light" : "Medium";
  const plain = codexPlainSource(md);
  const { grants } = parseInceptGrants(section(plain, "Grants"));
  const effect = section(plain, "Effect").trim() || f["effect"] || "";
  return {
    speciesId,
    incept: {
      name,
      weight,
      memory: f["memory"] || undefined,
      effect,
      grants: grants.length ? grants : undefined,
    },
  };
}

function ownField(fields: Record<string, string>, ...names: string[]): boolean {
  return names.some((name) => Object.prototype.hasOwnProperty.call(fields, name));
}

function optionalNumber(fields: Record<string, string>, ...names: string[]): number | undefined {
  for (const name of names) {
    if (!ownField(fields, name)) continue;
    if (!fields[name]?.trim()) return undefined;
    const value = Number(fields[name]);
    return Number.isFinite(value) ? value : undefined;
  }
  return undefined;
}

/** Resolve a page's gameplay key. A campaign id is provenance, while Overrides
 * names the catalog entry it replaces; character saves continue to use the
 * stable gameplay slug (for example `hyomen`). */
function mechanicSlug(fields: Record<string, string>, name: string, kind: "species" | "paradigm"): string {
  for (const raw of [fields["overrides"], fields["id"]]) {
    const parsed = raw ? parseId(raw) : null;
    if (parsed?.kind === kind) return parsed.slug;
  }
  return fields["id"] || slug(name);
}

/** Parsed Species plus the exact mechanics rows/sections the author supplied.
 * The registry uses this presence list to inherit everything else from the
 * official lineage rather than replacing omitted values with empty defaults. */
export function parseSpeciesDefinitionPage(md: string, stem: string): CodexSpeciesDefinition | null {
  const f = readFields(md);
  if ((f["type"] || "").toLowerCase() !== "species") return null;
  const name = f["name"] || titleOf(md, stem);
  const famRaw = (f["family"] || "Humanity").toLowerCase();
  const family: SpeciesFamily = famRaw.startsWith("omen") ? "Omenity" : famRaw.startsWith("aster") ? "Asternem" : "Humanity";
  const provided: SpeciesMechanicField[] = [];
  if (ownField(f, "family")) provided.push("family");
  if (ownField(f, "bonuses")) provided.push("bonuses");
  if (ownField(f, "innate")) provided.push("innate");
  if (ownField(f, "note")) provided.push("note");
  if (ownField(f, "dominance", "dom")) provided.push("dom");
  if (ownField(f, "recessiveness", "rec")) provided.push("rec");
  if (ownField(f, "eminence", "eminence nature")) provided.push("eminence");
  if (ownField(f, "innate select", "innate selection")) provided.push("innateSelect");
  if (/^#{2,3}\s+Variants\s*$/im.test(codexPlainSource(md))) provided.push("variants");
  // An `## Innate` section is the richer form of the `Innate` row: it names the
  // innates AND gives them effects, so it satisfies both fields on its own.
  const innateAbilities = parseInnateAbilities(md);
  if (innateAbilities.length) {
    provided.push("innateAbilities");
    if (!provided.includes("innate")) provided.push("innate");
  }
  return {
    species: {
      id: mechanicSlug(f, name, "species"),
      name,
      family,
      bonuses: parseBonuses(f["bonuses"]),
      innate: innateAbilities.length ? innateAbilities.map((a) => a.name) : csv(f["innate"]),
      innateAbilities: innateAbilities.length ? innateAbilities : undefined,
      note: ownField(f, "note") ? f["note"] || undefined : undefined,
      dom: optionalNumber(f, "dominance", "dom"),
      rec: optionalNumber(f, "recessiveness", "rec"),
      eminence: (f["eminence"] || f["eminence nature"]) || undefined,
      innateSelect: optionalNumber(f, "innate select", "innate selection"),
      variants: parseVariants(md),
    },
    provided,
  };
}

export function parseSpeciesPage(md: string, stem: string): Species | null {
  return parseSpeciesDefinitionPage(md, stem)?.species ?? null;
}

/** "Wisdom · Endurance" / "Dexterity · Choose 1 Additional Attribute" →
 *  attribute keys plus whether a player choice slot is declared. */
function parseFavoredList<K extends string>(
  raw: string | undefined,
  names: Readonly<Record<string, K>>
): { keys: K[]; choice: boolean } | null {
  if (raw === undefined) return null;
  const keys: K[] = [];
  let choice = false;
  for (const part of raw.split(/[·,;/]/)) {
    const term = strip(part).toLowerCase().replace(/\s+/g, " ").trim();
    if (!term) continue;
    if (/^choose\b/.test(term)) {
      choice = true;
      continue;
    }
    const key = ownRecordValue(names, term);
    if (key && !keys.includes(key)) keys.push(key);
  }
  return { keys, choice };
}

export function parseParadigmPage(md: string, stem: string): Paradigm | null {
  const f = readFields(md);
  if ((f["type"] || "").toLowerCase() !== "paradigm") return null;
  const name = f["name"] || titleOf(md, stem);
  // Affinity rows are OPTIONAL — a page without them inherits the baked
  // doctrine's favored stats rather than deleting them (see the registry merge).
  const favAttrs = parseFavoredList(f["favored attributes"], ATTR_NAMES);
  const favSpecs = parseFavoredList(f["favored specialties"], SPEC_NAMES);
  return {
    id: mechanicSlug(f, name, "paradigm"),
    name,
    group: f["group"] || "Codex",
    weapons: csv(f["weapons"]),
    domains: csv(f["domains"]),
    ...(favAttrs ? { favoredAttrs: favAttrs.keys } : {}),
    ...(favSpecs ? { favoredSpecs: favSpecs.keys } : {}),
    ...(favAttrs?.choice || favSpecs?.choice ? { favoredChoice: true } : {}),
  };
}

// Stat NAME → key (attributes and specialties), with the common synonyms seen in
// authored background pages ("Strength", "Adaption", "Willpower", …).
const ATTR_NAMES: Record<string, AttrKey> = {
  physical: "phy", physique: "phy", strength: "phy", str: "phy", phy: "phy",
  dexterity: "dex", agility: "dex", dex: "dex",
  endurance: "end", stamina: "end", end: "end",
  "action priority": "ap", "action points": "ap", ap: "ap",
  wisdom: "wis", willpower: "wis", wis: "wis",
  charisma: "cha", cha: "cha",
  intelligence: "int", int: "int",
};
const SPEC_NAMES: Record<string, SpecKey> = {
  inspiration: "ins", balance: "bal", weight: "wt", precision: "pre",
  control: "ctrl", "weapon mastery": "wm", "mental fortitude": "mf",
  perception: "per", adaptation: "adp", adaption: "adp", cunning: "cun",
};

/** Parse a "PASSIVE BONUSES" list ("+2 Wisdom, +2 Mental Fortitude, +1 Control")
 *  into fixed attribute + specialty maps. Freeform entries ("+2 to any three …")
 *  and unknown names are skipped (the player assigns those manually). */
function parseBonusList(text: string): { attr: Partial<Record<AttrKey, number>>; spec: Partial<Record<SpecKey, number>> } {
  const attr: Partial<Record<AttrKey, number>> = {};
  const spec: Partial<Record<SpecKey, number>> = {};
  for (const part of strip(text).split(/[,;]/)) {
    const m = part.match(/^\s*\+?(-?\d+)\s+(.+?)\s*$/);
    if (!m) continue;
    const n = parseInt(m[1], 10);
    const name = m[2].toLowerCase().replace(/\s+/g, " ").trim();
    const attrKey = ownRecordValue(ATTR_NAMES, name);
    const specKey = ownRecordValue(SPEC_NAMES, name);
    if (attrKey) attr[attrKey] = (attr[attrKey] || 0) + n;
    else if (specKey) spec[specKey] = (spec[specKey] || 0) + n;
  }
  return { attr, spec };
}
/** Infer the point-spread mode from the parsed amounts (2/2/1/1 vs 4/2). */
function inferMode(attr: Partial<Record<AttrKey, number>>, spec: Partial<Record<SpecKey, number>>): BgMode | undefined {
  const amts = [...Object.values(attr), ...Object.values(spec)].sort((a, b) => b - a).join(",");
  if (amts === "2,2,1,1") return "standard";
  if (amts === "4,2") return "focused";
  return undefined;
}

export function parseBackgroundPage(md: string, stem: string): CodexBackground | null {
  const f = readFields(md);
  if ((f["type"] || "").toLowerCase() !== "background") return null;
  const name = f["name"] || titleOf(md, stem);
  const modeRaw = (f["mode"] || "").toLowerCase();
  let mode: BgMode | undefined = modeRaw.startsWith("focus") ? "focused" : modeRaw.startsWith("standard") ? "standard" : undefined;
  const bg: CodexBackground = { name, mode, note: f["note"] || undefined };
  const bonusText = f["bonuses"] || f["passive bonuses"];
  if (bonusText) {
    const { attr, spec } = parseBonusList(bonusText);
    if (Object.keys(attr).length) bg.attrBonus = attr;
    if (Object.keys(spec).length) bg.specBonus = spec;
    if (!mode) mode = inferMode(attr, spec);
    bg.mode = mode;
  }
  return bg;
}

/** Parse a "background directory" page — one page listing many backgrounds as
 *  cards (a bold name span + a "PASSIVE BONUSES" list each). Returns every
 *  background found, so an authored directory page populates the creator. */
export function parseBackgroundsDirectory(md: string): CodexBackground[] {
  if (!/passive bonuses/i.test(md)) return [];
  const names = [...md.matchAll(/<span[^>]*font-size:\s*16px[^>]*>([^<]+)<\/span>/gi)].map((m) => strip(m[1]));
  const bonuses = [...md.matchAll(/PASSIVE BONUSES<\/strong>\s*([^<]+)/gi)].map((m) => m[1]);
  const out: CodexBackground[] = [];
  const n = Math.min(names.length, bonuses.length);
  for (let i = 0; i < n; i++) {
    const name = names[i];
    if (!name) continue;
    const { attr, spec } = parseBonusList(bonuses[i]);
    const bg: CodexBackground = { name, mode: inferMode(attr, spec) };
    if (Object.keys(attr).length) bg.attrBonus = attr;
    if (Object.keys(spec).length) bg.specBonus = spec;
    out.push(bg);
  }
  return out;
}

// ── The loader: compile every effective PULLED page into game data ──
export async function loadCodexGameData(): Promise<void> {
  // A failed LISTING is not an empty Codex. Swallowed here, it used to mean "this
  // machine has no Codex pages", which reads identically to a machine that really
  // has none — so a locked database silently removed every page link and every
  // campaign rule.
  // Claimed BEFORE any awaiting, so ordering reflects when a load STARTED.
  // Taken after enumeration, a load that began first but enumerated slowly got
  // the higher number and won — which is precisely backwards, and let a stale
  // campaign's pages land on top of the campaign you had just switched to.
  const token = beginCodexLoad();
  let listFailed: string | undefined;
  const room = activeRoomCodex();
  const effectiveCampaign = room?.campaignId ?? getActiveCampaignId() ?? "";
  const sourcePages = await listCampaignMechanicPages(effectiveCampaign || null).catch((e) => {
    listFailed = e instanceof Error ? e.message : String(e);
    return [];
  });
  if (!room && sourcePages.length === 0 && !listFailed) {
    if (!codexLoadIsCurrent(token)) return;
    // "This campaign has no mechanic pages" has to CLEAR the catalogs, not skip
    // them. Only the formulas were being reset here, so every other overlay —
    // species, paradigms, sizes, genus, ciphers, backgrounds, weapons, gear —
    // stayed exactly as the previous campaign had left it. Switching from a
    // table with a house rule to a table with none carried the house rule
    // across, and deleting the last campaign page left its edits in force until
    // a restart. Registering empty data restores the baked base.
    setCodexRollFormulas([]);
    registerCodexGameData({});
    setCodexCatalog([], []);
    setCodexRuntimeEntries([]);
    noCodexPages();
    return;
  }
  const skipped: PageSkip[] = [];
  const officialMirrors: GenusPage[] = [];
  const campaignPages: GenusPage[] = [];
  // Raw text of every page, for the grouped-page scan below. The official Genus
  // corpus is five domain pages of exported wiki HTML, not one page per ability,
  // so the field-table parser finds nothing genus-shaped in any of them.
  const raw: RawPage[] = [];
  const species: CodexSpeciesDefinition[] = [];
  const paradigms: Paradigm[] = [];
  const sizes = nullRecord<string>();
  const weapons: Weapon[] = [];
  const gear: Equipment[] = [];
  const genus = nullRecord<GenusAbility[]>();
  const ciphers = nullRecord<CipherAbility[]>();
  const backgrounds: CodexBackground[] = [];
  const incepts = nullRecord<Incept[]>();
  const runtimeEntries: CodexEntry[] = [];
  const rollFormulas: { formula: CodexRollFormula; campaign: boolean }[] = [];

  for (let sourceOrder = 0; sourceOrder < sourcePages.length; sourceOrder++) {
    const source = sourcePages[sourceOrder];
    if (!source.pulled) continue;
    const name = source.stem;
    const md = source.content;
    if (source.source === "official") raw.push({ stem: name, text: md });
    const rollFormula = parseRollFormulaPage(md, name);
    if (rollFormula) {
      if (rollFormula.ok) {
        rollFormulas.push({
          formula: {
            ...rollFormula.formula,
            id: source.id,
            scope: source.source === "campaign" ? "campaign" : "wte",
          },
          campaign: source.source === "campaign",
        });
      } else {
        skipped.push({ stem: name, reason: `invalid Roll Formula: ${rollFormula.errors.join(" ")}`, semantic: true });
      }
      continue;
    }
    const sp = parseSpeciesDefinitionPage(md, name);
    if (sp) {
      species.push(sp);
      const size = (readFields(md)["size"] || "").toLowerCase();
      if (size) sizes[sp.species.id] = size;
      continue;
    }
    const pd = parseParadigmPage(md, name);
    if (pd) {
      paradigms.push(pd);
      continue;
    }
    const inc = parseInceptPage(md, name);
    if (inc) {
      (incepts[inc.speciesId] ??= []).push(inc.incept);
      continue;
    }
    const bg = parseBackgroundPage(md, name);
    if (bg) {
      backgrounds.push(bg);
      continue;
    }
    // A directory page (many backgrounds as cards) — pull them all.
    const dir = parseBackgroundsDirectory(md);
    if (dir.length) {
      backgrounds.push(...dir);
      continue;
    }
    const entry = parseCodexEntry(md, name);
    if (!entry) {
      // Ordinary lore. Not everything in the Codex is a mechanic, and treating
      // prose as a failed parse would make every load look broken.
      continue;
    }
    runtimeEntries.push(entry);
    if (entry.type === "weapon") weapons.push(entry);
    else if (entry.type === "equipment") gear.push(entry);
    else if (entry.type === "genus") {
      const domain = entry.domain || "Neutral";
      (genus[domain] ??= []).push({
        name: entry.name, ss: entry.ss ?? null, effect: entry.effect,
        activation: entry.activation, range: entry.range, target: entry.target,
      });
      // The same page, told to the Codex as a page rather than as mechanics.
      // Visibility takes the most restrictive of what the page says and what the
      // Engineer set on it, so neither can un-hide what the other hid.
      const page: GenusPage = {
        stem: name,
        title: entry.name,
        aliases: entry.aliases,
        id: entry.id,
        overrides: entry.overrides,
        visibility: mergeVisibility(entry.visibility, source.visibility),
        data: {
          domain,
          ss: entry.ss ?? null,
          activation: entry.activation ?? null,
          range: entry.range ?? null,
          target: entry.target ?? null,
          effect: entry.effect ?? null,
          limit: entry.limit ?? null,
          classification: entry.classification ?? null,
        },
      };
      // A page is a campaign rule only when it SAYS so — by declaring what it
      // overrides, or by carrying a campaign-scoped id. Everything else is a
      // mirror of an official page, and contributes provenance only.
      if (source.source === "campaign" || declaresCampaignScope(page)) campaignPages.push(page);
      else officialMirrors.push(page);
    } else if (entry.type === "cipher") {
      // Key by paradigm id (the page names the paradigm; match name or id).
      const key = slug(entry.paradigm || "");
      if (key) {
        // The legacy merge replaces the whole cipher by name, so every part the
        // page left out must be filled from the official entry here — that is
        // what makes the baked pages' "delete a row to keep inheriting"
        // contract true. Rank, Component and the Effect body inherit
        // independently, since each is its own row/section on the page.
        const official = (bakedCiphers()[key] ?? []).find(
          (cipher) => cipher.name.toLowerCase() === entry.name.toLowerCase()
        );
        const officialSplit = official?.effect ? splitCipherEffect(official.effect) : null;
        const body = entry.effect ?? officialSplit?.body ?? official?.effect;
        const rank = entry.rank ?? officialSplit?.rank;
        const component = entry.component ?? officialSplit?.component;
        const header = [rank ? `Rank: ${rank}` : "", component ? `Component: ${component}` : ""]
          .filter(Boolean)
          .join(" · ");
        // Compose the header only when the body speaks the official rule voice.
        // A page whose rule is plain prose never carried the header, and gluing
        // its spec rows into the text would corrupt the documented format.
        const effect = body && header && CIPHER_BODY_MARKER.test(body) ? `${header} ${body}` : body;
        (ciphers[key] ??= []).push({
          name: entry.name,
          // Identity survives an override: a fork is the SAME cipher, so it
          // keeps the OFFICIAL permanent id. A customized page's ID row names
          // the layer (`campaign.<table>.cipher.…`), not the concept, and
          // filing an outcome under the layer would lose it the moment the
          // table drops the override.
          id: official?.id ?? (entry.id ? overriddenId(entry.id) ?? entry.id : undefined),
          // pageIdentity records the previous name in an Aliases row whenever a
          // Curator renames a cipher page. Dropping it here is what left every
          // player holding the pre-rename name with a blank 0-SS row.
          aliases: entry.aliases,
          ss: entry.ss ?? official?.ss ?? null,
          tier: entry.tier || official?.tier || "offline",
          type: entry.activation ?? official?.type,
          effect,
        });
      }
    }
  }

  // Where each official ability can actually be read. Provenance only — the
  // scanner never takes a number off a page.
  const scan = scanGenusCorpus(raw);
  const pageInput = {
    officialMirrors: [...officialMirrors, ...scan.pages],
    campaignPages,
    campaignId: effectiveCampaign,
    skipped,
    listFailed,
    corpus: scan,
  };

  // A visible formula is executable game math (through the inert interpreter),
  // not optional lore. If it declares itself as a formula but fails validation,
  // keep every live singleton on the last coherent revision and keep a joined
  // room gated instead of silently falling back to built-ins.
  const formulaFailures = skipped.filter((entry) => entry.semantic && entry.reason.startsWith("invalid Roll Formula:"));
  if (formulaFailures.length) {
    if (!codexLoadIsCurrent(token)) return;
    applyCodexPages(pageInput, token);
    throw new Error(formulaFailures.map((entry) => `${entry.stem}: ${entry.reason}`).join("; "));
  }

  // A failed enumeration says nothing about what the active definitions are.
  // Let diagnostics retain/report the last good page pass, but do not clear or
  // partially replace any of the singleton mechanics catalogs.
  if (listFailed) {
    if (!codexLoadIsCurrent(token)) return;
    applyCodexPages(pageInput, token);
    throw new Error(`Campaign Codex mechanics could not be listed: ${listFailed}`);
  }

  // All catalogs below are process-wide singletons. Do not let a slower pass
  // for the campaign we just left land over the newest campaign's data.
  if (!codexLoadIsCurrent(token)) return;
  registerCodexGameData({ species, paradigms, sizes, genus, ciphers, backgrounds, incepts });
  // Official definitions establish the baseline; campaign definitions are
  // installed last and therefore win for the same target/path. Invalid pages
  // never reach this registry, and every load replaces it atomically.
  rollFormulas.sort((a, b) => {
    const layer = Number(a.campaign) - Number(b.campaign);
    if (layer) return layer;
    const specificity =
      Number(!!a.formula.path) + Number(!!a.formula.direction) -
      Number(!!b.formula.path) - Number(!!b.formula.direction);
    if (specificity) return specificity;
    const aKey = `${a.formula.id}\u0000${a.formula.path ?? ""}\u0000${a.formula.direction ?? ""}\u0000${a.formula.expression}\u0000${a.formula.die}\u0000${a.formula.below ?? ""}\u0000${a.formula.penalty ?? ""}`;
    const bKey = `${b.formula.id}\u0000${b.formula.path ?? ""}\u0000${b.formula.direction ?? ""}\u0000${b.formula.expression}\u0000${b.formula.die}\u0000${b.formula.below ?? ""}\u0000${b.formula.penalty ?? ""}`;
    return aKey < bKey ? -1 : aKey > bKey ? 1 : 0;
  });
  setCodexRollFormulas(rollFormulas.map((entry) => entry.formula));
  setCodexCatalog(weapons, gear);
  setCodexRuntimeEntries(runtimeEntries);

  applyCodexPages(pageInput, token);
  window.dispatchEvent(new Event("wte-gamedata-changed"));
  if (room) markRoomCodexReady(room.campaignId, room.revision);
}
