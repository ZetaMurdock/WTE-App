// The Codex registry: one index every part of the app asks "what is this term?"
//
// The promise it exists to keep — a character stores `wte.genus.vector-swing`, the
// Curator renames the page to "Vector Redirection", the character still works, and
// "Vector Swing" still finds it.
//
// Four rules shape the resolver, and each one is a decision NOT to be clever:
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
//  4. A BROKEN RECORD IS REPORTED, NEVER DELETED. A typo in an ID row must not
//     make a page vanish; it stays findable by name and shows up in health.
//
// HOW TWO RECORDS BECOME ONE CONCEPT
//
// Originally this was decided purely by kind+slug, and the `overrides` field a page
// could declare was stored and never read. That had two consequences. An override
// whose page carried a different title — "Ashen Sun Vector Swing" overriding
// "Vector Swing" — produced a different slug and therefore silently did nothing,
// which is the worst possible outcome for a rules override. And an unrelated
// campaign page that merely happened to share a title with an official one took it
// over without anyone saying so.
//
// Now:
//   overrides: <id>   is authoritative. The declaring record joins that concept
//                     however its own title reads.
//   overrides: none   is an explicit opt-out. It defines something of its own and
//                     will never absorb, or be absorbed by, a same-named concept.
//   (absent)          falls back to kind+slug, which is what makes the documented
//                     scope stack work for pages that simply share a title — and
//                     any cross-scope join made this way is reported as
//                     `undeclared-override`, so it is a decision the Curator can
//                     see rather than one the resolver made quietly.
import { parseId, sameConcept, scopeRank, slugify } from "./codexId";
import { entityKeys, type CodexEntity, type CodexKind } from "./codexEntity";

export type MatchedBy = "id" | "name" | "slug" | "alias";

/** The literal a page writes to say "this stands alone". */
export const STANDALONE = "none";

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
  /** True when the winning layer never declared that it overrides anything, and
   *  was joined to the concept by title alone. The mechanics are unaffected; it is
   *  reported so a surprising override can be traced to its cause. */
  byTitleOnly?: boolean;
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
  /**
   * The concept this resolves to, as one permanent id — the thing a character
   * should store. It is the root of the layer stack, NOT whichever layer happened
   * to win here, so a sheet never gets pinned to one table's override.
   */
  conceptId: string;
  /** False when that id is not well-formed, or does not agree with the record
   *  carrying it. Nothing may be migrated through a concept id that is not sound. */
  conceptIdValid: boolean;
}

export interface Ambiguity {
  ambiguous: true;
  term: string;
  /** Every concept that matched equally well. The caller must ask. */
  candidates: CodexEntity[];
  /** Set when the candidates all claim the SAME id. That is not a term collision
   *  but an authoring fault, and it needs different wording in the UI. */
  conflictingId?: string;
}

export type ResolveResult = Resolution | Ambiguity | null;

export type ProblemKind =
  | "duplicate-id"
  | "ambiguous-alias"
  | "dangling-override"
  | "malformed-id"
  | "identity-mismatch"
  | "override-cycle"
  | "undeclared-override"
  | "unusable-record"
  /** A mirror Codex page whose mechanics disagree with the authoritative data
   *  file. The official values stay in use; the disagreement is for a person. */
  | "page-drift";

export interface RegistryProblem {
  kind: ProblemKind;
  detail: string;
  ids: string[];
  /** "error" means something cannot be resolved correctly and the app should say
   *  so before acting on it. "warning" is worth showing but resolution is sound. */
  severity: "error" | "warning";
}

const ERRORS: ReadonlySet<ProblemKind> = new Set(["duplicate-id", "override-cycle", "unusable-record"]);

/** What a consumer needs to know before trusting an answer. `loading` and `failed`
 *  belong to whatever owns the registry; the registry itself is only ever one of
 *  the other two. */
export type RegistryStatus = "loading" | "ready" | "degraded" | "failed";

/** kind + slug of an id, or of a name when the id is unusable. */
function titleKey(e: CodexEntity): string {
  const p = parseId(e.id);
  return p ? `${p.kind}:${p.slug}` : `${e.kind}:${slugify(e.name)}`;
}

