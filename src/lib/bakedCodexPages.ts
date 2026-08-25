// The baked catalog, expressed as Codex pages.
//
// W.T.E ships nine lineages, six paradigms and thirty-five variants as compiled
// data (game/wte.ts and game/data/*.json). The overlay machinery to override any
// of it from a campaign page has existed for a while — but Campaign Settings
// lists PAGES, and none of that data is a page. So the rules a table actually
// plays by were invisible and unforkable: a Curator could see Salaris, Trevant
// and Qerran in character creation and find nothing to edit anywhere.
//
// These pages close that gap without moving the data. They are generated on
// demand, never stored, and never pulled — the compiled arrays remain the single
// source of truth and app updates to them flow straight through. Their only job
// is to give the Curator something to READ and to FORK. Forking one produces an
// ordinary campaign page, which is pulled and overlaid like any other, so the
// authored copy is what character creation and the VTT then read.
//
// Everything emitted here must parse back to the record it came from. That is
// what bakedCodexPages.test.ts asserts, species by species and field by field:
// a "Customize" that quietly dropped a variant or an innate would be far worse
// than no page at all.
import {
  ATTRIBUTES,
  SPECIALTIES,
  bakedCiphers,
  bakedInceptPools,
  bakedParadigms,
  bakedSpecies,
  bakedSpeciesInnate,
  bakedSpeciesSize,
  GENUS_DOMAIN_NAMES,
  getGenusDomain,
  type CipherAbility,
  type GenusAbility,
  type Incept,
  type Paradigm,
  type Species,
  type SpeciesVariantAbility,
} from "../game/wte";
import { isRollGrant, rollRefLabel, type InceptGrant } from "../game/inceptGrants";
import { slugify } from "../game/codexId";
import { splitCipherEffect } from "./codexParse";
import type { CampaignCodexPage } from "./campaignCodex";

