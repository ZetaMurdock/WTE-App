// One resolved Genus entry, shared by every consumer.
//
// The sheet, the actions rail, the contest flow, the VTT and the exporter each
// used to look a Genus up their own way, all of them keyed by display NAME. That
// is four chances to disagree about what a character has, and it is why renaming
// an ability broke a sheet in one place and not another.
//
// This is the single answer to "what does this character actually have?", and it
// reads BOTH kinds of key, because during the dual-read period a character may
// hold either. Nothing in here writes: migration is a deliberate save, and a
// panel rendering a row must never be what rewrites someone's character.
import { resolveGenusRefs, type GenusRef } from "./genusRef";
import { codexRegistry, codexStatus } from "./codexService";
import type { CodexEntity } from "./codexEntity";
import type { ResolveContext } from "./codexRegistry";
import { layersFor, resolveRule, type RuleLayer } from "./ruleLayers";
import { canonicalDomain, domainOfGenus, getParadigm, GENUS_DATA_BY_ID, type GenusAbility, type UsableAbility } from "./wte";

export interface ResolvedGenus {
  /** Exactly what the character stores — a stable id or a legacy name. */
  storedRef: string;
  /** The concept it means, when that is known and sound. */
  conceptId?: string;
  /** What to show: the CURRENT name when resolved, else what was stored. */
  displayName: string;
  focus: number;
  /** Official mechanics, from the rules data — never from a page. */
  mechanics?: GenusAbility;
  /** The definition in force here, which may be a campaign override. */
  definition?: CodexEntity;
  /** Nothing in the Codex answers to this. Kept and shown, never dropped. */
  unresolved: boolean;
  /** The term means more than one thing; the UI must ask rather than pick. */
  ambiguousWith?: CodexEntity[];
  /** True when the resolved definition is not the official one. */
  overridden: boolean;
  /** The SS after numeric rule layers, when any apply. Kept SEPARATE from
   *  `mechanics` so the card and the actions rail both compute
   *  definition-then-layers and cannot double-apply each other's work. */
  layered?: { ss: number; base: number; trail: number };
  /** Where to read about it, when a page is known. */
  sourcePage?: string;
}

/**
 * The context a Genus lookup needs, built the same way everywhere.
 *
 * Role comes from the Curator toggle. Getting this wrong in one consumer and
 * right in another is how a hidden ability leaks: the sheet and the VTT have to
 * be asking the same question.
 */
export function codexCtx(
  campaignId?: string | null,
  characterId?: string | null,
  /** STATE the role when the caller knows it — a sheet, the VTT and a networked
   *  session all know who is looking. The stored toggle is only a fallback for
   *  callers that genuinely do not, and it is a per-machine preference rather
   *  than an authority on who this person is. */
  role?: "player" | "curator"
): ResolveContext {
  let resolved: "player" | "curator" = role ?? "player";
  if (!role) {
    try {
      if (localStorage.getItem("wte-curator") === "1") resolved = "curator";
    } catch {
      /* no storage: assume the more restrictive role */
    }
  }
  return {
    role: resolved,
    campaignId: campaignId ?? undefined,
    characterId: characterId ?? undefined,
    kind: "genus",
  };
}

/**
 * Which key to store a Genus under on THIS sheet.
 *
 * New investments are keyed by stable id, so a character created today survives a
 * rename without ever needing migrating. But an ability the sheet already holds
 * under its legacy NAME keeps that key: writing the id beside it would leave one
 * concept occupying two entries, which is exactly the collision the migration
 * planner refuses to resolve on its own — and it would double the Focus the
 * character appears to have spent.
 *
 * The id comes from genus.json, which is loaded synchronously and always
 * authoritative, so this does not wait on the Codex being ready.
 */
export function genusKeyFor(ability: { name: string; id?: string }, spend: Record<string, number>): string {
  const held = spend ?? {};
  if (Object.prototype.hasOwnProperty.call(held, ability.name)) return ability.name;
  return ability.id || ability.name;
}

/** Focus invested in an ability, whichever key this sheet happens to use. */
export function genusFocusFor(ability: { name: string; id?: string }, spend: Record<string, number>): number {
  const held = spend ?? {};
  return held[ability.name] || (ability.id ? held[ability.id] : 0) || 0;
}

/** Mechanics for a concept id, from the authoritative data file. */
function officialMechanics(conceptId: string | undefined): GenusAbility | undefined {
  return conceptId ? GENUS_DATA_BY_ID.get(conceptId) : undefined;
}