/** A record with neither a usable id nor a usable name cannot be found by anything,
 *  so indexing it would only hide it. These are listed in health instead. */
function isUnusable(e: CodexEntity): boolean {
  return !parseId(e.id) && !slugify(e.name ?? "");
}

/**
 * Does a well-formed id actually describe the record carrying it?
 *
 * A `wte.`-prefixed id on a campaign page, or a `genus.` id on a cipher, resolves
 * perfectly and means the wrong thing — the record files itself under a layer or a
 * kind it does not belong to, and takes over whatever legitimately lives there.
 * Returns the disagreement in words, or null.
 */
function identityDisagreement(
  e: CodexEntity,
  idKind: string,
  idScope: string,
  idOwner: string | undefined
): string | null {
  if (idKind !== e.kind) return `it is a ${e.kind}, not a ${idKind}`;
  if (idScope !== e.scope) return `it is ${e.scope}-scoped, not ${idScope}-scoped`;
  if (e.scope !== "wte") {
    const owner = slugify(e.ownerId ?? "");
    if (!owner) return `a ${e.scope}-scoped record must name its owner`;
    if (owner !== idOwner) return `it belongs to "${e.ownerId}", not "${idOwner}"`;
  }
  return null;
}

export class CodexRegistry {
  /** The authoritative list. Every index below is derived from it, and rebuilt
   *  wholesale — an index that is updated in place drifts out of agreement with
   *  the entities it describes, and nothing tells you when it has. */
  private entities: CodexEntity[] = [];

  private byId = new Map<string, CodexEntity>();
  private byKey = new Map<string, CodexEntity[]>();
  /** concept key -> every layer defining that concept. An official and its campaign
   *  override live here together even when their display names have diverged. */
  private byConcept = new Map<string, CodexEntity[]>();
  /** entity id -> its concept key, resolved through declared overrides. */
  private conceptOf = new Map<CodexEntity, string>();
  /** Ids claimed by more than one record. Resolving one is a question, not an answer. */
  private conflicted = new Map<string, CodexEntity[]>();
  private quarantine: CodexEntity[] = [];
  private problems: RegistryProblem[] = [];

  constructor(entities: CodexEntity[] = []) {
    this.addAll(entities);
  }

  addAll(entities: CodexEntity[]): void {
    if (!entities.length) {
      if (!this.entities.length) this.rebuild();
      return;
    }
    this.entities = this.entities.concat(entities);
    this.rebuild();
  }

  add(e: CodexEntity): void {
    this.addAll([e]);
  }

  /** Replace the contents outright. The indexes only ever swap in complete. */
  replaceAll(entities: CodexEntity[]): void {
    this.entities = [...entities];
    this.rebuild();
  }

  // ---- index construction ---------------------------------------------------