/** Page ids and stems are slugs; an Incept name is free text. */
function slugId(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

/** Table cells are read with `|([^|]+)|([^|]+)|`, so a pipe inside a value would
 *  end the cell early and truncate the rule. No baked string contains one; this
 *  keeps that true for anything added later. */
function cell(value: unknown): string {
  return String(value ?? "").replace(/\r?\n+/g, " ").replace(/\|/g, "/").trim();
}

function signed(value: number): string {
  return `${value >= 0 ? "+" : ""}${value}`;
}

function bonusList(species: Species): string {
  const parts = ATTRIBUTES.flatMap((attribute) => {
    const value = species.bonuses[attribute.key];
    return value ? [`${attribute.short} ${signed(value)}`] : [];
  });
  return parts.join(", ") || "None";
}

function fieldTable(rows: Array<[string, unknown]>): string {
  const body = rows
    .filter(([, value]) => value !== undefined && value !== null && String(value) !== "")
    .map(([key, value]) => `| ${key} | ${cell(value)} |`)
    .join("\n");
  return `| Field | Value |\n|---|---|\n${body}`;
}

function abilityBullets(abilities: readonly SpeciesVariantAbility[]): string {
  return abilities.map((a) => `- **${cell(a.name)}** — ${cell(a.effect) || "—"}`).join("\n");
}

const PREAMBLE =
  "*Built-in W.T.E rule, shown here so it can be changed. " +
  "**Customize** copies it into this campaign; edit any row and character creation, " +
  "the sheet and the VTT follow. Delete a row to keep inheriting the official value.*";

/** One Species page: the mechanics table, the innate abilities with their
 *  effects, and every lineage variant including its creation-time options. */
export function bakedSpeciesPageContent(species: Species): string {
  const sections = [
    `# ${species.name}`,
    PREAMBLE,
    fieldTable([
      ["Type", "Species"],
      ["ID", `wte.species.${species.id}`],
      ["Name", species.name],
      ["Family", species.family],
      ["Bonuses", bonusList(species)],
      ["Size", bakedSpeciesSize(species.id)],
      ["Dominance", species.dom],
      ["Recessiveness", species.rec],
      ["Eminence", species.eminence],
      ["Innate Select", species.innateSelect],
      ["Note", species.note],
    ]),
  ];

  // Names come from the Species record, effects from the wiki export. Emitting
  // both together is the whole point: it is the only form in which a renamed or
  // invented innate can carry an effect.
  const baked = bakedSpeciesInnate(species.id);
  const effects = new Map(baked.map((a) => [a.name.toLowerCase(), a.effect]));
  const innate = species.innate.map((name) => ({ name, effect: effects.get(name.toLowerCase()) ?? "" }));
  if (innate.length) sections.push(`## Innate`, abilityBullets(innate));

  if (species.variants.length) {
    sections.push(`## Variants`);
    for (const variant of species.variants) {
      sections.push(`### ${variant.name}`);
      if (variant.note) sections.push(cell(variant.note));
      const bullets = [
        abilityBullets(variant.abilities),
        (variant.options ?? [])
          .map((o) => `- Option: ${cell(o.label)} — **${cell(o.ability.name)}** — ${cell(o.ability.effect) || "—"}`)
          .join("\n"),
      ].filter(Boolean);
      if (bullets.length) sections.push(bullets.join("\n"));
    }
  }
  return `${sections.join("\n\n")}\n`;
}

/** One Incept page: its pool, its Weight Class, its executable grants, and the
 *  prose a player reads. Grants are emitted only where the Incept has been
 *  converted — an empty section would read as "this Incept does nothing". */
export function bakedInceptPageContent(speciesId: string, incept: Incept): string {
  const sections = [
    `# ${incept.name}`,
    PREAMBLE,
    fieldTable([
      ["Type", "Incept"],
      ["ID", `wte.incept.${slugId(speciesId)}-${slugId(incept.name)}`],
      ["Name", incept.name],
      ["Species", speciesId],
      ["Weight", incept.weight],
      ["Memory", incept.memory],
    ]),
  ];
  if (incept.grants?.length) {
    sections.push("## Grants", incept.grants.map((g) => `- ${grantLine(g)}`).join("\n"));
  }
  if (incept.effect) sections.push("## Effect", incept.effect.trim());
  return `${sections.join("\n\n")}\n`;
}

/** A grant in the exact syntax parseInceptGrants reads back. */
function grantLine(grant: InceptGrant): string {
  if (isRollGrant(grant)) {
    const word = grant.kind === "advantage" ? "Advantage" : "Disadvantage";
    const who = grant.target === "target" ? " (target)" : "";
    return `${word}${who}: ${rollRefLabel(grant.on)}`;
  }
  if (grant.kind === "damage") return `Damage: ${grant.expr}${grant.damageType ? ` ${grant.damageType}` : ""}`;
  const resource = grant.resource === "ss" ? "SS" : grant.resource === "health" ? "Health" : "Focus";
  return `${grant.kind === "restore" ? "Restore" : "Cost"}: ${grant.expr} ${resource}`;
}

const ATTR_LABELS: Readonly<Record<string, string>> = Object.fromEntries(
  ATTRIBUTES.map((attribute) => [attribute.key, attribute.label])
);
const SPEC_LABELS: Readonly<Record<string, string>> = Object.fromEntries(
  SPECIALTIES.map((specialty) => [specialty.key, specialty.label])
);

function favoredAttrRow(paradigm: Paradigm): string | undefined {
  if (!paradigm.favoredAttrs?.length) return undefined;
  const names = paradigm.favoredAttrs.map((key) => ATTR_LABELS[key] ?? key);
  if (paradigm.favoredChoice) names.push("Choose 1 Additional Attribute");
  return names.join(" · ");
}

function favoredSpecRow(paradigm: Paradigm): string | undefined {
  if (!paradigm.favoredSpecs?.length) return undefined;
  const names = paradigm.favoredSpecs.map((key) => SPEC_LABELS[key] ?? key);
  if (paradigm.favoredChoice) names.push("Choose 1 Additional Specialty");
  return names.join(" · ");
}

export function bakedParadigmPageContent(paradigm: Paradigm): string {
  return `${[
    `# ${paradigm.name}`,
    PREAMBLE,
    fieldTable([
      ["Type", "Paradigm"],
      ["ID", `wte.paradigm.${paradigm.id}`],
      ["Name", paradigm.name],
      ["Group", paradigm.group],
      ["Weapons", paradigm.weapons.join(", ")],
      ["Domains", paradigm.domains.join(", ")],
      ["Favored Attributes", favoredAttrRow(paradigm)],
      ["Favored Specialties", favoredSpecRow(paradigm)],
    ]),
  ].join("\n\n")}\n`;
}

/** One Genus ability page. Every row round-trips through parseCodexEntry, so a
 *  campaign fork of this page IS the campaign override the Genus resolver
 *  honours — same id-keyed layering as any hand-authored campaign Genus page.
 *
 *  No preamble prose: parseCodexEntry sweeps loose prose into `effect`, so the
 *  only text outside the field table must be the effect itself. The Customize
 *  guidance the species pages carry lives in the mechanics editor instead. */
export function bakedGenusPageContent(ability: GenusAbility, domain: string): string {
  const sections = [
    `# ${ability.name}`,
    fieldTable([
      ["Type", "Genus"],
      ["ID", ability.id ?? `wte.genus.${slugify(ability.name)}`],
      ["Domain", domain],
      ["SS", ability.ss],
      ["Activation", ability.activation],
      ["Range", ability.range],
      ["Target", ability.target],
      ["Classification", ability.classification],
      ["Limit", ability.limit],
    ]),
  ];
  const effect = (ability.effect ?? "").trim();
  if (effect) sections.push("## Effect", effect);
  return `${sections.join("\n\n")}\n`;
}

