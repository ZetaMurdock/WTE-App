// Pinning a Codex page's identity into the page itself, at save time.
//
// A generated id that only ever lives in memory is not a stable id. Before this,
// a Curator writing a new Genus ability got a page with no ID row, so its id was
// re-derived from the title on every load — which means renaming the page moved
// its identity and detached every character that had taken the ability. The
// template even told them to leave Overrides blank, so the ability appeared in
// the picker while being absent from the semantic registry entirely.
//
// So: on save, a page that carries mechanics gets its id written INTO it, and a
// rename records the previous name as an alias. Both edits are made to the
// markdown the user is saving, so what is on disk is the whole truth about that
// page's identity — nothing is inferred at load time.
import { identityRow, withIdentityRow } from "../game/codexEntity";
import { makeId, parseId, slugify, type IdKind, type IdScope } from "../game/codexId";

/** Kinds whose pages carry mechanics and therefore need a permanent identity.
 *  Lore pages are deliberately excluded — they have nothing to reference. */
const SEMANTIC_KINDS: Record<string, IdKind> = {
  genus: "genus",
  cipher: "cipher",
  weapon: "weapon",
  equipment: "gear",
  gear: "gear",
  creature: "creature",
  species: "species",
  paradigm: "paradigm",
  background: "background",
};

/** Read one `| Key | Value |`-style field, the same shapes the parsers accept. */
function readField(md: string, key: string): string | undefined {
  const re = new RegExp(`^\\s*\\|\\s*${key}\\s*\\|\\s*([^|]*)\\|\\s*$`, "im");
  const m = md.match(re);
  if (m) return m[1].trim();
  const bold = md.match(new RegExp(`^\\s*(?:[-*]\\s*)?\\*\\*${key}\\*\\*:?\\s*(.+)$`, "im"));
  return bold ? bold[1].trim() : undefined;
}

/** The `# Title` heading, which is what a page is called. */
function titleOf(md: string, fallback: string): string {
  const m = md.match(/^#{1,4}\s+(.+)$/m);
  return (m ? m[1] : fallback).replace(/[*_`]/g, "").trim();
}

/** Put an Aliases row in, or extend the one already there. */
function withAlias(md: string, alias: string): string {
  const existing = readField(md, "Aliases");
  const have = (existing ?? "")
    .split(/[,;/]/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (have.some((a) => slugify(a) === slugify(alias))) return md;
  const merged = [...have, alias].join(", ");
  const row = /^\s*\|\s*Aliases\s*\|\s*[^|]*\|\s*$/im;
  if (row.test(md)) return md.replace(row, `| Aliases | ${merged} |`);
  // No row yet — put it beside the ID row, which withIdentityRow guarantees.
  const idRow = /^(\s*\|\s*ID\s*\|\s*[^|]*\|\s*)$/im;
  if (idRow.test(md)) return md.replace(idRow, `$1\n| Aliases | ${merged} |`);
  return md;
}

export interface PinResult {
  content: string;
  /** The id the page now carries. */
  id: string;
  /** True when this save is what gave the page its id. */
  assigned: boolean;
  /** Set when a rename was recorded. */
  aliasAdded?: string;
}

/**
 * Give a page a permanent identity before it is written to disk.
 *
 * `previousContent` is what the page said before this edit, when it existed —
 * that is the only way to know a rename happened, and a rename is precisely when
 * a reference would otherwise break.
 *
 * Returns the content unchanged for lore pages, and for pages that already carry
 * an id: an id is assigned once and never reassigned, which is the entire point.
 */
export function pinPageIdentity(args: {
  content: string;
  stem: string;
  previousContent?: string;
  /** The campaign a house rule belongs to. Omitted for official/global pages. */
  campaignId?: string;
}): PinResult | null {
  const { content, stem, previousContent, campaignId } = args;
  const typeRaw = (readField(content, "Type") ?? "").toLowerCase().trim();
  const kind = SEMANTIC_KINDS[typeRaw];
  if (!kind) return null; // lore: nothing to reference, nothing to pin

  const title = titleOf(content, stem);
  if (!slugify(title)) return null; // no usable name to build an id from

  let out = content;
  let aliasAdded: string | undefined;

  // A rename must not lose the old name. Characters and notes that reference it
  // keep resolving through the alias, which is what makes renaming safe at all.
  if (previousContent) {
    const before = titleOf(previousContent, stem);
    if (before && slugify(before) !== slugify(title)) {
      out = withAlias(out, before);
      aliasAdded = before;
    }
  }

  const declared = (readField(out, "ID") ?? "").trim();
  if (declared && parseId(declared)) {
    return { content: out, id: declared, assigned: false, aliasAdded };
  }

  // A campaign house rule is owned by its campaign, permanently and in writing.
  // Ownership used to come from whichever campaign happened to be open when the
  // page was read, so the same file could be re-owned by the next table.
  const declaresOverride = !!(readField(out, "Overrides") ?? "").trim();
  const scope: IdScope = declaresOverride && campaignId ? "campaign" : "wte";
  let id: string;
  try {
    id = scope === "wte" ? makeId(kind, title) : makeId(kind, title, { scope, owner: campaignId! });
  } catch {
    return null; // no slug-able title
  }

  // Replaces a malformed ID row rather than adding a second one.
  out = withIdentityRow(out, id);
  return { content: out, id, assigned: true, aliasAdded };
}

export { identityRow };