  /**
   * Rebuild every index from `entities`, in one pass, atomically.
   *
   * Atomic in the sense that matters here: the new maps are built into locals and
   * only assigned once all of them are complete, so a throw part-way leaves the
   * previous, consistent set in place rather than a half-populated one that would
   * answer questions wrongly instead of failing.
   */
  private rebuild(): void {
    const problems: RegistryProblem[] = [];
    const quarantine: CodexEntity[] = [];
    const usable: CodexEntity[] = [];

    for (const e of this.entities) {
      if (isUnusable(e)) {
        quarantine.push(e);
        problems.push({
          kind: "unusable-record",
          detail: `a record from "${e.sourcePage}" has neither a usable id nor a usable name`,
          ids: [e.id],
          severity: "error",
        });
        continue;
      }
      const parsed = parseId(e.id);
      if (!parsed) {
        // Reported, but kept resolvable by name. A typo in an ID row must never be
        // the reason a page disappears.
        problems.push({
          kind: "malformed-id",
          detail: `"${e.name}" has id "${e.id}", which is not a well-formed Codex id`,
          ids: [e.id],
          severity: "warning",
        });
      } else {
        // A well-formed id can still disagree with the record carrying it. Left as
        // written — every existing reference uses it — but never left unsaid.
        const wrong = identityDisagreement(e, parsed.kind, parsed.scope, parsed.owner);
        if (wrong) {
          problems.push({
            kind: "identity-mismatch",
            detail: `"${e.name}" has id "${e.id}", but ${wrong}`,
            ids: [e.id],
            severity: "warning",
          });
        }
      }
      usable.push(e);
    }

    // ---- id index, and the ids more than one record claims
    const byId = new Map<string, CodexEntity>();
    const claims = new Map<string, CodexEntity[]>();
    for (const e of usable) {
      const list = claims.get(e.id);
      if (list) list.push(e);
      else claims.set(e.id, [e]);
      if (!byId.has(e.id)) byId.set(e.id, e); // first wins, deterministically
    }
    const conflicted = new Map<string, CodexEntity[]>();
    for (const [id, list] of claims) {
      const pages = new Set(list.map((e) => e.sourcePage));
      if (list.length > 1 && pages.size > 1) {
        conflicted.set(id, list);
        problems.push({
          kind: "duplicate-id",
          detail: `"${id}" is claimed by ${[...pages].map((p) => `"${p}"`).join(" and ")}`,
          ids: [id],
          severity: "error",
        });
      }
    }

    // ---- concept keys, following declared overrides to their root
    const conceptOf = new Map<CodexEntity, string>();
    for (const e of usable) {
      conceptOf.set(e, this.conceptKeyFor(e, byId, problems));
    }

    const byKey = new Map<string, CodexEntity[]>();
    const byConcept = new Map<string, CodexEntity[]>();
    for (const e of usable) {
      for (const k of entityKeys(e)) {
        const list = byKey.get(k);
        if (list) list.push(e);
        else byKey.set(k, [e]);
      }
      const ck = conceptOf.get(e)!;
      const cl = byConcept.get(ck);
      if (cl) cl.push(e);
      else byConcept.set(ck, [e]);
    }

    // ---- joins nobody declared
    // A scoped record that took over an official concept purely because the titles
    // matched. Resolution is unchanged — this is the documented fallback — but it
    // is the one way an override can happen without anyone writing it down, so it
    // is said out loud.
    for (const [, group] of byConcept) {
      if (group.length < 2) continue;
      const official = group.find((e) => e.scope === "wte");
      if (!official) continue;
      for (const e of group) {
        if (e === official || e.scope === "wte") continue;
        if (e.overrides) continue; // declared: nothing to warn about
        problems.push({
          kind: "undeclared-override",
          detail: `"${e.name}" (${e.scope}) replaces the official "${official.name}" because their titles match, not because it says so`,
          ids: [e.id, official.id],
          severity: "warning",
        });
      }
    }

    // ---- dangling overrides
    for (const e of usable) {
      if (!e.overrides || e.overrides === STANDALONE) continue;
      if (!byId.has(e.overrides)) {
        problems.push({
          kind: "dangling-override",
          detail: `"${e.name}" overrides "${e.overrides}", which is not in the Codex`,
          ids: [e.id, e.overrides],
          severity: "warning",
        });
      }
    }

    // ---- an alias reaching two different concepts can never resolve without asking
    for (const [key, list] of byKey) {
      const concepts = new Set(list.map((e) => conceptOf.get(e)!));
      if (concepts.size > 1) {
        problems.push({
          kind: "ambiguous-alias",
          detail: `"${key}" matches ${concepts.size} different concepts`,
          ids: list.map((e) => e.id),
          severity: "warning",
        });
      }
    }

    // Swap in complete.
    this.byId = byId;
    this.byKey = byKey;
    this.byConcept = byConcept;
    this.conceptOf = conceptOf;
    this.conflicted = conflicted;
    this.quarantine = quarantine;
    this.problems = problems;
  }

