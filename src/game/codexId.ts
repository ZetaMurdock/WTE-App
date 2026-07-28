// Stable identity for Codex concepts.
//
// Everything in W.T.E currently refers to concepts by DISPLAY NAME or by page stem:
// notes.attached_to holds a stem, Sequence.recordIds is an ordered list of stems,
// characters reference weapons and gear by name, and focusSpend.genus is keyed by
// ability name. That works until something is renamed, at which point every
// reference silently dangles — a Curator renaming "Vector Swing" to "Vector
// Redirection" breaks every character and creature that had it.
//
// A stable id is assigned once and never changes. The display name becomes a
// label, free to change, and aliases keep old names resolvable.
//
// Shape:  <scope>.<kind>.<slug>
//   wte.genus.vector-swing                        official
//   wte.condition.staggered                       official
//   wte.stat.synaptic-space                        official
//   campaign.ashen-sun.ability.gravitic-blood      campaign-authored
//   pack.red-choir.creature.transmission-wraith    from a content pack
//
// The scope prefix is what makes layering expressible: an official definition, a
// pack extension, a campaign override and a character exception can all coexist and
// be resolved in order, with the winner able to say where it came from.

/** Where a definition came from. Ordered weakest to strongest — a later layer
 *  overrides an earlier one, and the resolved value can report which won. */
export const ID_SCOPES = ["wte", "pack", "campaign", "character", "session"] as const;
export type IdScope = (typeof ID_SCOPES)[number];

/** The kinds of thing that can carry a stable id. Deliberately a closed list:
 *  an unknown kind means a typo, not a new concept. */
export const ID_KINDS = [
  "genus",
  "cipher",
  "incept",
  "ability",
  "species",
  "variant",
  "paradigm",
  "background",
  "sector",
  "weapon",
  "gear",
  "creature",
  "condition",
  "stat",
  "specialty",
  "attribute",
  "derived",
  "variable",
  "page",
  "sequence",
  "note",
  "scene",
  "encounter",
] as const;
export type IdKind = (typeof ID_KINDS)[number];

export interface CodexId {
  scope: IdScope;
  /** Present only for scoped layers: the campaign, pack or character it belongs to. */
  owner?: string;
  kind: IdKind;
  slug: string;
}

/** Turn a display name into a slug: lowercase, ASCII, hyphen-separated.
 *
 *  Deliberately lossy and deterministic — the same name always produces the same
 *  slug, so an id can be derived once from existing content during migration
 *  without a lookup table. */
export function slugify(name: string): string {
  return String(name)
    .normalize("NFKD")
    // strip combining marks so "Voaültön" and "Voaulton" agree
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Build an id string. Throws on an empty slug rather than producing a malformed
 *  id that would silently fail to resolve later. */
export function makeId(kind: IdKind, name: string, opts?: { scope?: IdScope; owner?: string }): string {
  const slug = slugify(name);
  if (!slug) throw new Error(`Cannot build a Codex id from ${JSON.stringify(name)} — it has no usable characters.`);
  const scope = opts?.scope ?? "wte";
  if (scope === "wte") return `wte.${kind}.${slug}`;
  const owner = slugify(opts?.owner ?? "");
  if (!owner) throw new Error(`A ${scope}-scoped id needs an owner (the campaign, pack or character it belongs to).`);
  return `${scope}.${owner}.${kind}.${slug}`;
}

/** Parse an id string. Null when it is not a well-formed id — callers must handle
 *  that rather than assume, because ids arrive from stored records and packs. */
export function parseId(id: string): CodexId | null {
  if (typeof id !== "string" || !id) return null;
  const parts = id.split(".");
  if (parts.length < 3) return null;
  const scope = parts[0] as IdScope;
  if (!ID_SCOPES.includes(scope)) return null;

  if (scope === "wte") {
    if (parts.length !== 3) return null;
    const [, kind, slug] = parts;
    if (!ID_KINDS.includes(kind as IdKind) || !slug) return null;
    return { scope, kind: kind as IdKind, slug };
  }
  // scoped: <scope>.<owner>.<kind>.<slug>
  if (parts.length !== 4) return null;
  const [, owner, kind, slug] = parts;
  if (!owner || !slug || !ID_KINDS.includes(kind as IdKind)) return null;
  return { scope, owner, kind: kind as IdKind, slug };
}

export function isCodexId(id: unknown): id is string {
  return typeof id === "string" && parseId(id) !== null;
}

/** Layer precedence, weakest first. A resolver walks these in order and the last
 *  match wins, which is what lets a campaign override an official rule while still
 *  being able to say that it did. */
export function scopeRank(scope: IdScope): number {
  return ID_SCOPES.indexOf(scope);
}

/** Compare two ids for override precedence. Positive when `a` wins. */
export function compareScope(a: string, b: string): number {
  const pa = parseId(a);
  const pb = parseId(b);
  if (!pa || !pb) return 0;
  return scopeRank(pa.scope) - scopeRank(pb.scope);
}

/** Do two ids refer to the SAME concept, ignoring which layer defined it?
 *  `wte.genus.vector-swing` and `campaign.ashen-sun.genus.vector-swing` do. */
export function sameConcept(a: string, b: string): boolean {
  const pa = parseId(a);
  const pb = parseId(b);
  if (!pa || !pb) return false;
  return pa.kind === pb.kind && pa.slug === pb.slug;
}

/** The official id a scoped id overrides, or null when it defines something new. */
export function overriddenId(id: string): string | null {
  const p = parseId(id);
  if (!p || p.scope === "wte") return null;
  return `wte.${p.kind}.${p.slug}`;
}

export interface CodexIdentity {
  /** Permanent. Assigned once, never changed, even when the name does. */
  id: string;
  /** Free to change. What the user reads. */
  name: string;
  /** Former names and spellings, so an old reference still resolves. Renaming
   *  something should push its previous name here. */
  aliases?: string[];
  /** Set when this definition replaces another, so provenance can be shown. */
  overrides?: string;
  /** Set when this concept is retired; points at what replaced it, if anything. */
  deprecatedBy?: string;
}

/** Every string a concept can be found by, lowercased for matching. This is what a
 *  term resolver searches: the id itself, the display name, and every alias. */
export function lookupKeys(idty: CodexIdentity): string[] {
  const keys = [idty.id.toLowerCase(), idty.name.toLowerCase(), slugify(idty.name)];
  for (const a of idty.aliases ?? []) {
    keys.push(a.toLowerCase(), slugify(a));
  }
  return [...new Set(keys.filter(Boolean))];
}

/** Record a rename without breaking existing references: the id is untouched and
 *  the previous name becomes an alias. */
export function rename(idty: CodexIdentity, newName: string): CodexIdentity {
  const next = newName.trim();
  if (!next || next === idty.name) return idty;
  const aliases = [...new Set([...(idty.aliases ?? []), idty.name])].filter((a) => a !== next);
  return { ...idty, name: next, aliases };
}
