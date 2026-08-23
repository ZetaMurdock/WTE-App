// A small bridge between the shipped wiki corpus (rich prose/HTML) and the
// declarative tables consumed by character creation, sheets, and the VTT.
//
// Official lineage/paradigm/background articles predate those tables. When a
// Curator customizes one, we can identify the exact catalog record already in
// force and append an editable mechanics block without scraping numbers out of
// prose. This module is deliberately pure: callers may pass a catalog, while the
// UI defaults to the current baked/runtime registries.
import {
  ATTRIBUTES,
  BACKGROUNDS,
  PARADIGMS,
  SPECIALTIES,
  SPECIES,
  SPECIES_SIZE,
  type CodexBackground,
  type Paradigm,
  type Species,
} from "../game/wte";
import { slugify } from "../game/codexId";
import { readField } from "./pageIdentity";

export type ScaffoldMechanicKind = "Species" | "Paradigm" | "Background";

export interface MechanicScaffoldCatalog {
  species: readonly Species[];
  paradigms: readonly Paradigm[];
  backgrounds: readonly CodexBackground[];
  speciesSizes?: Readonly<Record<string, string>>;
}

export interface CodexPageHint {
  stem: string;
  content: string;
  label?: string;
  kind?: string;
  catalog?: MechanicScaffoldCatalog;
}

export interface PreparedCampaignCustomization {
  content: string;
  label: string;
  kind?: ScaffoldMechanicKind;
  scaffolded: boolean;
}

const KIND_LABELS: Readonly<Record<string, string>> = {
  creature: "Creature",
  weapon: "Weapon",
  equipment: "Equipment",
  gear: "Equipment",
  cipher: "Cipher",
  genus: "Genus",
  species: "Species",
  paradigm: "Paradigm",
  background: "Background",
  formula: "Roll Formula",
  "roll-formula": "Roll Formula",
  "roll formula": "Roll Formula",
};

const SECTION_STEMS: Readonly<Record<string, ScaffoldMechanicKind>> = {
  species: "Species",
  "species-compendium": "Species",
  humanity: "Species",
  omenity: "Species",
  asternem: "Species",
  paradigms: "Paradigm",
  "what-is-a-paradigm": "Paradigm",
  background: "Background",
  backgrounds: "Background",
};

function ownValue<T>(values: Readonly<Record<string, T>>, key: string): T | undefined {
  return Object.prototype.hasOwnProperty.call(values, key) ? values[key] : undefined;
}

function currentCatalog(): MechanicScaffoldCatalog {
  return { species: SPECIES, paradigms: PARADIGMS, backgrounds: BACKGROUNDS, speciesSizes: SPECIES_SIZE };
}

