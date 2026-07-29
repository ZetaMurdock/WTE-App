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
import { GENUS_DATA_BY_ID, type GenusAbility, type UsableAbility } from "./wte";

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
export function codexCtx(campaignId?: string | null, characterId?: string | null): ResolveContext {
  let role: "player" | "curator" = "player";
  try {
    if (localStorage.getItem("wte-curator") === "1") role = "curator";
  } catch {
    /* no storage: assume the more restrictive role */
  }
  return {
    role,
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
  };
}

function fromRef(ref: GenusRef): ResolvedGenus {
  const def = ref.entity;
  const base = officialMechanics(ref.conceptId) ?? officialMechanics(def?.id);
  return {
    storedRef: ref.stored,
    conceptId: ref.conceptIdValid ? ref.conceptId : undefined,
    displayName: ref.displayName,
    focus: ref.focus,
    mechanics: withOverride(base, def),
    definition: def,
    unresolved: ref.unresolved,
    ambiguousWith: ref.ambiguousWith,
    overridden: !!def && def.scope !== "wte",
    sourcePage: def?.sourcePage || undefined,
  };
}

/**
 * Resolve everything a character has invested Focus in.
 *
 * `spend` is focusSpend.genus — keys are stored references, values are Focus.
 */
export function resolveGenusSpend(spend: Record<string, number>, ctx: ResolveContext): ResolvedGenus[] {
  return resolveGenusRefs(spend ?? {}, codexRegistry(), { ...ctx, kind: "genus" }).map(fromRef);
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
  focus?: Record<string, number>
): ResolvedGenus[] {
  const spend: Record<string, number> = {};
  for (const ref of loadout) if (ref) spend[ref] = focus?.[ref] ?? 0;
  return resolveGenusSpend(spend, ctx);
}

/** The shape the actions rail and the VTT already consume. */
export function toUsable(r: ResolvedGenus): UsableAbility {
  const m = r.mechanics;
  return {
    source: "genus",
    // Always the display name. Consumers render this, and a raw id on a sheet is
    // not something anyone can read.
    name: r.displayName,
    ss: m?.ss ?? 0,
    effect: m?.effect ?? undefined,
    range: m?.range ?? undefined,
    target: m?.target ?? undefined,
    activation: m?.activation ?? undefined,
    focus: r.focus || undefined,
    domain: (m as { domain?: string } | undefined)?.domain ?? domainOf(r),
    classification: m?.classification ?? undefined,
    ssNote: m?.ssNote ?? undefined,
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
  focus?: Record<string, number>
): UsableAbility[] {
  return resolveGenusLoadout(loadout, ctx, focus).map(toUsable);
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
