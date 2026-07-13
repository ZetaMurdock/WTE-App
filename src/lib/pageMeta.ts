// Per-Codex-page metadata set by Engineers: whether a page is "pulled" into the
// sheet/VTT catalogs, and whether players can see it. Stored per-device in
// localStorage (keyed by page stem) — same locality as the pages themselves (App
// Data rules overlay); can move to a shared/campaign store later.

export interface PageMeta {
  /** Feeds the character sheet + VTT catalogs (data-driven pull). */
  pulled: boolean;
  /** Who can see the page. */
  visibility: "gm" | "player";
}

export const DEFAULT_PAGE_META: PageMeta = { pulled: true, visibility: "player" };

const KEY = "wte-page-meta";

function readAll(): Record<string, PageMeta> {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    const obj = JSON.parse(raw) as Record<string, Partial<PageMeta>>;
    const out: Record<string, PageMeta> = {};
    for (const [k, v] of Object.entries(obj)) {
      out[k] = {
        pulled: v.pulled !== false,
        visibility: v.visibility === "gm" ? "gm" : "player",
      };
    }
    return out;
  } catch {
    return {};
  }
}

export function allPageMeta(): Record<string, PageMeta> {
  return readAll();
}

export function getPageMeta(stem: string, all?: Record<string, PageMeta>): PageMeta {
  return (all ?? readAll())[stem] ?? DEFAULT_PAGE_META;
}

export function setPageMeta(stem: string, patch: Partial<PageMeta>): Record<string, PageMeta> {
  const all = readAll();
  all[stem] = { ...(all[stem] ?? DEFAULT_PAGE_META), ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    /* ignore quota */
  }
  return all;
}