  /** Follow `overrides` to the concept root. Cycles are broken and reported. */
  private conceptKeyFor(
    e: CodexEntity,
    byId: Map<string, CodexEntity>,
    problems: RegistryProblem[]
  ): string {
    // The key a record would have if nothing pointed at it. Computed for the ROOT
    // of the chain, not just for `e` — a layer that declares it overrides a
    // standalone concept joins that concept, and reading the root's title key
    // instead would file it somewhere else entirely.
    const ownKey = (r: CodexEntity) => (r.overrides === STANDALONE ? `standalone:${r.id}` : titleKey(r));
    if (e.overrides === STANDALONE) return ownKey(e);
    let cur = e;
    const seen = new Set<string>([e.id]);
    for (let hops = 0; hops < 16; hops++) {
      const target = cur.overrides;
      if (!target || target === STANDALONE) break;
      if (seen.has(target)) {
        problems.push({
          kind: "override-cycle",
          detail: `"${e.name}" is part of an overrides cycle through "${target}"`,
          ids: [...seen],
          severity: "error",
        });
        break;
      }
      const next = byId.get(target);
      // Dangling: reported separately. Root on the last record we could reach, so
      // the layer still defines something rather than evaporating.
      if (!next) break;
      seen.add(target);
      cur = next;
    }
    return ownKey(cur);
  }

  private keyOf(e: CodexEntity): string {
    return this.conceptOf.get(e) ?? titleKey(e);
  }

  // ---- reading --------------------------------------------------------------

  get(id: string): CodexEntity | undefined {
    return this.byId.get(id);
  }

  all(): CodexEntity[] {
    return [...this.byId.values()];
  }

  ofKind(kind: CodexKind): CodexEntity[] {
    return this.all().filter((e) => e.kind === kind);
  }

  /** Records that could not be indexed at all. Never silently dropped. */
  quarantined(): CodexEntity[] {
    return [...this.quarantine];
  }

  /** Authoring problems worth surfacing in a Codex health panel. */
  health(): RegistryProblem[] {
    return [...this.problems];
  }

  /** Ready, or working but with something that makes an answer untrustworthy. */
  status(): Extract<RegistryStatus, "ready" | "degraded"> {
    return this.problems.some((p) => ERRORS.has(p.kind)) ? "degraded" : "ready";
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
      const k = this.keyOf(e);
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
    const clash = this.conflictWithin(group, raw, ctx) ?? this.sameScopeConflict(group, raw);
    if (clash) return clash;
    return this.resolveGroup(group, this.matchedBy(this.pick(group), lower, slug));
  }

  /** Every in-context layer defining the same concept as `e`. */
  private conceptLayers(e: CodexEntity, ctx: ResolveContext): CodexEntity[] {
    const all = this.byConcept.get(this.keyOf(e)) ?? [e];
    const usable = all.filter((x) => this.inContext(x, ctx) && (!ctx.kind || x.kind === ctx.kind));
    return usable.length ? usable : [e];
  }

  /**
   * Two records claiming one id inside the answer make the answer a question.
   *
   * Context-filtered like everything else. An ambiguity listing candidates the
   * asker may not see would leak a Curator-only page's existence through the one
   * path that does not return a definition — and "there is a second Warden's
   * Gambit you cannot read" is exactly the leak the visibility rule exists to
   * prevent. If only one rival is visible there is no ambiguity for this asker.
   */
  private conflictWithin(group: CodexEntity[], term: string, ctx: ResolveContext): Ambiguity | null {
    if (!this.conflicted.size) return null;
    for (const e of group) {
      const rivals = this.visibleRivals(e.id, ctx);
      if (rivals.length > 1) return { ambiguous: true, term, candidates: rivals, conflictingId: e.id };
    }
    return null;
  }

  /** The records claiming `id` that this context is allowed to know about. */
  private visibleRivals(id: string, ctx: ResolveContext): CodexEntity[] {
    const rivals = this.conflicted.get(id);
    if (!rivals) return [];
    return rivals.filter((e) => this.inContext(e, ctx) && (!ctx.kind || e.kind === ctx.kind));
  }

