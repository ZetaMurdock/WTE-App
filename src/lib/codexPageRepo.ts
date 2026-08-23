// Codex pages, owned by a campaign.
//
// Pages have always been files in one shared folder, which makes ownership
// something a page can DECLARE but nothing can enforce. The practical
// consequence: two campaigns cannot hold different versions of the same page,
// because there is one file per stem and the second table's rewrite overwrites
// the first table's.
//
// This store fixes that — (campaign_id, stem) is unique, so the same stem can
// exist once globally and once per campaign — without taking anything away. File
// pages keep working exactly as they did; a stored page simply takes precedence
// for the campaign that owns it, which is the narrowest rule that makes
// per-campaign versions possible.
//
// Everything degrades to "no stored pages" when the table is absent, because a
// database that predates this migration is a supported state, not an error.
import { getDb, sqlAvailable } from "./db";
import { parseId, slugify } from "../game/codexId";

/** '' means global — see the migration for why this is not NULL. */
export const GLOBAL_OWNER = "";

export interface StoredCodexPage {
  /** The page's permanent id. */
  id: string;
  /** '' for a global page, otherwise the owning campaign's stable id. */
  campaignId: string;
  stem: string;
  kind?: string;
  title: string;
  content: string;
  visibility: "player" | "curator";
  aliases: string[];
  /** The official id this replaces, or "none" to stand deliberately apart. */
  overrides?: string;
  updatedAt: number;
}

interface Row {
  id: string;
  campaign_id: string;
  stem: string;
  kind: string | null;
  title: string;
  content: string;
  visibility: string | null;
  aliases: string | null;
  overrides: string | null;
  updated_at: number;
}

let tablePresent: boolean | null = null;

function announceCodexChanged(): void {
  if (typeof window !== "undefined") window.dispatchEvent(new Event("wte-pages-changed"));
}

/** Test seam, and a way to re-check after a migration lands mid-session. */
export function __resetCodexPageRepo(): void {
  tablePresent = null;
}

async function haveTable(): Promise<boolean> {
  if (tablePresent !== null) return tablePresent;
  if (!sqlAvailable()) return false;
  try {
    const db = await getDb();
    const rows = await db.select<{ name: string }[]>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'codex_pages'"
    );
    tablePresent = rows.length > 0;
  } catch {
    return false; // transient; never cache a failure as "absent"
  }
  return tablePresent;
}

/** JSON that may be anything. A malformed alias list costs the aliases, not the page. */
function parseAliases(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function rowToPage(r: Row): StoredCodexPage {
  return {
    id: r.id,
    campaignId: r.campaign_id ?? GLOBAL_OWNER,
    stem: r.stem,
    kind: r.kind ?? undefined,
    title: r.title,
    content: r.content,
    // Fail closed on an unreadable visibility: a page whose setting cannot be
    // read might be the hidden one, and showing it is the mistake you cannot undo.
    visibility: r.visibility === "curator" || r.visibility === "gm" ? "curator" : r.visibility === "player" ? "player" : "curator",
    aliases: parseAliases(r.aliases),
    overrides: r.overrides ?? undefined,
    updatedAt: r.updated_at,
  };
}

/**
 * Pages in force for a campaign: its own, plus the global ones it has not
 * replaced.
 *
 * A campaign page SHADOWS a global page with the same stem rather than being
 * listed beside it — two versions of one page in one list is the ambiguity the
 * resolver would then have to refuse, and here it has an obvious answer.
 */
export async function listCodexPages(campaignId?: string | null): Promise<StoredCodexPage[]> {
  if (!(await haveTable())) return [];
  const db = await getDb();
  const owner = campaignId || GLOBAL_OWNER;
  const rows = await db.select<Row[]>(
    "SELECT * FROM codex_pages WHERE campaign_id = $1 OR campaign_id = $2 ORDER BY stem ASC",
    [owner, GLOBAL_OWNER]
  );
  const pages = rows.map(rowToPage);
  const mine = new Set(pages.filter((p) => p.campaignId === owner && owner !== GLOBAL_OWNER).map((p) => p.stem));
  return pages.filter((p) => p.campaignId !== GLOBAL_OWNER || !mine.has(p.stem));
}

/** Only what this campaign owns — what an export should carry. */
export async function listOwnedCodexPages(campaignId: string): Promise<StoredCodexPage[]> {
  if (!campaignId || !(await haveTable())) return [];
  const db = await getDb();
  const rows = await db.select<Row[]>("SELECT * FROM codex_pages WHERE campaign_id = $1 ORDER BY stem ASC", [
    campaignId,
  ]);
  return rows.map(rowToPage);
}

export class ForeignPageError extends Error {
  constructor(declared: string, owner: string) {
    super(
      `That page's permanent id belongs to campaign "${declared}", not "${owner}". It was not saved here — importing it as a copy would re-own another table's rule.`
    );
    this.name = "ForeignPageError";
  }
}

/**
 * Store a page.
 *
 * Refuses a page whose declared id names a DIFFERENT campaign. The store is the
 * last place that can catch that, and letting it through is how one table's
 * house rules quietly become another's.
 */
export async function saveCodexPage(page: StoredCodexPage): Promise<void> {
  if (!(await haveTable())) throw new Error("This build's database has no Codex page store yet.");
  const owner = page.campaignId || GLOBAL_OWNER;
  const declared = parseId(page.id);
  if (declared?.scope === "campaign") {
    if (owner === GLOBAL_OWNER || declared.owner !== slugify(owner)) {
      throw new ForeignPageError(declared.owner ?? "(unknown)", owner || "(global)");
    }
  }
  const db = await getDb();
  await db.execute(
    `INSERT INTO codex_pages (id, campaign_id, stem, kind, title, content, visibility, aliases, overrides, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT(id) DO UPDATE SET
         campaign_id = excluded.campaign_id, stem = excluded.stem, kind = excluded.kind,
         title = excluded.title, content = excluded.content, visibility = excluded.visibility,
         aliases = excluded.aliases, overrides = excluded.overrides, updated_at = excluded.updated_at`,
    [
      page.id,
      owner,
      page.stem,
      page.kind ?? null,
      page.title,
      page.content,
      page.visibility,
      JSON.stringify(page.aliases ?? []),
      page.overrides ?? null,
      page.updatedAt || Date.now(),
    ]
  );
  announceCodexChanged();
}

export async function deleteCodexPage(id: string): Promise<void> {
  if (!(await haveTable())) return;
  const db = await getDb();
  await db.execute("DELETE FROM codex_pages WHERE id = $1", [id]);
  announceCodexChanged();
}

/** Remove every page a campaign owns. Used when undoing a failed copy import. */
export async function deleteCampaignCodexPages(campaignId: string): Promise<void> {
  if (!campaignId || !(await haveTable())) return;
  const db = await getDb();
  await db.execute("DELETE FROM codex_pages WHERE campaign_id = $1", [campaignId]);
  announceCodexChanged();
}
