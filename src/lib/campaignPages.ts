// Which Codex pages belong to a campaign, and how they travel.
//
// Pages live in one shared folder on disk, so "belongs to" cannot be a directory
// — it has to be something the page itself says. Since 2C.1 it does: a house rule
// carries a campaign-scoped ID row naming its owner, written into the page when
// it was saved. That is the persistence, and it is what makes a page portable
// without being ambiguous about whose rule it is.
//
// Exporting a campaign without these produces a package that restores the
// characters and the scenes and then plays by the official rules, because the
// table's own rules were never in the file.
import { parseId, slugify } from "../game/codexId";
import { listOwnedCodexPages } from "./codexPageRepo";

export interface CampaignPage {
  stem: string;
  content: string;
}

/** Read one field from a page's field table, in any of the shapes we accept. */
export function readField(md: string, key: string): string | undefined {
  const row = new RegExp(`^\\s*\\|\\s*${key}\\s*\\|\\s*([^|]*)\\|\\s*$`, "im");
  const m = md.match(row);
  if (m) return m[1].trim();
  const bold = md.match(new RegExp(`^\\s*(?:[-*]\\s*)?\\*\\*${key}\\*\\*:?\\s*(.+)$`, "im"));
  return bold ? bold[1].trim() : undefined;
}

/**
 * Does this page belong to `campaignId`?
 *
 * Only an explicit campaign-scoped id counts. A page that merely declares
 * `Overrides` without an id is a house rule whose owner was never written down —
 * it is reported by the loader rather than claimed here, because guessing an
 * owner is how one table's rules end up in another table's export.
 */
export function pageBelongsTo(content: string, campaignId: string): boolean {
  const declared = readField(content, "ID");
  if (!declared) return false;
  const parsed = parseId(declared.trim());
  return parsed?.scope === "campaign" && parsed.owner === slugify(campaignId);
}

/** A page that declares a house rule but never recorded which campaign owns it. */
export function pageIsUnownedHouseRule(content: string): boolean {
  const overrides = (readField(content, "Overrides") ?? "").trim();
  if (!overrides || overrides.toLowerCase() === "none") return false;
  const declared = readField(content, "ID");
  return !declared || parseId(declared.trim())?.scope !== "campaign";
}

/**
 * Rewrite a page's identity for a NEW owner.
 *
 * Used when a package is imported as a copy: the campaign gets a fresh id, and
 * every page claiming the old one has to follow, or the imported pages resolve
 * for nobody and the copied campaign silently plays by the official rules.
 *
 * The SLUG is preserved, so a page's identity within its campaign survives the
 * move and references between imported records still line up.
 */
export function reownPage(content: string, fromCampaignId: string, toCampaignId: string): string {
  const from = slugify(fromCampaignId);
  const to = slugify(toCampaignId);
  if (!from || !to || from === to) return content;
  // Only ids naming the OLD campaign are touched. A page carrying some other
  // campaign's id is left exactly as it was — it is not ours to rewrite.
  return content.replace(
    new RegExp(`(^\\s*\\|\\s*ID\\s*\\|\\s*)campaign\\.${from}\\.([^|]*)(\\|\\s*$)`, "gim"),
    (_m, head, rest, tail) => `${head}campaign.${to}.${rest}${tail}`
  );
}

/** Rewrite every campaign-scoped id inside a package's pages for a new owner. */
export function reownPages(pages: CampaignPage[], from: string, to: string): CampaignPage[] {
  return pages.map((p) => ({ ...p, content: reownPage(p.content, from, to) }));
}

/**
 * Every page this campaign owns, read from disk.
 *
 * A read failure on one page does not stop the export, but it is NOT silent: the
 * caller is told which pages could not be included, because a package that
 * quietly left out a house rule is the failure this whole slice exists to fix.
 */
export async function collectCampaignPages(
  campaignId: string
): Promise<{ pages: CampaignPage[]; unreadable: string[]; unowned: string[] }> {
  const pages: CampaignPage[] = [];
  const seen = new Set<string>();
  // Stored pages first — those are owned by construction, not by declaration,
  // so they need no inspection to prove whose they are.
  for (const sp of await listOwnedCodexPages(campaignId).catch(() => [])) {
    pages.push({ stem: sp.stem, content: sp.content });
    seen.add(sp.stem.toLowerCase());
  }
  const unreadable: string[] = [];
  const unowned: string[] = [];
  const w = window as unknown as {
    __TAURI__?: { core: { invoke: <T>(c: string, a?: Record<string, unknown>) => Promise<T> } };
  };
  if (!w.__TAURI__ || !campaignId) return { pages, unreadable, unowned };

  let stems: string[] = [];
  try {
    stems = await w.__TAURI__.core.invoke<string[]>("wte_list_pages");
  } catch {
    // Cannot enumerate, so cannot claim the export is complete.
    return { pages, unreadable: ["(the page list could not be read)"], unowned };
  }

  for (const stem of stems) {
    let content: string;
    try {
      content = await w.__TAURI__.core.invoke<string>("wte_load_page", { path: stem });
    } catch {
      unreadable.push(stem);
      continue;
    }
    // A stored version of this stem already travelled, and it is the one in
    // force for this campaign; the file is the global fallback it shadows.
    if (seen.has(stem.toLowerCase())) continue;
    if (pageBelongsTo(content, campaignId)) pages.push({ stem, content });
    else if (pageIsUnownedHouseRule(content)) unowned.push(stem);
  }
  return { pages, unreadable, unowned };
}
