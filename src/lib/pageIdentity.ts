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
import type { StoredCodexPage } from "./codexPageRepo";

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
  formula: "formula",
  "roll formula": "formula",
};

function semanticKind(type: string): IdKind | undefined {
  return Object.prototype.hasOwnProperty.call(SEMANTIC_KINDS, type) ? SEMANTIC_KINDS[type] : undefined;
}

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

function withField(md: string, key: string, value: string): string {
  const row = new RegExp(`^\\s*\\|\\s*${key}\\s*\\|\\s*[^|]*\\|\\s*$`, "im");
  if (row.test(md)) return md.replace(row, `| ${key} | ${value} |`);
  const idRow = /^(\s*\|\s*ID\s*\|\s*[^|]*\|\s*)$/im;
  if (idRow.test(md)) return md.replace(idRow, `$1\n| ${key} | ${value} |`);
  return `${md.trimEnd()}\n\n| Field | Value |\n|---|---|\n| ${key} | ${value} |\n`;
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
 * Returns the content unchanged for official lore pages. Campaign lore receives
 * a generic page id so it can be owned/synchronized. For pages that already
 * carry an id: an id is assigned once and never reassigned, which is the point.
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
  const kind = semanticKind(typeRaw) ?? (campaignId ? "page" : undefined);
  // Official lore still belongs to the global file and needs no semantic id.
  // Campaign lore does need an owned id so it can live in the campaign Codex
  // without mutating or disappearing behind a same-stem official page.
  if (!kind) return null;

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

  // A page authored inside a campaign belongs to that campaign, permanently and
  // in writing.
  //
  // This used to require a non-empty Overrides row, which contradicted the
  // template the Curator was handed: it says to leave Overrides blank for a new
  // ability of your own. So a brand-new homebrew Genus got a global `wte.*` id,
  // the semantic registry treated it as an official concept it had never heard
  // of, and the legacy picker offered it anyway — a Curator could invest Focus
  // and get an unresolved 0-SS row on the sheet and in the VTT.
  //
  // Authoring context is the signal, not the Overrides row. An OFFICIAL page
  // never reaches here with a campaign open and no id: official records come
  // from the shipped data file and the corpus, and any page that already carries
  // an id kept it above.
  const scope: IdScope = campaignId ? "campaign" : "wte";
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

/**
 * Turn a saved page into an OWNED row — or null when it is a global page that
 * belongs on disk alone.
 *
 * One definition of this, used by the editor and by package import alike, so the
 * two cannot disagree about which pages are owned. The id is read from the page
 * rather than invented: by the time this runs, pinPageIdentity has already put
 * one there.
 */
export function storedPageFor(stem: string, content: string, campaignId: string): StoredCodexPage | null {
  const id = (readField(content, "ID") ?? "").trim();
  const parsed = id ? parseId(id) : null;
  if (!parsed || parsed.scope !== "campaign") return null;
  if (!campaignId || parsed.owner !== slugify(campaignId)) return null;
  const vis = (readField(content, "Visibility") ?? "").toLowerCase();
  return {
    id,
    campaignId,
    stem,
    kind: parsed.kind,
    title: titleOf(content, stem),
    content,
    visibility: vis === "curator" || vis === "gm" ? "curator" : "player",
    aliases: (readField(content, "Aliases") ?? "")
      .split(/[,;/]/)
      .map((x) => x.trim())
      .filter(Boolean),
    overrides: readField(content, "Overrides") || undefined,
    updatedAt: Date.now(),
  };
}

/** Fork an official page into a campaign-owned customization. The official file
 * is never touched: its id becomes `Overrides`, and the copy receives a new
 * campaign id. Lore pages use the generic `page` kind so the same safe workflow
 * works for every connected Codex item. */
export function customizePageForCampaign(args: {
  content: string;
  stem: string;
  campaignId: string;
  /** Exact manifest identity of the official record being forked. This matters
   * for legacy prose whose inferred mechanics kind differs from its fallback
   * official page id. */
  officialId?: string;
}): { content: string; id: string; overrides: string } {
  const { stem, campaignId } = args;
  const title = titleOf(args.content, stem);
  const typeRaw = (readField(args.content, "Type") ?? "").toLowerCase().trim();
  const kind = semanticKind(typeRaw) ?? "page";
  const declared = (readField(args.content, "ID") ?? "").trim();
  const parsed = declared ? parseId(declared) : null;
  const manifestId = (args.officialId ?? "").trim();
  const manifestParsed = manifestId ? parseId(manifestId) : null;
  const overrides = manifestParsed && (manifestParsed.scope === "wte" || manifestParsed.scope === "pack")
    ? manifestId
    : parsed && (parsed.scope === "wte" || parsed.scope === "pack")
      ? declared
      : makeId(kind, title);
  const id = makeId(kind, title, { scope: "campaign", owner: campaignId });
  let content = withIdentityRow(args.content, id);
  content = withField(content, "Overrides", overrides);
  return { content, id, overrides };
}

export { identityRow, readField };
