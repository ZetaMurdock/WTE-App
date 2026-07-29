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
  /** The permanent id of the concept this resolves to — what a migrated sheet
   *  should store. The concept's root, never the layer that happens to win here. */
  conceptId?: string;
  /** False when that id is malformed, contested, or disagrees with its record.
   *  Nothing is ever written to a sheet through an id in that state. */
  conceptIdValid?: boolean;
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
        conceptId: r.conceptId,
        conceptIdValid: r.conceptIdValid && r.entity.kind === "genus",
      });
      continue;
    }
    // Nothing resolved. Keep the stored text and say so, rather than dropping a
    // choice the player made.
    out.push({ stored, focus, displayName: stored, migrated: isCodexId(stored), unresolved: true });
  }
  return out;
}

export type KeptReason =
  | "already-an-id"
  | "unresolved"
  | "ambiguous"
  | "collision"
  | "registry-degraded"
  /** Resolved, but the id that would be written is malformed, contested, or
   *  describes something other than the record carrying it. */
  | "unsound-id";

export interface MigrationPlan {
  /** The rewritten focusSpend.genus map. */
  next: Record<string, number>;
  /** Names that became ids. */
  migrated: { from: string; to: string }[];
  /** Left exactly as they were, and why. */
  kept: { stored: string; reason: KeptReason }[];
  /** Two or more stored entries that resolve to ONE concept. Nothing is migrated
   *  for these; a person has to say which was meant, because merging them changes
   *  how much Focus the character has spent. */
  conflicts: { target: string; entries: { stored: string; focus: number }[] }[];
  changed: boolean;
  /** Set when the whole plan was refused because the Codex itself is not sound. */
  blocked?: "registry-degraded";
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
  const kept: { stored: string; reason: KeptReason }[] = [];
  const conflicts: MigrationPlan["conflicts"] = [];

  const refs = resolveGenusRefs(spend, registry, ctx);

  // A Codex with duplicate ids, a cycle, or records it could not index is not a
  // sound basis for rewriting anyone's character. Read from it — resolveGenusRefs
  // above still works — but do not write against it.
  if (registry.status() === "degraded") {
    for (const ref of refs) {
      next[ref.stored] = ref.focus;
      kept.push({ stored: ref.stored, reason: "registry-degraded" });
    }
    return { next, migrated, kept, conflicts, changed: false, blocked: "registry-degraded" };
  }

  // Work out where each entry WANTS to go before moving anything, so a collision
  // is visible while both sides are still intact.
  const targets = new Map<string, { stored: string; focus: number }[]>();
  const claim = (target: string, stored: string, focus: number) => {
    const list = targets.get(target);
    if (list) list.push({ stored, focus });
    else targets.set(target, [{ stored, focus }]);
  };
  for (const ref of refs) {
    // An entry that is ALREADY an id still occupies its key, so a legacy name
    // migrating onto that same key is a collision too — and one that would
    // otherwise overwrite an entry nothing was even trying to change.
    if (ref.migrated) {
      claim(ref.stored, ref.stored, ref.focus);
      continue;
    }
    if (ref.ambiguousWith || ref.unresolved || !ref.entity) continue;
    // The resolver's canonical concept id — the ROOT of the layer stack, not the
    // layer that won here. A sheet pinned to a campaign override would carry that
    // table's rules with it to another campaign entirely.
    //
    // And nothing is written through an id that is not sound: malformed,
    // contested by two records, describing a different kind, or reached through a
    // dangling override. Each of those would put a permanent reference on a
    // character that points at nothing dependable.
    if (!ref.conceptId || !ref.conceptIdValid) continue;
    claim(ref.conceptId, ref.stored, ref.focus);
  }

  // Two stored entries reaching one concept — a name and its own alias, most
  // often. This used to keep the larger Focus and drop the other, which quietly
  // changed how much the character had spent and destroyed the evidence of it.
  // It is a conflict for a person to settle, not a number to pick.
  const collided = new Set<string>();
  for (const [target, entries] of targets) {
    if (entries.length < 2) continue;
    conflicts.push({ target, entries });
    for (const en of entries) collided.add(en.stored);
  }

  for (const ref of refs) {
    if (collided.has(ref.stored)) {
      next[ref.stored] = ref.focus;
      kept.push({ stored: ref.stored, reason: "collision" });
      continue;
    }
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
    if (!ref.conceptId || !ref.conceptIdValid) {
      next[ref.stored] = ref.focus;
      kept.push({ stored: ref.stored, reason: "unsound-id" });
      continue;
    }
    next[ref.conceptId] = ref.focus;
    migrated.push({ from: ref.stored, to: ref.conceptId });
  }

  return { next, migrated, kept, conflicts, changed: migrated.length > 0 };
}