function pageTitle(content: string, stem: string): string {
  const heading = content.match(/^#{1,4}\s+(.+)$/m)?.[1];
  return (heading || stem).replace(/[*_`]/g, "").trim() || stem;
}

function matchKey(stem: string, content: string): Set<string> {
  return new Set([slugify(stem), slugify(pageTitle(content, stem))].filter(Boolean));
}

function findKnownMechanic(hint: CodexPageHint):
  | { kind: "Species"; value: Species }
  | { kind: "Paradigm"; value: Paradigm }
  | { kind: "Background"; value: CodexBackground }
  | null {
  const catalog = hint.catalog ?? currentCatalog();
  const keys = matchKey(hint.stem, hint.content);
  const species = catalog.species.find((item) => keys.has(slugify(item.id)) || keys.has(slugify(item.name)));
  if (species) return { kind: "Species", value: species };
  const paradigm = catalog.paradigms.find((item) => keys.has(slugify(item.id)) || keys.has(slugify(item.name)));
  if (paradigm) return { kind: "Paradigm", value: paradigm };
  const background = catalog.backgrounds.find((item) => keys.has(slugify(item.name)));
  return background ? { kind: "Background", value: background } : null;
}

function cleanCell(value: unknown): string {
  return String(value ?? "").replace(/\r?\n/g, " ").replace(/\|/g, "\\|").trim();
}

function signed(value: number): string {
  return `${value >= 0 ? "+" : ""}${value}`;
}

function speciesBonuses(species: Species): string {
  const values = ATTRIBUTES.flatMap((attribute) => {
    const value = species.bonuses[attribute.key];
    return value == null || value === 0 ? [] : [`${attribute.short} ${signed(value)}`];
  });
  return values.join(", ") || "None";
}

function backgroundBonuses(background: CodexBackground): string {
  const attr = ATTRIBUTES.flatMap((attribute) => {
    const value = background.attrBonus?.[attribute.key];
    return value == null || value === 0 ? [] : [`${signed(value)} ${attribute.label}`];
  });
  const spec = SPECIALTIES.flatMap((specialty) => {
    const value = background.specBonus?.[specialty.key];
    return value == null || value === 0 ? [] : [`${signed(value)} ${specialty.label}`];
  });
  return [...attr, ...spec].join(", ") || "None";
}

function table(rows: Array<[string, unknown]>): string {
  return rows.map(([key, value]) => `| ${key} | ${cleanCell(value)} |`).join("\n");
}

function mechanicsBlock(
  known: NonNullable<ReturnType<typeof findKnownMechanic>>,
  catalog: MechanicScaffoldCatalog
): string {
  if (known.kind === "Species") {
    const species = known.value;
    return `## Campaign Mechanics (Character Sheet & VTT)

> This populated table is the campaign override used by character creation, sheets, and the VTT. Fields you remove continue to inherit the official lineage; variant abilities remain inherited unless you add an explicit \`## Variants\` section.

| Field | Value |
|---|---|
${table([
  ["Type", "Species"],
  ["Name", species.name],
  ["Family", species.family],
  ["Bonuses", speciesBonuses(species)],
  ["Innate", species.innate.join(", ") || "None"],
  ["Size", catalog.speciesSizes?.[species.id] ?? ""],
  ["Dominance", species.dom ?? ""],
  ["Recessiveness", species.rec ?? ""],
  ["Eminence", species.eminence ?? ""],
  ["Innate Select", species.innateSelect ?? ""],
  ["Note", species.note ?? ""],
])}`;
  }
  if (known.kind === "Paradigm") {
    const paradigm = known.value;
    return `## Campaign Mechanics (Character Sheet & VTT)

> This populated table is the campaign override used by character creation, sheets, and the VTT.

| Field | Value |
|---|---|
${table([
  ["Type", "Paradigm"],
  ["Name", paradigm.name],
  ["Group", paradigm.group],
  ["Weapons", paradigm.weapons.join(", ")],
  ["Domains", paradigm.domains.join(", ")],
])}`;
  }
  const background = known.value;
  return `## Campaign Mechanics (Character Sheet & VTT)

> This populated table is the campaign override used by character creation, sheets, and the VTT.

| Field | Value |
|---|---|
${table([
  ["Type", "Background"],
  ["Name", background.name],
  ["Mode", background.mode ?? ""],
  ["Bonuses", backgroundBonuses(background)],
  ["Note", background.note ?? ""],
])}`;
}

/** Best display/editor section for a page. Explicit author metadata wins; then
 * structured Type/kind; then exact known catalogs and a few directory pages. */
export function inferCodexSectionLabel(hint: CodexPageHint): string | undefined {
  if (hint.label?.trim()) return hint.label.trim();
  const declared = (readField(hint.content, "Type") || "").trim().toLowerCase();
  const declaredLabel = ownValue(KIND_LABELS, declared);
  if (declaredLabel) return declaredLabel;
  const kind = (hint.kind || "").trim().toLowerCase();
  const kindLabel = ownValue(KIND_LABELS, kind);
  if (kindLabel) return kindLabel;
  const known = findKnownMechanic(hint);
  if (known) return known.kind;
  return ownValue(SECTION_STEMS, slugify(hint.stem));
}

/** Prepare an official article for a Curator fork. Structured pages are left
 * byte-for-byte alone; known legacy articles receive one populated mechanics
 * table before pageIdentity assigns the campaign id and official Overrides id. */
export function prepareCampaignCustomization(hint: CodexPageHint): PreparedCampaignCustomization {
  const label = inferCodexSectionLabel(hint) ?? "Lore";
  const declared = (readField(hint.content, "Type") || "").trim().toLowerCase();
  const semantic = ownValue(KIND_LABELS, declared);
  if (semantic) {
    return {
      content: hint.content,
      label,
      kind: semantic === "Species" || semantic === "Paradigm" || semantic === "Background" ? semantic : undefined,
      scaffolded: false,
    };
  }
  const known = findKnownMechanic(hint);
  if (!known) return { content: hint.content, label, scaffolded: false };
  const catalog = hint.catalog ?? currentCatalog();
  return {
    content: `${hint.content.trimEnd()}\n\n${mechanicsBlock(known, catalog)}\n`,
    label: known.kind,
    kind: known.kind,
    scaffolded: true,
  };
}
