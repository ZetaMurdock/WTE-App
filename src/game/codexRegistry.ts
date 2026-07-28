// The Codex registry: one index every part of the app asks "what is this term?"
//
// The promise it exists to keep — a character stores `wte.genus.vector-swing`, the
// Curator renames the page to "Vector Redirection", the character still works, and
// "Vector Swing" still finds it.
//
// Three rules shape the resolver, and each one is a decision NOT to be clever:
//
//  1. IT NEVER SILENTLY PICKS. Two equally valid matches produce an `ambiguous`
//     result listing both. Guessing is how a rename quietly rewires a character to
//     the wrong ability.
//  2. AN OVERRIDE NEVER DESTROYS WHAT IT REPLACES. A campaign definition wins, but
//     the official one is returned alongside it, so a card can show both and
//     answer "why is this different here?".
//  3. VISIBILITY IS FILTERED CENTRALLY. A player asking about a Curator-only
//     concept gets nothing — not a redacted stub, and not a leak from some caller
//     that forgot to check.
import { parseId, sameConcept, scopeRank, slugify } from "./codexId";
import { entityKeys, type CodexEntity, type CodexKind } from "./codexEntity";

export type MatchedBy = "id" | "name" | "slug" | "alias";

export interface ResolveContext {
  /** Who is asking. A player never resolves a Curator-only definition. */
  role: "player" | "curator";
  /** Stable campaign id — NOT the name. Campaign-scoped definitions from any other
   *  campaign are invisible. */
  campaignId?: string;
  /** Stable ids of content packs enabled for this table. */
  packIds?: string[];
  /** The character in play, for character-scoped exceptions. */
  characterId?: string;
  /** The live session, for temporary effects. */
  sessionId?: string;
  /** Narrow to one kind when the caller knows it (a sheet asking about genus). */
  kind?: CodexKind;
}

export interface Provenance {
  /** Where the winning definition came from. */
  scope: CodexEntity["scope"];
  /** Its owner's stable id, when scoped. */
  ownerId?: string;
  sourcePage: string;
  /** True when something other than the official W.T.E rule won. */
  overridden: boolean;
  /** The official id this replaces, when it replaces one. */
  overrides?: string;
}

export interface Resolution {
  ambiguous: false;
  /** The definition that wins for this context. Same object as resolvedDefinition. */
  entity: CodexEntity;
  resolvedDefinition: CodexEntity;
  /** The official W.T.E definition, kept even when overridden. */
  officialDefinition?: CodexEntity;
  matchedBy: MatchedBy;
  provenance: Provenance;
}

export interface Ambiguity {
  ambiguous: true;
  term: string;
  /** Every concept that matched equally well. The caller must ask. */
  candidates: CodexEntity[];
}

export type ResolveResult = Resolution | Ambiguity | null;

export interface RegistryProblem {
  kind: "duplicate-id" | "ambiguous-alias" | "dangling-override" | "malformed-id";
  detail: string;
  ids: string[];
}

/** Concept key — kind + slug. An official and its campaign override share one. */
function conceptKey(e: CodexEntity): string {
  const p = parseId(e.id);
  return p ? `${p.kind}:${p.slug}` : `${e.kind}:${slugify(e.name)}`;
}

export class CodexRegistry {
  private byId = new Map<string, CodexEntity>();
  private byKey = new Map<string, CodexEntity[]>();
  /** kind:slug -> every layer defining that concept. An official and its campaign
   *  override live here together even when their display names have diverged. */
  private byConcept = new Map<string, CodexEntity[]>();
  private problems: RegistryProblem[] = [];

  constructor(entities: CodexEntity[] = []) {
    this.addAll(entities);
  }

  addAll(entities: CodexEntity[]): void {
    for (const e of entities) this.add(e);
  }

