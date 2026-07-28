// Reading a character's Genus choices during the dual-read period.
//
// Characters store genus in `focusSpend.genus`, keyed by ABILITY NAME. That is the
// fragility the Codex id exists to remove — rename the page and every character
// holding it dangles. But 27 characters already exist with names in them, so the
// migration cannot be a flag day.
//
// The rule for this period:
//   READ  — accept either a stable id or a legacy name, resolving both through the
//           registry, so a migrated and an un-migrated character behave identically.
//   WRITE — record stable ids on the next deliberate save, never as a side effect
//           of merely opening a sheet.
//   KEEP  — a name that resolves to nothing is PRESERVED verbatim. Dropping it
//           would destroy the only record of what the player picked, and the page
//           may simply not be pulled on this machine yet.
import type { CodexEntity } from "./codexEntity";
import type { CodexRegistry, ResolveContext } from "./codexRegistry";
import { isCodexId } from "./codexId";

/** One genus entry on a sheet, after resolution. */
export interface GenusRef {
  /** Exactly what the sheet stored — an id or a legacy name. */
  stored: string;
  /** Focus invested in it. */
  focus: number;
  /** The resolved concept, when the registry knows it. */
  entity?: CodexEntity;
  /** What to show the user: the CURRENT name when resolved, else what was stored. */
  displayName: string;
  /** True when `stored` is already a stable id. */
  migrated: boolean;
  /** True when nothing in the Codex answers to this. Kept, never dropped. */
  unresolved: boolean;
  /** Set when the term matched more than one concept — the UI must ask rather
   *  than pick, exactly as the resolver refuses to. */
  ambiguousWith?: CodexEntity[];
}

/**
 * Resolve every genus a character holds.
 *
 * `spend` is focusSpend.genus — a map of stored key to Focus points.
 */
export function resolveGenusRefs(
  spend: Record<string, number>,
  registry: CodexRegistry,
  ctx: ResolveContext
): GenusRef[] {
  const out: GenusRef[] = [];
  for (const [stored, focus] of Object.entries(spend ?? {})) {
    if (!stored) continue;
    const r = registry.resolveReference(stored, { ...ctx, kind: "genus" });
    if (r && r.ambiguous) {
      out.push({
        stored,
        focus,
        displayName: stored,
        migrated: isCodexId(stored),
        unresolved: false,
        ambiguousWith: r.candidates,
      });
      continue;
    }
    if (r) {
      out.push({
        stored,
        focus,
        entity: r.entity,
        // The whole point: a character storing an id shows the CURRENT name, so a
        // Curator's rename reaches every sheet without touching any of them.
        displayName: r.entity.name,
        migrated: isCodexId(stored),
        unresolved: false,
      });
      continue;
    }
    // Nothing resolved. Keep the stored text and say so, rather than dropping a
    // choice the player made.
    out.push({ stored, focus, displayName: stored, migrated: isCodexId(stored), unresolved: true });
  }
  return out;
}

export interface MigrationPlan {
  /** The rewritten focusSpend.genus map. */
  next: Record<string, number>;
  /** Names that became ids. */
  migrated: { from: string; to: string }[];
  /** Left exactly as they were, and why. */
  kept: { stored: string; reason: "already-an-id" | "unresolved" | "ambiguous" }[];
  changed: boolean;
}

/**
 * Rewrite a character's genus keys to stable ids.
 *
 * Deliberately conservative: only an UNAMBIGUOUSLY resolved legacy name is
 * rewritten. An unresolved name stays put (the page may not be pulled here yet),
 * and an ambiguous one stays put because choosing for the user is exactly what the
 * resolver refuses to do — rewriting it would silently bind the character to one
 * of two abilities.
 */
export function planGenusMigration(
  spend: Record<string, number>,
  registry: CodexRegistry,
  ctx: ResolveContext
): MigrationPlan {
  const next: Record<string, number> = {};
  const migrated: { from: string; to: string }[] = [];
  const kept: { stored: string; reason: "already-an-id" | "unresolved" | "ambiguous" }[] = [];

  for (const ref of resolveGenusRefs(spend, registry, ctx)) {
    if (ref.migrated) {
      next[ref.stored] = ref.focus;
      kept.push({ stored: ref.stored, reason: "already-an-id" });
      continue;
    }
    if (ref.ambiguousWith) {
      next[ref.stored] = ref.focus;
      kept.push({ stored: ref.stored, reason: "ambiguous" });
      continue;
    }
    if (ref.unresolved || !ref.entity) {
      next[ref.stored] = ref.focus;
      kept.push({ stored: ref.stored, reason: "unresolved" });
      continue;
    }
    // Migrate to the OFFICIAL concept id, not the campaign override's id — the
    // character holds a concept, and which layer wins is resolved per context. A
    // sheet pinned to a campaign override would carry that table's rules with it
    // to another campaign entirely.
    const target = ref.entity.scope === "wte" ? ref.entity.id : (ref.entity.overrides ?? ref.entity.id);
    // Two legacy names can collapse onto one id (a name and its alias); keep the
    // larger investment rather than letting one silently overwrite the other.
    next[target] = Math.max(next[target] ?? 0, ref.focus);
    migrated.push({ from: ref.stored, to: target });
  }

  return { next, migrated, kept, changed: migrated.length > 0 };
}