  /**
   * Two definitions at the SAME strength inside one concept.
   *
   * `pick` breaks a tie by keeping the first, which is registration order — the
   * order pages happened to load in. Two campaign pages both overriding the same
   * official rule would therefore silently take turns winning between launches.
   * Distinct records of equal standing is a question for the Curator.
   */
  private sameScopeConflict(group: CodexEntity[], term: string): Ambiguity | null {
    if (group.length < 2) return null;
    const top = Math.max(...group.map((e) => scopeRank(e.scope)));
    const rivals = group.filter((e) => scopeRank(e.scope) === top);
    // Distinct IDS, not distinct objects: the same record loaded twice is one
    // definition, and calling that a conflict would break every reload.
    const ids = new Set(rivals.map((e) => e.id));
    if (ids.size < 2) return null;
    const first = new Map<string, CodexEntity>();
    for (const e of rivals) if (!first.has(e.id)) first.set(e.id, e);
    return { ambiguous: true, term, candidates: [...first.values()] };
  }

  /**
   * The permanent id of the CONCEPT, as distinct from the layer that won.
   *
   * The weakest layer present is the root — the official rule when there is one,
   * otherwise whatever the stack is built on. A character stores this, so it keeps
   * meaning the same thing in a campaign whose overrides differ or are absent.
   */
  private canonicalId(group: CodexEntity[]): string {
    const official = group.find((e) => e.scope === "wte");
    if (official) return official.id;
    const root = group.reduce((best, e) => (scopeRank(e.scope) < scopeRank(best.scope) ? e : best), group[0]);
    // A declared override naming something outside this context still names the
    // concept; prefer it over the local record's own id.
    if (root.overrides && root.overrides !== STANDALONE && parseId(root.overrides)) return root.overrides;
    return root.id;
  }

  private resolveGroup(group: CodexEntity[], matchedBy: MatchedBy): Resolution {
    const winner = this.pick(group);
    const official = group.find((e) => e.scope === "wte");
    const overridden = winner.scope !== "wte";
    const conceptId = this.canonicalId(group);
    const owner = this.byId.get(conceptId);
    return {
      conceptId,
      // Everything that has to hold before this id may be WRITTEN onto a
      // character. Well-formedness alone was not enough: a declared override
      // naming a Genus that is not installed, or naming a Cipher, produced a
      // perfectly well-formed id that pointed at nothing usable.
      conceptIdValid:
        !!parseId(conceptId) &&
        // The target must EXIST. A dangling override is not a destination.
        !!owner &&
        // and be the same kind of thing as what we resolved,
        owner.kind === winner.kind &&
        parseId(conceptId)!.kind === winner.kind &&
        // and belong to the concept we actually resolved, not merely parse,
        this.keyOf(owner) === this.keyOf(winner) &&
        // and not be contested or misdescribed by the record carrying it.
        !this.conflicted.has(conceptId) &&
        !this.problems.some((p) => p.kind === "identity-mismatch" && p.ids.includes(conceptId)),
      ambiguous: false,
      entity: winner,
      resolvedDefinition: winner,
      officialDefinition: official,
      matchedBy,
      provenance: {
        scope: winner.scope,
        ownerId: winner.ownerId,
        sourcePage: winner.sourcePage,
        overridden,
        overrides:
          winner.overrides && winner.overrides !== STANDALONE
            ? winner.overrides
            : overridden && official
              ? official.id
              : undefined,
        byTitleOnly: overridden && !!official && !winner.overrides ? true : undefined,
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
    const rivals = this.visibleRivals(ref, ctx);
    if (rivals.length > 1) {
      // The stored id is real but two records claim it. Answering with either one
      // binds the character to a coin toss.
      return { ambiguous: true, term: ref, candidates: rivals, conflictingId: ref };
    }
    // Exactly one of the rivals is in context: that one IS the answer here, and
    // byId may hold the other, so resolve through the visible record.
    const direct = rivals.length === 1 ? rivals[0] : this.byId.get(ref);
    if (direct) {
      // Resolve the whole CONCEPT, not this one record: a campaign override must
      // still win even though the character stored the official id. Note the
      // in-context check happens inside conceptLayers, so a stored id whose own
      // record is out of context can still resolve through a layer that is in it.
      const group = this.conceptLayers(direct, ctx);
      if (!group.some((e) => this.inContext(e, ctx))) return null;
      const clash = this.conflictWithin(group, ref, ctx) ?? this.sameScopeConflict(group, ref);
      if (clash) return clash;
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
