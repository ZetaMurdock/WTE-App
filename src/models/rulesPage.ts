/** Metadata about a Codex rules page. The page body still lives on disk / in the
 *  Rust rules overlay (wte_load_page); this is the searchable index/link target. */
export interface RulesPage {
  /** Sanitized file stem, e.g. "Species" — matches wte://rules/<stem>. */
  stem: string;
  title: string;
  source: "bundled" | "homebrew" | "local";
  campaignId?: string | null;
  updatedAt: number;
}
