// A Codex concept as the rest of the app should see it.
//
// This is the layer that turns an authored page into something with a PERMANENT
// identity. The distinction that makes the whole Codex architecture work:
//
//   id          never changes, even when the page is renamed
//   name        is editable — it is a label, not a key
//   aliases     keep every previous name resolvable
//   sourcePage  is where "open the full page" goes
//   data        is the typed mechanics (domain, SS, activation, range, …)
//   overrides   names the official definition this one replaces
//
// Today characters store genus by NAME, so renaming "Vector Swing" to "Vector
// Redirection" silently breaks every character holding it. An id fixes that, but
// only if the id is assigned ONCE and persisted — deriving it from the current
// title on every load would break references exactly the same way.
import { makeId, parseId, slugify, type IdKind, type IdScope } from "./codexId";

export type CodexKind = IdKind;

export interface CodexEntity {
  /** Permanent. Assigned once and written back to the page. */
  id: string;
  kind: CodexKind;
  /** Editable display name. */
  name: string;
  /** Former names, so old references still resolve. */
  aliases: string[];
  /** The Codex page stem this came from — where "open full page" navigates. */
  sourcePage: string;
  scope: IdScope;
  /** For scoped entities: the campaign/pack/character STABLE ID that owns it.
   *  Never the display name — campaign names change. */
  ownerId?: string;
  visibility: "player" | "curator";
  summary?: string;
  /** The official id this definition replaces, when it is an override. */
  overrides?: string;
  /** Typed mechanics. Shape depends on `kind`. */
  data: unknown;
}

/** The mechanics a Genus ability carries. The first kind wired end to end. */
export interface GenusData {
  domain?: string;
  ss?: number;
  activation?: string;
  range?: string;
  target?: string;
  effect?: string;
  limit?: string;
  keywords?: string[];
}

/** Fields a page can declare to control its own identity. */
export interface IdentityFields {
  id?: string;
  aliases?: string;
  overrides?: string;
  visibility?: string;
}

const splitList = (v: string | undefined): string[] =>
  (v ?? "")
    .split(/[,;/]/)
    .map((s) => s.trim())
    .filter(Boolean);

/**
 * Work out an entity's identity from its page.
 *
 * Returns `assigned: true` when the page carried no `| ID |` row and one had to be
 * derived. The caller is expected to WRITE IT BACK — an id that is re-derived from
 * the title on every load is not stable, and the whole point is surviving a rename.
 */
export function resolveIdentity(
  kind: CodexKind,
  title: string,
  fields: IdentityFields,
  opts?: { scope?: IdScope; ownerId?: string }
): { id: string; assigned: boolean; malformed?: string; mismatch?: string } {
  const declared = (fields.id ?? "").trim();
  if (declared) {
    const parsed = parseId(declared);
    if (parsed) {
      // Well-formed is not the same as correct. An id whose kind, scope or owner
      // disagrees with the page is left exactly as written — references already use
      // it — but the disagreement is handed back so the Curator can be told.
      const wantScope = opts?.scope ?? "wte";
      let mismatch: string | undefined;
      if (parsed.kind !== kind) mismatch = `"${declared}" says ${parsed.kind}, but this page is a ${kind}`;
      else if (parsed.scope !== wantScope)
        mismatch = `"${declared}" is ${parsed.scope}-scoped, but this page is ${wantScope}-scoped`;
      else if (wantScope !== "wte" && parsed.owner !== slugify(opts?.ownerId ?? ""))
        mismatch = `"${declared}" belongs to another owner`;
      return { id: declared, assigned: false, mismatch };
    }
    // A malformed id is reported rather than silently replaced: the page author
    // wrote something, and quietly substituting a different id would detach every
    // reference that already used theirs.
    return { id: declared, assigned: false, malformed: `"${declared}" is not a well-formed Codex id` };
  }
  const scope = opts?.scope ?? "wte";
  const id =
    scope === "wte"
      ? makeId(kind, title)
      : makeId(kind, title, { scope, owner: opts?.ownerId ?? "" });
  return { id, assigned: true };
}