  add(e: CodexEntity): void {
    if (!parseId(e.id)) {
      this.problems.push({ kind: "malformed-id", detail: `"${e.name}" has id "${e.id}"`, ids: [e.id] });
    }
    const prior = this.byId.get(e.id);
    if (prior && prior.sourcePage !== e.sourcePage) {
      // Two pages claiming one id is a real authoring error — every reference to
      // that id is now ambiguous, and picking one silently would be arbitrary.
      this.problems.push({
        kind: "duplicate-id",
        detail: `"${e.id}" is claimed by both "${prior.sourcePage}" and "${e.sourcePage}"`,
        ids: [e.id],
      });
    }
    this.byId.set(e.id, e);
    for (const k of entityKeys(e)) {
      const list = this.byKey.get(k);
      if (list) list.push(e);
      else this.byKey.set(k, [e]);
    }
    const ck = conceptKey(e);
    const cl = this.byConcept.get(ck);
    if (cl) cl.push(e);
    else this.byConcept.set(ck, [e]);
  }

  get(id: string): CodexEntity | undefined {
    return this.byId.get(id);
  }

  all(): CodexEntity[] {
    return [...this.byId.values()];
  }

  ofKind(kind: CodexKind): CodexEntity[] {
    return this.all().filter((e) => e.kind === kind);
  }

  /** Authoring problems worth surfacing in a Codex health panel. */
  health(): RegistryProblem[] {
    const out = [...this.problems];
    // A dangling override points at a definition that is not here.
    for (const e of this.all()) {
      if (e.overrides && !this.byId.has(e.overrides)) {
        out.push({
          kind: "dangling-override",
          detail: `"${e.name}" overrides "${e.overrides}", which is not in the Codex`,
          ids: [e.id, e.overrides],
        });
      }
    }
    // An alias that reaches two different CONCEPTS can never be resolved without
    // asking, so it is an authoring problem rather than a runtime surprise.
    for (const [key, list] of this.byKey) {
      const concepts = new Set(list.map(conceptKey));
      if (concepts.size > 1) {
        out.push({
          kind: "ambiguous-alias",
          detail: `"${key}" matches ${concepts.size} different concepts`,
          ids: list.map((e) => e.id),
        });
      }
    }
    return out;
  }

  /** Is this definition in play for the given context? */
  private inContext(e: CodexEntity, ctx: ResolveContext): boolean {
    if (ctx.role === "player" && e.visibility === "curator") return false;
    switch (e.scope) {
      case "wte":
        return true;
      case "pack":
        return !!e.ownerId && (ctx.packIds ?? []).includes(e.ownerId);
      case "campaign":
        return !!e.ownerId && e.ownerId === ctx.campaignId;
      case "character":
        return !!e.ownerId && e.ownerId === ctx.characterId;
      case "session":
        return !!e.ownerId && e.ownerId === ctx.sessionId;
      default:
        return false;
    }
  }

  /**
   * Resolve a term — an id, a current name, a slug, or a former name.
   *
   * Returns null when nothing matches, an Ambiguity when more than one distinct
   * concept matches, and otherwise the winning definition plus the official one it
   * replaced.
   */
  resolveTerm(term: string, ctx: ResolveContext): ResolveResult {
    const raw = String(term ?? "").trim();
    if (!raw) return null;

    const lower = raw.toLowerCase();
    const slug = slugify(raw);
    const pool = (this.byKey.get(lower) ?? []).concat(
      slug && slug !== lower ? (this.byKey.get(slug) ?? []) : []
    );
    const visible = [...new Set(pool)].filter(
      (e) => this.inContext(e, ctx) && (!ctx.kind || e.kind === ctx.kind)
    );
    if (visible.length === 0) return null;

    // Group by concept: an official and its campaign override are one answer, not
    // two candidates.
    const groups = new Map<string, CodexEntity[]>();
    for (const e of visible) {
      const k = conceptKey(e);
      const g = groups.get(k);
      if (g) g.push(e);
      else groups.set(k, [e]);
    }

    if (groups.size > 1) {
      // Genuinely different concepts share this term. Ask rather than guess.
      return {
        ambiguous: true,
        term: raw,
        candidates: [...groups.values()].map((g) => this.pick(g)),
      };
    }

    // Resolve against EVERY layer of the concept, not just the ones whose current
    // name happens to match the term. After a rename the official and its campaign
    // override have different names but are still one concept, and the override
    // must still win.
    const matched = [...groups.values()][0][0];
    const group = this.conceptLayers(matched, ctx);
    return this.resolveGroup(group, this.matchedBy(this.pick(group), lower, slug));
  }

