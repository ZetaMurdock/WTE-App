// Per-Codex-page metadata set by Engineers: whether a page is "pulled" into the
// sheet/VTT catalogs, and whether players can see it. Stored per-device in
// localStorage (keyed by page stem) — same locality as the pages themselves (App
// Data rules overlay); can move to a shared/campaign store later.

import { isRecord, readJson, writeJson } from "./localJson";

export interface PageMeta {
  /** Feeds the character sheet + VTT catalogs (data-driven pull). */
  pulled: boolean;
  /** Who can see the page. */
  visibility: "gm" | "player";
  /** Section/category the page belongs to. A custom value spawns a new Codex
   *  section; a base type (Creature/Weapon/…) links it to that pull target. */
  label?: string;
}

export const DEFAULT_PAGE_META: PageMeta = { pulled: true, visibility: "player" };

const KEY = "wte-page-meta";

/** Used for an unknown page when the stored metadata could NOT be read.
 *
 *  The old `catch { return {} }` failed OPEN: an empty map means every page falls
 *  back to DEFAULT_PAGE_META, which is `visibility: "player"`. So one malformed
 *  byte published every GM-only Codex page to the table. A Curator's secrets are
 *  the last thing that should default to visible, so a read failure now fails
 *  CLOSED until it is resolved. */
const FAIL_CLOSED_META: PageMeta = { pulled: true, visibility: "gm" };

/** Set when the last read found damaged content. */
let unreadable = false;

/** Whether visibility is currently being forced closed by a read failure, so the
 *  Codex can explain why every page suddenly reads GM-only. */
export function pageMetaUnreadable(): boolean {
  return unreadable;
}

function readAll(): Record<string, PageMeta> {
  const r = readJson<Record<string, Partial<PageMeta>>>(KEY, {}, {
    validate: isRecord,
    label: "Codex page settings",
  });
  unreadable = r.corrupt;
  const out: Record<string, PageMeta> = {};
  for (const [k, v] of Object.entries(r.value)) {
    if (!v || typeof v !== "object") continue;
    out[k] = {
      pulled: v.pulled !== false,
      visibility: v.visibility === "gm" ? "gm" : "player",
      label: typeof v.label === "string" && v.label.trim() ? v.label : undefined,
    };
  }
  return out;
}

export function allPageMeta(): Record<string, PageMeta> {
  return readAll();
}

export function getPageMeta(stem: string, all?: Record<string, PageMeta>): PageMeta {
  const map = all ?? readAll();
  const hit = map[stem];
  if (hit) return hit;
  // No entry for this page. If the store read cleanly, "player" is the intended
  // default for a page nobody has classified. If it did NOT, we cannot know
  // whether this page was marked GM-only, so we must assume it was.
  return unreadable ? FAIL_CLOSED_META : DEFAULT_PAGE_META;
}

export function setPageMeta(stem: string, patch: Partial<PageMeta>): Record<string, PageMeta> {
  const all = readAll();
  all[stem] = { ...(all[stem] ?? DEFAULT_PAGE_META), ...patch };
  writeJson(KEY, all, { label: "Codex page settings" });
  return all;
}
