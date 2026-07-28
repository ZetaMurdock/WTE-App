// Where official Genus mechanics come from, and where campaign ones do.
//
// THE RULE THIS FILE EXISTS TO ENFORCE
//
// genus.json is authoritative for official mechanics. The pulled Codex pages are
// a wiki mirror: some are older than the data file, some were edited by hand, some
// were exported mid-revision. Letting a page supply an official SS or effect would
// quietly replace live rules with whatever the mirror happened to contain, and
// nobody would know which version their table was playing.
//
// So official pages contribute PROVENANCE only — the stem to open, an anchor, the
// names the ability has gone by. Where a page's mechanics disagree with the data
// file, that is reported as a discrepancy for a person to settle, not resolved.
//
// Campaign-authored pages are the opposite case: they exist precisely to change
// the rules, so they DO carry mechanics, as campaign-scoped layers the resolver
// stacks on top of the official one.
import type { CodexEntity } from "./codexEntity";
import { buildEntity } from "./codexEntity";
import { slugify } from "./codexId";
import { STANDALONE, type RegistryProblem } from "./codexRegistry";
import { GENUS_DOMAIN_NAMES, getGenusDomain, type GenusAbility } from "./wte";

/** What a parsed Codex page can tell us about a Genus ability. */
export interface GenusPage {
  /** Page stem — what "open full page" navigates to. */
  stem: string;
  /** The ability name as the page titles it. */
  title: string;
  /** Heading anchor within the page, when the ability is one section of many. */
  anchor?: string;
  /** Other names this page says the ability has gone by. */
  aliases?: string[];
  /** Only "curator" restricts; anything else is ordinary content. */
  visibility?: string;
  /** Declared identity fields from the page's field table. */
  id?: string;
  overrides?: string;
  /** Mechanics as parsed. Honoured for campaign pages; compared, never applied,
   *  for official ones. */
  data?: Partial<GenusAbilityData>;
}

export interface GenusAbilityData {
  domain: string;
  ss: number | null;
  activation: string | null;
  range: string | null;
  target: string | null;
  effect: string | null;
  limit: string | null;
  classification: string | null;
}

/** Where a concept can be read in full. */
export interface PageRef {
  stem: string;
  anchor?: string;
}

export interface GenusManifest {
  /** id -> where to open it. */
  pages: Map<string, PageRef>;
  /** id -> every name it has answered to, current name excluded. */
  aliases: Map<string, string[]>;
}

export interface OfficialGenusSource {
  entities: CodexEntity[];
  manifest: GenusManifest;
  problems: RegistryProblem[];
}

const clean = (v: unknown): string | null => {
  const s = typeof v === "string" ? v.trim() : "";
  return s ? s : null;
};

function abilityData(a: GenusAbility, domain: string): GenusAbilityData {
  return {
    domain,
    ss: typeof a.ss === "number" ? a.ss : null,
    activation: clean(a.activation),
    range: clean(a.range),
    target: clean(a.target),
    effect: clean(a.effect),
    limit: clean(a.limit),
    classification: clean(a.classification),
  };
}

/**
 * Most-restrictive wins.
 *
 * Several records can describe one concept — the data file, a mirror page, a
 * campaign overlay — and if they disagree about who may see it, the only safe
 * answer is the one that shows it to fewer people. A mirror page that forgot its
 * Visibility row must not un-hide a Curator-only ability.
 */
export function mergeVisibility(...values: (string | undefined)[]): "player" | "curator" {
  for (const v of values) {
    const s = (v ?? "").trim().toLowerCase();
    if (s === "curator" || s === "gm") return "curator";
  }
  return "player";
}

/** The mechanics fields compared between the data file and a mirror page. */
const COMPARED: (keyof GenusAbilityData)[] = ["ss", "activation", "range", "target", "effect", "limit"];

/**
 * Every official Genus ability as a Codex entity.
 *
 * `pages` is optional: without it the abilities still resolve, they simply have no
 * page to open. That is the honest state before anything has been pulled, and it
 * is deliberately not an error — the Codex is usable on a fresh install.
 */
