// Tracks which SHARED-LIBRARY (published) pages this install has imported, and
// at which publish timestamp — so the pull picker can say NEW / UPDATED /
// CURRENT per page, and boot can silently re-import pages whose published
// version moved (players see the owner's edits without doing anything).
// Pure status logic up top (unit-tested); localStorage wrappers below.

import type { PublishedPage } from "./publishedPages";

export type LibStatus = "new" | "updated" | "current";

/** stem → publish timestamp (`at`) of the copy we imported. */
export type PulledMap = Record<string, number>;

export function libStatus(page: { stem: string; at: number }, pulled: PulledMap): LibStatus {
  const at = pulled[page.stem];
  if (at === undefined) return "new";
  return page.at > at ? "updated" : "current";
}

/** The pages boot should silently re-import: already pulled here, republished since. */
export function stalePulled(pages: PublishedPage[], pulled: PulledMap): PublishedPage[] {
  return pages.filter((p) => libStatus(p, pulled) === "updated");
}

// ── localStorage wrappers ────────────────────────────────────────────────────

const KEY = "wte-pulled-lib";

export function getPulledMap(): PulledMap {
  try {
    const raw = localStorage.getItem(KEY);
    const obj = raw ? (JSON.parse(raw) as PulledMap) : {};
    return obj && typeof obj === "object" ? obj : {};
  } catch {
    return {};
  }
}

export function markPulled(stem: string, at: number): void {
  const map = getPulledMap();
  map[stem] = at;
  try {
    localStorage.setItem(KEY, JSON.stringify(map));
  } catch {
    /* quota — status tracking just degrades to "new" */
  }
}