/** Numbers a campaign override actually changed, layered over the official ones. */
function withOverride(base: GenusAbility | undefined, def: CodexEntity | undefined): GenusAbility | undefined {
  if (!def || def.scope === "wte") return base;
  const d = (def.data ?? {}) as Partial<GenusAbility> & { ss?: number | null };
  if (!base) {
    return {
      name: def.name,
      id: def.id,
      ss: typeof d.ss === "number" ? d.ss : null,
      effect: d.effect ?? null,
      range: d.range ?? null,
      target: d.target ?? null,
      activation: d.activation ?? null,
      classification: d.classification ?? null,
      limit: d.limit ?? null,
      actions: d.actions ?? null,
    };
  }
  // Only fields the override actually SET replace the official value. A campaign
  // page that says nothing about Range must not blank the official range.
  const pick = <K extends keyof GenusAbility>(k: K): GenusAbility[K] =>
    d[k] === undefined || d[k] === null ? base[k] : (d[k] as GenusAbility[K]);
  return {
    ...base,
    ss: typeof d.ss === "number" ? d.ss : base.ss,
    effect: pick("effect"),
    range: pick("range"),
    target: pick("target"),
    activation: pick("activation"),
    limit: pick("limit"),
    classification: pick("classification"),
    actions: pick("actions"),
  };
}

function fromRef(ref: GenusRef, layers?: RuleLayer[], ctx?: ResolveContext): ResolvedGenus {
  const def = ref.entity;
  const base = officialMechanics(ref.conceptId) ?? officialMechanics(def?.id);
  const mechanics = withOverride(base, def);
  return {
    storedRef: ref.stored,
    conceptId: ref.conceptIdValid ? ref.conceptId : undefined,
    displayName: ref.displayName,
    focus: ref.focus,
    mechanics,
    layered: layeredSs(mechanics, ref.conceptId, layers, ctx),
    definition: def,
    unresolved: ref.unresolved,
    ambiguousWith: ref.ambiguousWith,
    overridden: !!def && def.scope !== "wte",
    sourcePage: def?.sourcePage || undefined,
  };
}

/**
 * Numeric rule layers, applied to the SS that play actually uses.
 *
 * The card could already explain "base 2, +3 Ashen Sun, = 5" while the actions
 * rail and the VTT charged 2, so the Codex and the table disagreed about the
 * cost of the same ability. The base here is the RESOLVED definition's value —
 * the campaign's rule when there is one — exactly as the card computes it, so
 * the two arrive at the same number by the same route.
 */
function layeredSs(
  mechanics: GenusAbility | undefined,
  conceptId: string | undefined,
  layers: RuleLayer[] | undefined,
  ctx: ResolveContext | undefined
): ResolvedGenus["layered"] {
  if (!mechanics || !conceptId || !layers?.length) return undefined;
  const applicable = layersFor(layers, conceptId, {
    campaignId: ctx?.campaignId,
    characterId: ctx?.characterId,
    sessionId: ctx?.sessionId,
    packIds: ctx?.packIds,
  });
  if (!applicable.length) return undefined;
  const base = typeof mechanics.ss === "number" ? mechanics.ss : 0;
  const r = resolveRule(base, applicable);
  if (r.value === base && !r.trail.length) return undefined;
  return { ss: r.value, base, trail: r.trail.length };
}

/**
 * Resolve everything a character has invested Focus in.
 *
 * `spend` is focusSpend.genus — keys are stored references, values are Focus.
 */
export function resolveGenusSpend(
  spend: Record<string, number>,
  ctx: ResolveContext,
  layers?: RuleLayer[]
): ResolvedGenus[] {
  const full = { ...ctx, kind: "genus" as const };
  return resolveGenusRefs(spend ?? {}, codexRegistry(), full).map((r) => fromRef(r, layers, full));
}

/**
 * Resolve a loadout — an ordered list of stored references with no Focus map.
 *
 * The legacy `genusLoadout` field holds display names, and must keep holding
 * them: it is read by the legacy sheet and by exports that predate stable ids.
 * Reading it through here is what lets it stay names while everything else moves.
 */
export function resolveGenusLoadout(
  loadout: string[],
  ctx: ResolveContext,
  focus?: Record<string, number>,
  layers?: RuleLayer[]
): ResolvedGenus[] {
  const spend: Record<string, number> = {};
  for (const ref of loadout) if (ref) spend[ref] = focus?.[ref] ?? 0;
  return resolveGenusSpend(spend, ctx, layers);
}

/** The shape the actions rail and the VTT already consume. */
export function toUsable(r: ResolvedGenus): UsableAbility {
  const m = r.mechanics;
  return {
    source: "genus",
    // The CONCEPT, not the definition in force: a campaign override and the
    // official rule it replaces are the same ability, and an outcome filed
    // against one must still be found when the table drops the override.
    id: r.conceptId ?? m?.id,
    // Always the display name. Consumers render this, and a raw id on a sheet is
    // not something anyone can read.
    name: r.displayName,
    ss: r.layered ? r.layered.ss : (m?.ss ?? 0),
    effect: m?.effect ?? undefined,
    range: m?.range ?? undefined,
    target: m?.target ?? undefined,
    activation: m?.activation ?? undefined,
    focus: r.focus || undefined,
    domain: (m as { domain?: string } | undefined)?.domain ?? domainOf(r),
    classification: m?.classification ?? undefined,
    ssNote: m?.ssNote ?? undefined,
    actions: m?.actions ?? undefined,
    limit: m?.limit ?? undefined,
  };
}

