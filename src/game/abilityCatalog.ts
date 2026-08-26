// Every ability a page is allowed to name, indexed the way a page names one.
//
// `Invoke: Weaponize` is a REFERENCE, and a reference needs somewhere to
// resolve. Until now nothing in the app could answer "which record is called
// Weaponize?" without already knowing whether it was a Genus ability, a Cipher
// or an innate, and without holding the paradigm or species it belongs to —
// which the invoking page does not know and must not have to state. S4 — THE
// LAST WAR is a Warfare cipher that names WEAPONIZE, HOLLOW SHELL and TRIXT
// LINK, all three of which happen to be Warfare ciphers too; nothing about the
// grammar says they have to be, and a Genus ability naming a Cipher is the same
// sentence.
//
// So the catalog is FLAT and covers every kind at once. It is built from the
// live catalogs rather than the baked JSON, so a campaign that forked
// WEAPONIZE onto its own page is the Weaponize that gets invoked — a resolver
// reading `ciphers.json` directly would have silently run the official rule
// instead of the table's, which is the "hidden compiled rule" failure mode in
// its purest form.
//
// RESOLUTION ORDER, and why it is not negotiable:
//   1. permanent id   (`wte.cipher.weaponize`)
//   2. current name   ("WEAPONIZE")
//   3. former name    (the `aliases` a rename leaves behind)
// Ids first because a page that can write one has said exactly which record it
// means and a rename must not move it. Names before aliases for the reason
// `speciesInnate` already documents: one ability's FORMER name is allowed to be
// another's CURRENT name, and the living ability owns it — the other way round
// hands a page the wrong ability, which for an invocation means running the
// wrong rules under the right label.
import {
  PARADIGMS,
  SPECIES,
  ciphersForParadigm,
  genusForParadigm,
  speciesInnate,
} from "./wte";
import { codexRevision } from "./codexService";

/** What an invocation needs from whichever record it resolved to. The three
 *  ability kinds already agree on this shape — name, optional permanent id,
 *  optional former names, prose, and an optional `## Actions` block — so the
 *  catalog does not have to know which kind it is holding. */
export interface CatalogAbility {
  id?: string;
  name: string;
  aliases?: readonly string[];
  effect?: string | null;
  /** The page's `## Actions` block, verbatim. Absent for the whole undeclared
   *  corpus, which is what makes an invocation's "quote the prose" state a
   *  first-class answer rather than a failure. */
  actions?: string | null;
  kind: "genus" | "cipher" | "innate";
}

export interface AbilityCatalog {
  /** Resolve one written reference. Null means this campaign has no page for
   *  it — which is a finding on the invoking page, never a silent no-op. */
  lookup(ref: string): CatalogAbility | null;
  /** How many distinct records are reachable. Lets a caller tell "not found"
   *  apart from "the catalog was never populated". */
  size: number;
}

/** The key a lookup is made under. Ids keep their case (they are already
 *  slugged and case-sensitive by construction); names do not, because the
 *  corpus SHOUTS its cipher names and a block will not. */
function nameKey(ref: string): string {
  return ref.trim().toLowerCase();
}

const EMPTY: AbilityCatalog = { lookup: () => null, size: 0 };

/**
 * Index a set of records. Exported so a test — or a table's own tooling — can
 * build a catalog over exactly the records it means, rather than over whatever
 * happens to be registered in the singletons.
 */
export function buildAbilityCatalog(records: readonly CatalogAbility[]): AbilityCatalog {
  if (!records.length) return EMPTY;
  const byKey = new Map<string, CatalogAbility>();
  const claim = (key: string, record: CatalogAbility) => {
    if (key && !byKey.has(key)) byKey.set(key, record);
  };
  // Two passes, in this order, for the alias rule above.
  for (const record of records) {
    if (record.id) claim(record.id, record);
    claim(nameKey(record.name), record);
  }
  for (const record of records) {
    for (const alias of record.aliases ?? []) claim(nameKey(alias), record);
  }
  return {
    size: new Set(records).size,
    lookup(ref) {
      const raw = String(ref ?? "").trim();
      if (!raw) return null;
      return byKey.get(raw) ?? byKey.get(nameKey(raw)) ?? null;
    },
  };
}

/**
 * Every ability currently in force, across every paradigm and every lineage.
 *
 * Reads the SAME accessors the loadout pickers read, so a record the catalog
 * can resolve is a record a character could actually have been given. The
 * per-paradigm and per-species readers are the only ones that apply the page
 * overlay; the `*_BY_ID` maps beside them are baked-only and would have made an
 * invocation ignore a campaign's fork.
 */
export function collectAbilityRecords(): CatalogAbility[] {
  const out: CatalogAbility[] = [];
  const seen = new Set<unknown>();
  const add = (record: CatalogAbility) => {
    // One record, once. A Genus ability reachable from three paradigms is one
    // ability, and indexing it three times would only make `size` lie.
    if (seen.has(record)) return;
    seen.add(record);
    out.push(record);
  };
  for (const paradigm of PARADIGMS) {
    for (const group of genusForParadigm(paradigm.id)) {
      for (const ability of group.abilities) {
        add({ id: ability.id, name: ability.name, aliases: ability.aliases, effect: ability.effect, actions: ability.actions, kind: "genus" });
      }
    }
    for (const cipher of ciphersForParadigm(paradigm.id)) {
      add({ id: cipher.id, name: cipher.name, aliases: cipher.aliases, effect: cipher.effect, actions: cipher.actions, kind: "cipher" });
    }
  }
  for (const species of SPECIES) {
    for (const innate of speciesInnate(species.id)) {
      add({ id: innate.id, name: innate.name, aliases: innate.aliases, effect: innate.effect, actions: innate.actions, kind: "innate" });
    }
    // Lineage variants carry abilities that exist nowhere else — a Remnant
    // echo's own rules live on a variant, and a page that names one must not be
    // told the campaign has no such ability.
    for (const variant of species.variants ?? []) {
      for (const ability of variant.abilities ?? []) {
        add({ id: ability.id, name: ability.name, aliases: ability.aliases, effect: ability.effect, actions: ability.actions, kind: "innate" });
      }
    }
  }
  return out;
}

let cached: { revision: number; catalog: AbilityCatalog } | null = null;

/**
 * The catalog for the campaign currently loaded.
 *
 * Memoised on `codexRevision`, which is bumped by the same page pass that calls
 * `registerCodexGameData` — so a campaign switch invalidates this, and a render
 * loop does not rebuild a five-hundred-entry index per ability row. A build
 * that lands mid-pass caches under the OLD revision and is replaced by the next
 * call, so the stale window closes itself rather than persisting.
 */
export function officialAbilityCatalog(): AbilityCatalog {
  const revision = codexRevision();
  if (cached?.revision === revision) return cached.catalog;
  const catalog = buildAbilityCatalog(collectAbilityRecords());
  cached = { revision, catalog };
  return catalog;
}
