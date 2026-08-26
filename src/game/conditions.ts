// Conditions as forkable Codex pages.
//
// A condition used to be an arbitrary string on a token: `Slowed` rendered as a
// coloured pip and meant whatever the table remembered it meant. The only list
// of conditions in the app was `CONDITION_WORDS` in vtt/data/outcomeLedger, and
// that list is a SCANNER — a closed alternation so prose matching does not tag
// every capitalised word. A scanner is the wrong place to keep the definition of
// what exists: a table writing its own setting has to be able to add "Blighted"
// without editing a regular expression.
//
// So a condition is a page. `Type: Condition` makes one, the page carries the
// rule text, and the field this whole arc was missing — Stacking — says what
// happens when the same condition lands twice. That is a RULE, not an engine
// opinion, and it belongs where a Curator can fork it.
//
// Same shape as game/rollFormula: a page-level parser that returns diagnostics
// instead of guessing, plus an atomically-replaced runtime registry the loader
// fills from official pages first and campaign pages last.
import { lookupKeys, parseId, scopeRank, slugify, type IdScope } from "./codexId";

/**
 * What a second application of the same condition does to the first.
 *
 * - `refresh` — one instance; the longer of the two durations wins.
 * - `extend`  — one instance; the durations add together.
 * - `stack`   — instances count separately (Blighted is written in stacks).
 * - `highest` — one instance; the stronger application wins and the weaker is
 *               discarded outright, duration included.
 */
export const CONDITION_STACKING = ["refresh", "extend", "stack", "highest"] as const;
export type ConditionStacking = (typeof CONDITION_STACKING)[number];

export interface CodexCondition {
  /** Permanent id. `wte.condition.<slug>` for shipped rules. */
  id: string;
  /** Authoritative layer supplied by the loader; page text cannot spoof it. */
  scope: IdScope;
  name: string;
  /** Former names, so a token tagged before a rename still resolves. */
  aliases: string[];
  /** What the condition does, in the page's own words. */
  effect: string;
  stacking: ConditionStacking;
  /** The official id this page replaces, when it says so. */
  overrides?: string;
}

export type ConditionPageResult =
  | { ok: true; condition: CodexCondition }
  | { ok: false; errors: string[] };

const MAX_ID_CHARS = 240;
const MAX_NAME_CHARS = 120;
const MAX_EFFECT_CHARS = 4_000;
const MAX_ALIASES = 16;

/** One `| Key | Value |`-style field, in the shapes the other page parsers
 *  accept (markdown row, `**Key:**`, or a plain `Key: value` line). */
function readField(md: string, key: string): string | undefined {
  const table = md.match(new RegExp(`^\\s*\\|\\s*${key}\\s*\\|\\s*([^|]*)\\|\\s*$`, "im"));
  if (table) return table[1].trim();
  const bold = md.match(new RegExp(`^\\s*(?:[-*]\\s*)?\\*\\*${key}\\*\\*:?\\s*(.+)$`, "im"));
  if (bold) return bold[1].trim();
  const plain = md.match(new RegExp(`^\\s*${key}\\s*:[ \\t]+(.+)$`, "im"));
  return plain?.[1].trim();
}