/**
 * Drop-in replacement for usableGenus, resolved through the Codex.
 *
 * Same shape, same order, one difference that matters: `loadout` entries may be
 * display names OR stable ids, and a campaign override reaches the row. The old
 * version matched names against the paradigm's domains and fell back to a bare
 * 0-SS row when a name did not match — which is what a migrated character got
 * for every single ability.
 */
export function usableGenusResolved(
  loadout: string[],
  ctx: ResolveContext,
  focus?: Record<string, number>,
  layers?: RuleLayer[]
): UsableAbility[] {
  return resolveGenusLoadout(loadout, ctx, focus, layers).map(toUsable);
}

export interface GenusOption {
  /** The key a new investment is stored under. */
  id: string;
  name: string;
  ss: number | null;
  effect?: string | null;
  /** True when this campaign has changed the official rule. */
  overridden: boolean;
  /** True when the Codex knows this only as a campaign's own creation. */
  homebrew: boolean;
}

/**
 * The abilities a character may invest in, DERIVED FROM THE REGISTRY.
 *
 * genusForParadigm is the legacy picker, and it was a second mechanics authority
 * sitting beside the resolver: it read a global `pageGenus` overlay that knew
 * nothing about campaign ownership, nothing about visibility, and nothing about
 * stable identity. So a player could be offered a Curator-only ability, another
 * table's house rule could appear in this one, and everything it offered was
 * keyed by name.
 *
 * Everything here comes through the same resolution the sheet and the VTT use,
 * so there is one answer to "what does this ability cost" rather than two that
 * can drift apart.
 */
export function genusCatalogFor(
  paradigmId: string | undefined,
  ctx: ResolveContext,
  layers?: RuleLayer[]
): { domain: string; abilities: GenusOption[] }[] {
  const domains = getParadigm(paradigmId)?.domains ?? [];
  if (!domains.length) return [];
  const full = { ...ctx, kind: "genus" as const };
  const reg = codexRegistry();

  // Concepts, not records: an official rule and the campaign override on top of
  // it are ONE entry in the picker, resolved to whichever is in force.
  const seen = new Set<string>();
  const byDomain = new Map<string, GenusOption[]>();

  for (const e of reg.ofKind("genus")) {
    const r = reg.resolveReference(e.id, full);
    // Filtered by the resolver, so visibility and campaign ownership are honoured
    // here for free. An ambiguity is deliberately not offered — investing Focus
    // in something the Codex cannot identify is how a sheet ends up unresolvable.
    if (!r || r.ambiguous) continue;
    if (seen.has(r.conceptId)) continue;
    seen.add(r.conceptId);

    const resolved = fromRef(
      {
        stored: r.conceptId,
        focus: 0,
        entity: r.resolvedDefinition,
        displayName: r.resolvedDefinition.name,
        migrated: true,
        unresolved: false,
        conceptId: r.conceptId,
        conceptIdValid: r.conceptIdValid,
      },
      layers,
      full
    );

    // The domain lives on the DEFINITION data, not on GenusAbility.
    const domain = canonicalDomain(domainOf(resolved) ?? domainOfConcept(r.conceptId));
    if (!domain || !domains.some((d) => canonicalDomain(d) === domain)) continue;

    const list = byDomain.get(domain) ?? [];
    list.push({
      id: r.conceptIdValid ? r.conceptId : r.resolvedDefinition.id,
      name: resolved.displayName,
      ss: resolved.layered ? resolved.layered.ss : (resolved.mechanics?.ss ?? null),
      effect: resolved.mechanics?.effect,
      overridden: resolved.overridden,
      homebrew: !GENUS_DATA_BY_ID.has(r.conceptId),
    });
    byDomain.set(domain, list);
  }

  // Codex order for domains, alphabetical within one — the legacy picker's order
  // came from JSON key order plus whatever the page overlay appended.
  return domains
    .map((d) => canonicalDomain(d))
    .filter((d): d is string => !!d)
    .map((domain) => ({ domain, abilities: (byDomain.get(domain) ?? []).sort((a, b) => a.name.localeCompare(b.name)) }))
    .filter((g) => g.abilities.length > 0);
}

/** An official ability's domain, via the data file. */
function domainOfConcept(conceptId: string): string | undefined {
  const a = GENUS_DATA_BY_ID.get(conceptId);
  return a ? domainOfGenus(a.id ?? a.name) : undefined;
}

function domainOf(r: ResolvedGenus): string | undefined {
  const d = (r.definition?.data ?? {}) as { domain?: string };
  return d.domain;
}

/**
 * Is the Codex in a state where these answers can be trusted for RULES?
 *
 * Reading is always allowed — the official mechanics are live from the moment the
 * app starts — but a caller about to show "this is what your ability does" may
 * want to say that a campaign override might still be loading.
 */
export function genusAnswersSettled(): boolean {
  return codexStatus() === "ready";
}
