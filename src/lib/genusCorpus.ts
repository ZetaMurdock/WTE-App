// Finding official Genus abilities inside the real Codex pages.
//
// The corpus does not look the way the field-table parser expects. There is no
// page per ability and no `| Type | Genus |` row anywhere; there are five domain
// pages — Eldritch_Genus.md, Elemental_Genus.md and so on — each containing every
// ability in that domain inside one block of exported wiki HTML. So
// parseCodexEntry finds nothing genus-shaped in 321 files, and the Codex had
// official mechanics with no idea where to read about them.
//
// This scanner supplies exactly that missing piece and nothing else: which page an
// official ability lives on, and roughly where in it. It never reads a number.
// Mechanics come from genus.json — the pages are a mirror that may be older than
// the data, and letting them speak would put a stale SS in front of a table that
// had no way to know.
//
// It finds names rather than parsing structure because the export has nothing
// stable to parse: no id attributes, no headings, no mw-headline spans. Each
// ability's name sits in a styled div, and the styling is presentation that could
// change at any time. A name match is honest about what it is — a lookup — and
// degrades to "no page found" instead of to wrong data.
import { slugify } from "../game/codexId";
import { GENUS_DOMAIN_NAMES, getGenusDomain } from "../game/wte";
import type { GenusPage } from "../game/codexGenusSource";

/** A page as far as this scanner cares: its stem and its raw text. */
export interface RawPage {
  stem: string;
  text: string;
}

export interface CorpusScan {
  /** Provenance-only page records, ready for buildOfficialGenus. */
  pages: GenusPage[];
  /** Official abilities no page could be found for. */
  unlocated: string[];
  /** Domains in the data file with no page, and pages for domains that are not
   *  in the data file. Both are real content problems worth saying out loud. */
  domainMismatch: { missingPages: string[]; unknownPages: string[] };
}

const stripTags = (s: string): string => s.replace(/<[^>]*>/g, " ").replace(/&[a-z]+;/gi, " ");

/**
 * Does this page look like the domain page for `domain`?
 *
 * Former names count. The installed corpus ships Kinetic_Genus.md for the domain
 * the rules now call Photonic, so matching the current name alone left twenty
 * abilities with no page and one page describing nothing.
 */
function pageForDomain(pages: RawPage[], domain: string): RawPage | undefined {
  const names = [domain, ...(getGenusDomain(domain)?.aliases ?? [])].map(slugify).filter(Boolean);
  for (const want of names) {
    const exact = pages.find((p) => slugify(p.stem) === `${want}-genus`);
    if (exact) return exact;
  }
  for (const want of names) {
    const loose = pages.find((p) => slugify(p.stem).startsWith(want) && /genus/i.test(p.stem));
    if (loose) return loose;
  }
  return undefined;
}

/** Whole-word, case-insensitive presence of a name in already-stripped text. */
function mentions(plain: string, name: string): boolean {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^A-Za-z0-9])${escaped}([^A-Za-z0-9]|$)`, "i").test(plain);
}

/**
 * Locate every official Genus ability in the installed pages.
 *
 * `pages` should be every Codex page; only the domain pages are used, and a page
 * that is simply lore is ignored rather than reported.
 */
export function scanGenusCorpus(pages: RawPage[]): CorpusScan {
  const out: GenusPage[] = [];
  const unlocated: string[] = [];
  const missingPages: string[] = [];

  const genusPages = pages.filter((p) => /genus/i.test(p.stem));
  const claimed = new Set<string>();

  for (const domain of GENUS_DOMAIN_NAMES) {
    const abilities = getGenusDomain(domain)?.abilities ?? [];
    const page = pageForDomain(genusPages, domain);
    if (!page) {
      missingPages.push(domain);
      for (const a of abilities) unlocated.push(a.name);
      continue;
    }
    claimed.add(page.stem);
    const plain = stripTags(page.text);
    for (const a of abilities) {
      if (!mentions(plain, a.name)) {
        unlocated.push(a.name);
        continue;
      }
      out.push({
        stem: page.stem,
        title: a.name,
        // The anchor is the ability's name. The corpus carries no id attributes,
        // so the Codex viewer scrolls by matching text rather than by fragment.
        anchor: slugify(a.name),
        // Deliberately no `data`. A grouped page could be scraped for numbers, and
        // that is exactly what must not happen: genus.json is authoritative, and a
        // mirror one revision behind would silently rewrite live rules.
      });
    }
  }

  // A domain page the data file has no domain for. Right now the installed corpus
  // ships Kinetic_Genus while the data file calls that domain Photonic, so 20
  // abilities have no page and one page describes no known domain. Reporting it
  // beats either half silently going missing.
  const unknownPages = genusPages
    .map((p) => p.stem)
    .filter((stem) => !claimed.has(stem) && !/^genera$/i.test(stem));

  return { pages: out, unlocated, domainMismatch: { missingPages, unknownPages } };
}