/** One cipher page. Ciphers still LOAD by name (the legacy merge, not the id
 *  registry), so a fork keeps working only while its Name row still names the
 *  official cipher — the stamped ID row is what an applied outcome files under.
 *  Prose-free for the same reason as the Genus pages. */
export function bakedCipherPageContent(cipher: CipherAbility, paradigmId: string): string {
  const split = cipher.effect ? splitCipherEffect(cipher.effect) : null;
  const sections = [
    `# ${cipher.name}`,
    fieldTable([
      ["Type", "Cipher"],
      ["ID", cipher.id ?? `wte.cipher.${slugify(cipher.name)}`],
      ["Name", cipher.name],
      ["Paradigm", paradigmId],
      ["Tier", cipher.tier],
      ["SS", cipher.ss],
      ["Activation", cipher.type],
      ["Rank", split?.rank],
      ["Component", split?.component],
    ]),
  ];
  const body = (split ? split.body : cipher.effect ?? "").trim();
  if (body) sections.push("## Effect", body);
  return `${sections.join("\n\n")}\n`;
}

function page(id: string, stem: string, title: string, kind: string, label: string, content: string): CampaignCodexPage {
  return {
    id,
    stem,
    title,
    kind,
    label,
    content,
    visibility: "player",
    // NEVER pulled. These pages describe data the loader already has compiled
    // in; parsing them back in would be a no-op at best, and any drift between
    // the generator and the parser would become a live rules change at worst.
    pulled: false,
    source: "official",
    builtIn: true,
  };
}

/** Every baked rule as a forkable official page. Regenerated per call — cheap,
 *  and it must reflect a mid-session catalog change rather than a boot-time one. */
export function bakedCodexPages(): CampaignCodexPage[] {
  return [
    ...bakedSpecies().map((species) =>
      page(
        `wte.species.${species.id}`,
        `species-${species.id}`,
        species.name,
        "species",
        "Species",
        bakedSpeciesPageContent(species)
      )
    ),
    ...Object.entries(bakedInceptPools()).flatMap(([speciesId, pool]) =>
      pool.incepts.map((incept) =>
        page(
          `wte.incept.${slugId(speciesId)}-${slugId(incept.name)}`,
          `incept-${slugId(speciesId)}-${slugId(incept.name)}`,
          incept.name,
          "incept",
          "Incept",
          bakedInceptPageContent(speciesId, incept)
        )
      )
    ),
    ...bakedParadigms().map((paradigm) =>
      page(
        `wte.paradigm.${paradigm.id}`,
        `paradigm-${paradigm.id}`,
        paradigm.name,
        "paradigm",
        "Paradigm",
        bakedParadigmPageContent(paradigm)
      )
    ),
    ...GENUS_DOMAIN_NAMES.flatMap((domain) =>
      (getGenusDomain(domain)?.abilities ?? []).map((ability) =>
        page(
          ability.id ?? `wte.genus.${slugify(ability.name)}`,
          `genus-${slugify(ability.name)}`,
          ability.name,
          "genus",
          "Genus",
          bakedGenusPageContent(ability, domain)
        )
      )
    ),
    ...Object.entries(bakedCiphers()).flatMap(([paradigmId, ciphers]) =>
      ciphers.map((cipher) =>
        page(
          cipher.id ?? `wte.cipher.${slugify(cipher.name)}`,
          `cipher-${slugify(cipher.name)}`,
          cipher.name,
          "cipher",
          "Cipher",
          bakedCipherPageContent(cipher, paradigmId)
        )
      )
    ),
  ];
}

/** Resolve a built-in page by id, or by the stem an authoring surface was given.
 *  Used by the Codex browser so "Customize" on a built-in page can open it.
 *
 *  Indexed: the browser's type scan calls this once per stem, and rebuilding
 *  the ~260-page catalog for each lookup made one scan quadratic. The index is
 *  dropped on `wte-pages-changed` — the same signal every catalog change
 *  already fires — so a mid-session change still regenerates. */
let bakedIndex: Map<string, CampaignCodexPage> | null = null;
if (typeof window !== "undefined") {
  window.addEventListener("wte-pages-changed", () => {
    bakedIndex = null;
  });
}
export function findBakedCodexPage(ref: { id?: string; stem?: string }): CampaignCodexPage | undefined {
  if (!bakedIndex) {
    bakedIndex = new Map();
    for (const page of bakedCodexPages()) {
      if (!bakedIndex.has(`id:${page.id}`)) bakedIndex.set(`id:${page.id}`, page);
      if (!bakedIndex.has(`stem:${page.stem}`)) bakedIndex.set(`stem:${page.stem}`, page);
    }
  }
  return (ref.id ? bakedIndex.get(`id:${ref.id}`) : undefined) ??
    (ref.stem ? bakedIndex.get(`stem:${ref.stem}`) : undefined);
}