export function buildOfficialGenus(pages: GenusPage[] = []): OfficialGenusSource {
  const entities: CodexEntity[] = [];
  const problems: RegistryProblem[] = [];
  const manifest: GenusManifest = { pages: new Map(), aliases: new Map() };

  // Index the mirror by every name it offers, so a page titled with a former name
  // still attaches to the right ability.
  const byName = new Map<string, GenusPage[]>();
  for (const p of pages) {
    for (const n of [p.title, ...(p.aliases ?? [])]) {
      const k = slugify(n);
      if (!k) continue;
      const list = byName.get(k);
      if (list) list.push(p);
      else byName.set(k, [p]);
    }
  }

  for (const domain of GENUS_DOMAIN_NAMES) {
    for (const a of getGenusDomain(domain)?.abilities ?? []) {
      const matches = byName.get(slugify(a.name)) ?? [];
      // A page that names itself the ability's id wins over one matched by title.
      const page =
        matches.find((p) => p.id && a.id && p.id === a.id) ??
        matches.find((p) => slugify(p.title) === slugify(a.name)) ??
        matches[0];

      if (matches.length > 1) {
        problems.push({
          kind: "ambiguous-alias",
          detail: `${matches.length} Codex pages describe the official "${a.name}"`,
          ids: [a.id ?? a.name],
          severity: "warning",
        });
      }

      const aliases = [...new Set((page?.aliases ?? []).filter((x) => slugify(x) !== slugify(a.name)))];

      const built = buildEntity({
        kind: "genus",
        title: a.name,
        sourcePage: page?.stem ?? "",
        // The id comes from the data file, which is where it is permanent. A page
        // declaring a DIFFERENT id does not get to move it — that is a discrepancy.
        fields: {
          ...(a.id ? { id: a.id } : {}),
          ...(aliases.length ? { aliases: aliases.join(", ") } : {}),
          // Official definitions never override anything, and must never be
          // absorbed into a concept by a page that merely shares their title.
          overrides: STANDALONE,
          visibility: mergeVisibility(page?.visibility),
        },
        data: abilityData(a, domain),
      });
      entities.push(built.entity);

      if (built.malformed) {
        problems.push({ kind: "malformed-id", detail: built.malformed, ids: [built.entity.id], severity: "warning" });
      }
      if (page) {
        manifest.pages.set(built.entity.id, { stem: page.stem, anchor: page.anchor });
        if (aliases.length) manifest.aliases.set(built.entity.id, aliases);

        if (page.id && a.id && page.id !== a.id) {
          problems.push({
            kind: "identity-mismatch",
            detail: `the page "${page.stem}" claims id "${page.id}" for "${a.name}", which is "${a.id}"`,
            ids: [a.id, page.id],
            severity: "warning",
          });
        }
        // Mechanics drift between the mirror and the data file. Reported, not applied.
        const drift = COMPARED.filter(
          (k) => page.data && page.data[k] !== undefined && page.data[k] !== null && page.data[k] !== abilityData(a, domain)[k]
        );
        if (drift.length) {
          problems.push({
            kind: "page-drift",
            detail: `the page "${page.stem}" disagrees with the official "${a.name}" on ${drift.join(", ")} — the official values are in use`,
            ids: [built.entity.id],
            severity: "warning",
          });
        }
      }
    }
  }

  return { entities, manifest, problems };
}

/**
 * Campaign-authored Genus pages, as scoped overlays.
 *
 * These DO carry mechanics — changing the rules is what they are for. Everything
 * else about them is deliberately conservative: a page that declares no
 * `overrides` is joined by title, which the registry then reports so the Curator
 * can see an override they did not write down.
 */
export function buildCampaignGenus(pages: GenusPage[], campaignId: string): {
  entities: CodexEntity[];
  problems: RegistryProblem[];
} {
  const entities: CodexEntity[] = [];
  const problems: RegistryProblem[] = [];
  if (!campaignId) {
    return {
      entities,
      problems: [
        {
          kind: "identity-mismatch",
          detail: "campaign Codex pages were offered without a campaign to own them",
          ids: [],
          severity: "error",
        },
      ],
    };
  }

  for (const p of pages) {
    if (!slugify(p.title)) {
      problems.push({
        kind: "unusable-record",
        detail: `the campaign page "${p.stem}" has no usable title`,
        ids: [],
        severity: "error",
      });
      continue;
    }
    const built = buildEntity({
      kind: "genus",
      title: p.title,
      sourcePage: p.stem,
      fields: {
        ...(p.id ? { id: p.id } : {}),
        ...(p.aliases?.length ? { aliases: p.aliases.join(", ") } : {}),
        ...(p.overrides ? { overrides: p.overrides } : {}),
        visibility: mergeVisibility(p.visibility),
      },
      data: {
        domain: p.data?.domain ?? null,
        ss: p.data?.ss ?? null,
        activation: p.data?.activation ?? null,
        range: p.data?.range ?? null,
        target: p.data?.target ?? null,
        effect: p.data?.effect ?? null,
        limit: p.data?.limit ?? null,
        classification: p.data?.classification ?? null,
      },
      scope: "campaign",
      ownerId: campaignId,
    });
    entities.push(built.entity);
    if (built.malformed) {
      problems.push({ kind: "malformed-id", detail: built.malformed, ids: [built.entity.id], severity: "warning" });
    }
    if (built.mismatch) {
      problems.push({ kind: "identity-mismatch", detail: built.mismatch, ids: [built.entity.id], severity: "warning" });
    }
  }

  return { entities, problems };
}

/** Where to open a concept, preferring what the manifest learned from real pages. */
export function pageRefFor(id: string, manifest: GenusManifest, fallback?: string): PageRef | null {
  const hit = manifest.pages.get(id);
  if (hit && hit.stem) return hit;
  return fallback ? { stem: fallback } : null;
}