/** Build an entity from a parsed page. Pure — persistence is the caller's job. */
export function buildEntity(args: {
  kind: CodexKind;
  title: string;
  sourcePage: string;
  fields: Record<string, string>;
  data: unknown;
  summary?: string;
  scope?: IdScope;
  ownerId?: string;
}): { entity: CodexEntity; assigned: boolean; malformed?: string; mismatch?: string } {
  const { kind, title, sourcePage, fields, data, summary } = args;
  const ident = resolveIdentity(kind, title, fields, { scope: args.scope, ownerId: args.ownerId });

  // A page may declare aliases; the canonical name is never also an alias.
  const aliases = [...new Set(splitList(fields.aliases))].filter((a) => a && a !== title);

  const overrides = (fields.overrides ?? "").trim() || undefined;
  const vis = (fields.visibility ?? "").trim().toLowerCase();

  return {
    entity: {
      id: ident.id,
      kind,
      name: title,
      aliases,
      sourcePage,
      scope: args.scope ?? "wte",
      ownerId: args.ownerId,
      // Default PLAYER-visible: a page nobody classified is ordinary content. The
      // fail-closed rule applies to unreadable STORED settings (see pageMeta), not
      // to an author who simply did not write a Visibility row.
      visibility: vis === "curator" || vis === "gm" ? "curator" : "player",
      summary,
      overrides,
      data,
    },
    assigned: ident.assigned,
    malformed: ident.malformed,
    mismatch: ident.mismatch,
  };
}

/** The markdown row that pins a page's identity, for writing an assigned id back. */
export function identityRow(id: string): string {
  return `| ID | ${id} |`;
}

/**
 * Insert or update the `| ID |` row in a page's markdown.
 *
 * Placed inside the existing field table when there is one, so the page still
 * reads as a table rather than gaining a stray row somewhere odd.
 */
export function withIdentityRow(md: string, id: string): string {
  const text = md.replace(/\r\n/g, "\n");
  // Already pinned — replace in place so a corrected id does not duplicate.
  const existing = /^\s*\|\s*ID\s*\|\s*[^|]*\|\s*$/im;
  if (existing.test(text)) return text.replace(existing, identityRow(id));

  const lines = text.split("\n");
  // After the LAST row of the first contiguous table block.
  let firstTable = -1;
  let lastRow = -1;
  for (let i = 0; i < lines.length; i++) {
    const isRow = /^\s*\|.*\|\s*$/.test(lines[i]);
    if (isRow && firstTable < 0) firstTable = i;
    if (isRow && firstTable >= 0) lastRow = i;
    else if (firstTable >= 0 && !isRow && lines[i].trim() === "") continue;
    else if (firstTable >= 0 && !isRow) break;
  }
  if (lastRow >= 0) {
    lines.splice(lastRow + 1, 0, identityRow(id));
    return lines.join("\n");
  }
  // No table: put it after the title heading, or at the top.
  const h = lines.findIndex((l) => /^#{1,4}\s+\S/.test(l));
  const at = h >= 0 ? h + 1 : 0;
  lines.splice(at, 0, "", "| Field | Value |", "|---|---|", identityRow(id));
  return lines.join("\n");
}

/** Every string this entity can be found by, lowercased. Drives the resolver. */
export function entityKeys(e: CodexEntity): string[] {
  const keys = [e.id.toLowerCase(), e.name.toLowerCase(), slugify(e.name)];
  for (const a of e.aliases) keys.push(a.toLowerCase(), slugify(a));
  return [...new Set(keys.filter(Boolean))];
}

/** Record a rename: the id is untouched and the previous name becomes an alias. */
export function renameEntity(e: CodexEntity, newName: string): CodexEntity {
  const next = newName.trim();
  if (!next || next === e.name) return e;
  const aliases = [...new Set([...e.aliases, e.name])].filter((a) => a !== next);
  return { ...e, name: next, aliases };
}