  /** Every in-context layer defining the same concept as `e`. */
  private conceptLayers(e: CodexEntity, ctx: ResolveContext): CodexEntity[] {
    const all = this.byConcept.get(conceptKey(e)) ?? [e];
    const usable = all.filter((x) => this.inContext(x, ctx) && (!ctx.kind || x.kind === ctx.kind));
    return usable.length ? usable : [e];
  }

  private resolveGroup(group: CodexEntity[], matchedBy: MatchedBy): Resolution {
    const winner = this.pick(group);
    const official = group.find((e) => e.scope === "wte");
    return {
      ambiguous: false,
      entity: winner,
      resolvedDefinition: winner,
      officialDefinition: official,
      matchedBy,
      provenance: {
        scope: winner.scope,
        ownerId: winner.ownerId,
        sourcePage: winner.sourcePage,
        overridden: winner.scope !== "wte",
        overrides: winner.overrides ?? (winner.scope !== "wte" && official ? official.id : undefined),
      },
    };
  }

  /** Strongest scope wins; a tie keeps the first, which is registration order. */
  private pick(group: CodexEntity[]): CodexEntity {
    return group.reduce((best, e) => (scopeRank(e.scope) > scopeRank(best.scope) ? e : best), group[0]);
  }

  private matchedBy(e: CodexEntity, lower: string, slug: string): MatchedBy {
    if (e.id.toLowerCase() === lower) return "id";
    if (e.name.toLowerCase() === lower) return "name";
    if (e.aliases.some((a) => a.toLowerCase() === lower || slugify(a) === slug)) return "alias";
    return "slug";
  }

  /** Resolve a stored reference that may be a stable id OR a legacy name.
   *
   *  This is what makes the dual-read period safe: existing characters hold names,
   *  new ones hold ids, and both keep working while they migrate. */
  resolveReference(ref: string, ctx: ResolveContext): ResolveResult {
    const direct = this.byId.get(ref);
    if (direct) {
      // Resolve the whole CONCEPT, not this one record: a campaign override must
      // still win even though the character stored the official id. Note the
      // in-context check happens inside conceptLayers, so a stored id whose own
      // record is out of context can still resolve through a layer that is in it.
      const group = this.conceptLayers(direct, ctx);
      if (!group.some((e) => this.inContext(e, ctx))) return null;
      return this.resolveGroup(group, "id");
    }
    return this.resolveTerm(ref, ctx);
  }

  /** Every entity that would answer to this term, ignoring context — for search. */
  search(term: string, ctx: ResolveContext, limit = 20): CodexEntity[] {
    const q = term.trim().toLowerCase();
    if (!q) return [];
    const hits = this.all().filter(
      (e) =>
        this.inContext(e, ctx) &&
        (!ctx.kind || e.kind === ctx.kind) &&
        entityKeys(e).some((k) => k.includes(q))
    );
    // Exact matches first, then by scope strength, then alphabetically.
    return hits
      .sort((a, b) => {
        const ax = entityKeys(a).includes(q) ? 0 : 1;
        const bx = entityKeys(b).includes(q) ? 0 : 1;
        if (ax !== bx) return ax - bx;
        const s = scopeRank(b.scope) - scopeRank(a.scope);
        if (s !== 0) return s;
        return a.name.localeCompare(b.name);
      })
      .slice(0, limit);
  }
}

/** Convenience for the common case: does this concept have a campaign override? */
export function isOverridden(r: ResolveResult): boolean {
  return !!r && r.ambiguous === false && r.provenance.overridden;
}

export { sameConcept };