function titleOf(md: string, fallback: string): string {
  const heading = md.match(/^#{1,4}\s+(.+)$/m)?.[1];
  return (heading || fallback).replace(/[*_`]/g, "").trim() || fallback;
}

/** Metadata examples in comments or fenced code are documentation, not active
 *  mechanics — the same exclusion rollFormula applies before reading fields. */
function renderedMetadata(md: string): string {
  const uncommented = md.replace(/<!--[\s\S]*?-->/g, "");
  const visible: string[] = [];
  let fence: { marker: "`" | "~"; length: number } | null = null;
  for (const line of uncommented.split(/\r?\n/)) {
    const opening = line.match(/^\s*(`{3,}|~{3,})/);
    if (fence) {
      if (opening && opening[1][0] === fence.marker && opening[1].length >= fence.length) fence = null;
      continue;
    }
    if (opening) {
      fence = { marker: opening[1][0] as "`" | "~", length: opening[1].length };
      continue;
    }
    visible.push(line);
  }
  return visible.join("\n");
}

/** The body of a `## Heading` section, up to the next heading of any level.
 *  Walked line by line rather than matched with one expression, because a lazy
 *  body plus a multiline `$` terminator matches the empty string immediately. */
function sectionBody(md: string, heading: string): string | undefined {
  const label = new RegExp(`^#{2,4}\\s*${heading}\\s*$`, "i");
  const lines = md.split(/\r?\n/);
  const start = lines.findIndex((line) => label.test(line.trim()));
  if (start < 0) return undefined;
  const body: string[] = [];
  for (let i = start + 1; i < lines.length && !/^#{1,4}\s/.test(lines[i]); i++) {
    if (lines[i].trim()) body.push(lines[i].trim());
  }
  const text = body.join(" ").trim();
  return text || undefined;
}

/** Former names as a page lists them — the separators the other parsers accept. */
function splitAliases(raw: string | undefined): string[] {
  return [...new Set((raw ?? "").split(/[,;/]/).map((s) => s.trim()).filter(Boolean))].slice(0, MAX_ALIASES);
}

function normalizeStacking(raw: string): ConditionStacking | null {
  const value = raw.toLowerCase().trim();
  return CONDITION_STACKING.includes(value as ConditionStacking) ? (value as ConditionStacking) : null;
}

/**
 * Parse a page only when it declares `Type: Condition`. Invalid condition pages
 * return diagnostics; unrelated lore and mechanics return null.
 *
 * Nothing here is inferred. An absent or unrecognized Stacking value is an
 * error, not a default: guessing "refresh" would silently give every table the
 * same answer to the one question the page exists to answer.
 */
export function parseConditionPage(md: string, stem: string): ConditionPageResult | null {
  const metadata = renderedMetadata(md);
  const type = (readField(metadata, "Type") || "").toLowerCase().replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim();
  if (type !== "condition") return null;

  const errors: string[] = [];

  const name = (readField(metadata, "Name") || titleOf(metadata, stem)).slice(0, MAX_NAME_CHARS).trim();
  if (!name) errors.push("Name is required.");
  else if (!slugify(name)) errors.push(`Name ${JSON.stringify(name)} has no letters or digits to identify it by.`);

  // A condition's rule text is prose, so it may arrive either as an `## Effect`
  // section or as a one-line field. The section wins: a page that has both is
  // one where the row is a summary of the section beneath it.
  const effect = (sectionBody(metadata, "Effect") ?? readField(metadata, "Effect") ?? "").trim();
  if (!effect) errors.push("Effect is required — say what the condition does.");
  else if (effect.length > MAX_EFFECT_CHARS) errors.push(`Effect exceeds ${MAX_EFFECT_CHARS} characters.`);

  const stackingRaw = (readField(metadata, "Stacking") || "").trim();
  const stacking = stackingRaw ? normalizeStacking(stackingRaw) : null;
  if (!stackingRaw) {
    errors.push(`Stacking is required — one of ${CONDITION_STACKING.join(", ")}.`);
  } else if (!stacking) {
    errors.push(`Stacking ${JSON.stringify(stackingRaw)} is not allowed. Use ${CONDITION_STACKING.join(", ")}.`);
  }

  // A declared id is checked rather than trusted. `wte.genus.slowed` on a
  // condition page would resolve as a Genus ability everywhere else in the app,
  // and the page would look fine while nothing found it.
  const declaredId = (readField(metadata, "ID") || "").trim();
  if (declaredId) {
    const parsed = parseId(declaredId);
    if (!parsed) errors.push(`ID ${JSON.stringify(declaredId)} is not a well-formed Codex id.`);
    else if (parsed.kind !== "condition") errors.push(`ID ${JSON.stringify(declaredId)} is a ${parsed.kind} id, not a condition id.`);
    else if (declaredId.length > MAX_ID_CHARS) errors.push("ID exceeds the supported length.");
  }

  const overrides = (readField(metadata, "Overrides") || "").trim();
  if (overrides && overrides.toLowerCase() !== "none" && !parseId(overrides)) {
    errors.push(`Overrides ${JSON.stringify(overrides)} is not a well-formed Codex id.`);
  }

  if (errors.length || !stacking) return { ok: false, errors };
  const id = declaredId || `wte.condition.${slugify(name) || slugify(stem) || "condition"}`;
  return {
    ok: true,
    condition: {
      id,
      scope: parseId(id)?.scope ?? "wte",
      name,
      aliases: splitAliases(readField(metadata, "Aliases") ?? readField(metadata, "Alias")),
      effect,
      stacking,
      overrides: overrides && overrides.toLowerCase() !== "none" ? overrides : undefined,
    },
  };
}

interface RegisteredCondition {
  condition: CodexCondition;
  order: number;
}

let registry = new Map<string, RegisteredCondition>();

/** Replace the runtime registry atomically. Definitions later in the list win,
 *  so the loader can put campaign definitions after official ones. */
export function setCodexConditions(next: readonly CodexCondition[]): void {
  const replacement = new Map<string, RegisteredCondition>();
  next.forEach((condition, order) => {
    const entry = { condition, order };
    // Every string the condition can be found by — its id, its display name and
    // every former name. A token tagged "Stinous" before the page was renamed
    // has to keep resolving, which is the whole reason aliases exist.
    for (const key of lookupKeys({ id: condition.id, name: condition.name, aliases: condition.aliases })) {
      const held = replacement.get(key);
      // Scope first, registry order second: a campaign page beats the official
      // rule it shadows even when the loader hands them over in file order.
      if (held && scopeRank(held.condition.scope) > scopeRank(condition.scope)) continue;
      replacement.set(key, entry);
    }
  });
  registry = replacement;
}

/** The condition a tag names, or null when the table has never defined it.
 *
 *  Case-insensitive and alias-aware, like every other Codex lookup: a token
 *  carries free text, and "slowed", "Slowed" and `wte.condition.slowed` are the
 *  same rule. Null is a real answer — an undefined tag stays a plain pip that
 *  the Curator adjudicates, exactly as it does today. */
export function resolveCondition(nameOrId: string): CodexCondition | null {
  const raw = String(nameOrId ?? "").trim();
  if (!raw) return null;
  return (registry.get(raw.toLowerCase()) ?? registry.get(slugify(raw)))?.condition ?? null;
}

/** Whether a tag names a condition this table has defined. */
export function isKnownCondition(nameOrId: string): boolean {
  return resolveCondition(nameOrId) !== null;
}

/** Test/diagnostic seam: the active definitions, in registration order. One
 *  condition holds several lookup keys, so the listing is de-duplicated by id. */
export function activeCodexConditions(): CodexCondition[] {
  const seen = new Set<string>();
  const out: CodexCondition[] = [];
  for (const entry of [...registry.values()].sort((a, b) => a.order - b.order)) {
    if (seen.has(entry.condition.id)) continue;
    seen.add(entry.condition.id);
    out.push(entry.condition);
  }
  return out;
}
