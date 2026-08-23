// The Curator's pinned rules, and which Campaign Settings sections they leave open.
//
// A table has a handful of rules its Curator touches constantly and three
// hundred it never reopens. Campaign Settings lists all of them alphabetically
// inside collapsed groups, so reaching a working rule meant expanding a section
// and scanning past everything else — every single time, because the panel also
// forgot which sections had been open.
//
// Both of those are per-campaign: one table's working set says nothing about
// another's, and the same installation runs several.
import { readJson, writeJson, isArray } from "./localJson";

/** A pinned rule. The id is the permanent identity; stem and title are kept so a
 *  pin can be rendered and opened without first rebuilding the whole manifest. */
export interface CodexQuickLink {
  id: string;
  stem: string;
  title: string;
}

const MAX_QUICK_LINKS = 40;

function pinKey(campaignId: string): string {
  return `wte-codex-pins:${campaignId}`;
}
function openKey(campaignId: string): string {
  return `wte-codex-open-groups:${campaignId}`;
}

function isQuickLink(value: unknown): value is CodexQuickLink {
  if (typeof value !== "object" || value === null) return false;
  const link = value as Partial<CodexQuickLink>;
  return typeof link.id === "string" && !!link.id &&
    typeof link.stem === "string" && !!link.stem &&
    typeof link.title === "string";
}

export function readQuickLinks(campaignId: string): CodexQuickLink[] {
  if (!campaignId) return [];
  const { value } = readJson<CodexQuickLink[]>(pinKey(campaignId), [], {
    validate: (v) => isArray(v) && (v as unknown[]).every(isQuickLink),
    label: "pinned Codex rules",
  });
  return value.slice(0, MAX_QUICK_LINKS);
}

export function isPinned(links: readonly CodexQuickLink[], id: string): boolean {
  return links.some((link) => link.id === id);
}

/** Pin or unpin, and persist. Returns the new list so the caller can render it
 *  without a re-read. A new pin goes to the END — the order is the Curator's, and
 *  reordering their working set under them on every pin would defeat the point. */
export function toggleQuickLink(campaignId: string, link: CodexQuickLink): CodexQuickLink[] {
  const current = readQuickLinks(campaignId);
  const next = isPinned(current, link.id)
    ? current.filter((existing) => existing.id !== link.id)
    : [...current, link].slice(-MAX_QUICK_LINKS);
  writeJson(pinKey(campaignId), next, { label: "pinned Codex rules" });
  return next;
}

/** Move a pin one place up or down, so a Curator can order their working set. */
export function moveQuickLink(campaignId: string, id: string, delta: -1 | 1): CodexQuickLink[] {
  const current = readQuickLinks(campaignId);
  const from = current.findIndex((link) => link.id === id);
  const to = from + delta;
  if (from < 0 || to < 0 || to >= current.length) return current;
  const next = [...current];
  [next[from], next[to]] = [next[to], next[from]];
  writeJson(pinKey(campaignId), next, { label: "pinned Codex rules" });
  return next;
}

/** Titles drift when a rule is renamed. Refresh the stored label against the
 *  live manifest, and drop a pin whose page no longer exists at all. */
export function reconcileQuickLinks(
  campaignId: string,
  links: readonly CodexQuickLink[],
  pages: ReadonlyArray<{ id: string; stem: string; title: string }>
): CodexQuickLink[] {
  if (!links.length || !pages.length) return [...links];
  const byId = new Map(pages.map((page) => [page.id, page]));
  const next = links.flatMap((link) => {
    const page = byId.get(link.id);
    if (!page) return [];
    return [{ id: page.id, stem: page.stem, title: page.title }];
  });
  const changed =
    next.length !== links.length ||
    next.some((link, i) => link.title !== links[i].title || link.stem !== links[i].stem);
  if (changed) writeJson(pinKey(campaignId), next, { label: "pinned Codex rules", silent: true });
  return changed ? next : [...links];
}

export function readOpenGroups(campaignId: string): string[] {
  if (!campaignId) return [];
  const { value } = readJson<string[]>(openKey(campaignId), [], {
    validate: (v) => isArray(v) && (v as unknown[]).every((k) => typeof k === "string"),
    label: "expanded Codex sections",
  });
  return value;
}

export function setGroupOpen(campaignId: string, key: string, open: boolean): string[] {
  const current = readOpenGroups(campaignId);
  if (open === current.includes(key)) return current;
  const next = open ? [...current, key] : current.filter((existing) => existing !== key);
  writeJson(openKey(campaignId), next, { label: "expanded Codex sections", silent: true });
  return next;
}
