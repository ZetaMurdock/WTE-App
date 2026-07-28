// Tracks which SHARED-LIBRARY (published) pages this install has imported, and
// at which publish timestamp — so the pull picker can say NEW / UPDATED /
// CURRENT per page, and boot can silently re-import pages whose published
// version moved (players see the owner's edits without doing anything).
// Pure status logic up top (unit-tested); localStorage wrappers below.

import type { PublishedPage } from "./publishedPages";
import { isRecord, readJson, writeJson } from "./localJson";

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
  return readJson<PulledMap>(KEY, {}, { validate: isRecord, label: "library pull history" }).value;
}

export function markPulled(stem: string, at: number): void {
  const map = getPulledMap();
  map[stem] = at;
  writeJson(KEY, map, { label: "library pull history" });
}
