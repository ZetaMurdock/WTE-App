import { useEffect, useMemo, useState } from "react";
import {
  buildCampaignCodexSnapshot,
  cachedCampaignCodexSnapshot,
  invalidatePageFileCache,
  type CampaignCodexPage,
  type CampaignCodexSnapshot,
} from "../lib/campaignCodex";
import { openCodexPage, type OpenCodexPageIntent } from "../lib/openCodexPage";
import { inferCodexSectionLabel, officialConceptIdFor } from "../lib/codexMechanicScaffold";
import { readField } from "../lib/pageIdentity";
import { getSpecies } from "../game/wte";
import { resolveCampaignCodexPages } from "../lib/campaignCodex";
import {
  isPinned,
  moveQuickLink,
  readOpenGroups,
  readQuickLinks,
  reconcileQuickLinks,
  setGroupOpen,
  toggleQuickLink,
  type CodexQuickLink,
} from "../lib/codexQuickLinks";

interface Props {
  campaignId: string;
  campaignName: string;
  /** Campaign rules are authored only from the Curator's side of the table. */
  curator: boolean;
}

interface PageGroup {
  key: string;
  label: string;
  pages: CampaignCodexPage[];
}

function humanize(value: string): string {
  const words = value.trim().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
  return words ? words[0].toUpperCase() + words.slice(1) : "Pages";
}

// Section order. Mechanics first, in the order a character is actually built,
// then everything else alphabetically, then prose.
//
// Straight alphabetical put Species below Cipher, Equipment, Genus and every
// custom label a table had invented — and on a Codex that is mostly lore, the
// nine rules a Curator edits were somewhere in the middle of the list.
const SECTION_ORDER = [
  "species", "paradigm", "background", "genus", "cipher", "incept",
  "weapon", "equipment", "creature", "condition", "roll formula",
];
/** Generic buckets. Real content, but never what someone opened settings for. */
const SECTION_LAST = ["lore", "page", "pages", "unsorted"];

function sectionRank(key: string): number {
  // A domain/paradigm subgroup ranks where its parent section does; the
  // domains then order alphabetically among themselves via the label sort.
  const base = key.includes("\u00b7") ? key.split("\u00b7")[0].trim() : key;
  const known = SECTION_ORDER.indexOf(base);
  if (known >= 0) return known;
  return SECTION_LAST.includes(base) ? SECTION_ORDER.length + 1 : SECTION_ORDER.length;
}

/**
 * The rules actually IN FORCE, one entry per rule.
 *
 * Three records can describe the same rule at once: the official wiki article,
 * the generated built-in mechanics page, and a campaign fork. Character
 * creation reads exactly one of them — so this panel lists exactly one: the
 * fork when it exists, else the article, else the built-in.
 */
export function effectiveCampaignCodexView(
  pages: CampaignCodexPage[],
  builtIn: CampaignCodexPage[]
): CampaignCodexPage[] {
  // Campaign forks shadow the official pages they override (or share a stem
  // with) — the same collapse players receive.
  const resolved = resolveCampaignCodexPages(pages);
  // Then collapse by CONCEPT: a fork carrying `Overrides: wte.paradigm.cognition`
  // and the official Cognition article describe the same rule even though their
  // ids differ. The fork wins — it is what character creation reads.
  const conceptOf = (page: CampaignCodexPage): string => {
    if (page.overrides && page.overrides.toLowerCase() !== "none") return page.overrides;
    return (
      officialConceptIdFor({ stem: page.stem, content: page.content, label: page.label, kind: page.kind }) ?? page.id
    );
  };
  // Priority per concept: the campaign fork (what creation actually reads),
  // then the BUILT-IN mechanics page (generated from the live catalog — its
  // innates and variants are exactly creation's), then the lore article. The
  // article losing to the built-in is deliberate: after a species rework the
  // prose page may lag, but Campaign Settings is the RULES view, and it must
  // show what the character creator will offer.
  const MECHANIC_TYPES = new Set(["species", "paradigm", "background", "genus", "cipher", "incept", "weapon", "equipment", "gear", "condition", "roll formula", "formula"]);
  const rank = (page: CampaignCodexPage): number => {
    if (page.source === "campaign") return 4;
    if (page.builtIn) return 2;
    // A PULLED official page that declares a mechanic Type feeds the catalogs —
    // creation reads it, so it outranks the generated stand-in. Prose never does.
    const type = (readField(page.content, "Type") || "").trim().toLowerCase();
    return page.pulled && MECHANIC_TYPES.has(type) ? 3 : 1;
  };
  const byConcept = new Map<string, CampaignCodexPage>();
  for (const page of [...resolved, ...builtIn]) {
    const key = conceptOf(page);
    const prior = byConcept.get(key);
    if (!prior || rank(page) > rank(prior)) byConcept.set(key, page);
  }
  return [...byConcept.values()];
}

/** Genus groups by their Genera domain; ciphers by their paradigm. The field
 *  is on the page itself, so campaign forks group with their domain too. */
function subgroupOf(page: CampaignCodexPage, sectionKey: string): { key: string; label: string } | null {
  if (sectionKey === "genus") {
    const domain = (readField(page.content, "Domain") || "").trim();
    if (domain) return { key: `genus·${domain.toLowerCase()}`, label: `Genus · ${domain}` };
  }
  if (sectionKey === "incept") {
    const speciesId = (readField(page.content, "Species") || readField(page.content, "Pool") || "").trim();
    if (speciesId) {
      const name = getSpecies(speciesId.toLowerCase())?.name ?? humanize(speciesId);
      return { key: `incept·${speciesId.toLowerCase()}`, label: `Incepts · ${name}` };
    }
  }
  if (sectionKey === "cipher") {
    const paradigm = (readField(page.content, "Paradigm") || "").trim();
    if (paradigm) {
      const name = paradigm[0].toUpperCase() + paradigm.slice(1).toLowerCase();
      return { key: `cipher·${paradigm.toLowerCase()}`, label: `Ciphers · ${name}` };
    }
  }
  return null;
}

/** A dynamic view model: a new Codex kind automatically becomes a new group. */
export interface SectionTree {
  key: string;
  label: string;
  /** Flat sections carry pages directly; Genus/Ciphers carry children. */
  pages?: CampaignCodexPage[];
  children?: PageGroup[];
  count: number;
}

/**
 * Nest the domain/paradigm subgroups under one collapsed parent each: open
 * "Ciphers", then migrate into the paradigm you want — 148 ciphers never sit
 * flat in the section list.
 */
export function campaignCodexSectionTree(groups: PageGroup[]): SectionTree[] {
  const out: SectionTree[] = [];
  const parents = new Map<string, SectionTree>();
  for (const group of groups) {
    const sep = group.key.indexOf("\u00b7");
    if (sep < 0) {
      out.push({ key: group.key, label: group.label, pages: group.pages, count: group.pages.length });
      continue;
    }
    const parentKey = group.key.slice(0, sep).trim();
    const parentLabel =
      parentKey === "genus" ? "Genus" : parentKey === "cipher" ? "Ciphers" : parentKey === "incept" ? "Incepts" : humanize(parentKey);
    let parent = parents.get(parentKey);
    if (!parent) {
      parent = { key: parentKey, label: parentLabel, children: [], count: 0 };
      parents.set(parentKey, parent);
      out.push(parent);
    }
    parent.children!.push(group);
    parent.count += group.pages.length;
  }
  return out;
}

export function groupCampaignCodexPages(pages: CampaignCodexPage[]): PageGroup[] {
  const groups = new Map<string, PageGroup>();
  for (const page of pages) {
    const raw = inferCodexSectionLabel({
      stem: page.stem,
      content: page.content,
      label: page.label,
      kind: page.kind,
    }) || page.kind.trim() || "Pages";
    const sectionKey = raw.toLocaleLowerCase();
    const sub = subgroupOf(page, sectionKey);
    const key = sub?.key ?? sectionKey;
    // Preserve an explicitly authored label's casing. Inferred/kind labels keep
    // the panel's existing sentence-case presentation (for example
    // "Roll formula" rather than changing an established dashboard heading).
    const displayLabel = sub?.label ?? (page.label?.trim() ? humanize(raw) : humanize(raw.toLocaleLowerCase()));
    const group = groups.get(key) ?? { key, label: displayLabel, pages: [] };
    group.pages.push(page);
    groups.set(key, group);
  }
  return [...groups.values()]
    .map((group) => ({
      ...group,
      pages: [...group.pages].sort((a, b) => a.title.localeCompare(b.title) || a.source.localeCompare(b.source)),
    }))
    .sort((a, b) => sectionRank(a.key) - sectionRank(b.key) || a.label.localeCompare(b.label));
}

function openPage(page: CampaignCodexPage, campaignId: string, intent: OpenCodexPageIntent): void {
  openCodexPage(page.stem, undefined, { intent, campaignId, pageId: page.id });
}

export function CampaignCodexPanel({ campaignId, campaignName, curator }: Props) {
  // Painted from the last manifest for this campaign, so returning to the
  // dashboard shows the settings immediately instead of an empty panel and a
  // wait. The rebuild below still runs and replaces it.
  const [snapshot, setSnapshot] = useState<CampaignCodexSnapshot | null>(() =>
    curator && campaignId ? cachedCampaignCodexSnapshot(campaignId) : null
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [reloadToken, setReloadToken] = useState(0);
  const [filter, setFilter] = useState("");
  const [pins, setPins] = useState<CodexQuickLink[]>(() => (campaignId ? readQuickLinks(campaignId) : []));
  const [openGroups, setOpenGroups] = useState<string[]>(() => (campaignId ? readOpenGroups(campaignId) : []));

  // Pins and expanded sections belong to a campaign, not to the panel.
  useEffect(() => {
    setPins(campaignId ? readQuickLinks(campaignId) : []);
    setOpenGroups(campaignId ? readOpenGroups(campaignId) : []);
  }, [campaignId]);

  useEffect(() => {
    if (!curator || !campaignId) return;
    let alive = true;
    // Switching campaigns must not leave the previous table's rules on screen
    // while the new one builds. A cached manifest for THIS campaign is fine.
    setSnapshot(cachedCampaignCodexSnapshot(campaignId));
    setLoading(true);
    setError("");
    void buildCampaignCodexSnapshot(campaignId, campaignName)
      .then((next) => {
        if (!alive) return;
        setSnapshot(next);
      })
      .catch((reason) => {
        if (!alive) return;
        setSnapshot(null);
        setError(reason instanceof Error ? reason.message : String(reason));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [campaignId, campaignName, curator, reloadToken]);

  // A page save or pull/visibility change should refresh the dashboard without
  // requiring the Curator to leave and return to it.
  useEffect(() => {
    if (!curator) return;
    const reload = () => setReloadToken((token) => token + 1);
    window.addEventListener("wte-pages-changed", reload);
    return () => window.removeEventListener("wte-pages-changed", reload);
  }, [curator]);

  // The compiled catalog, shown alongside the stored pages. A real official page
  // with the same identity is the better record of the same rule (someone
  // uploaded the actual article), so the generated stand-in steps aside.
  const allPages = useMemo(
    () => effectiveCampaignCodexView(snapshot?.pages ?? [], snapshot?.builtIn ?? []),
    [snapshot]
  );

  const groups = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    const pages = needle
      ? allPages.filter((page) =>
          `${page.title}\n${page.id}\n${page.kind}\n${inferCodexSectionLabel({ stem: page.stem, content: page.content, label: page.label, kind: page.kind }) ?? ""}\n${page.source}`.toLowerCase().includes(needle)
        )
      : allPages;
    return groupCampaignCodexPages(pages);
  }, [allPages, filter]);
  const tree = useMemo(() => campaignCodexSectionTree(groups), [groups]);

  // A rule renamed in the Codex should read by its new name in the pin rail, and
  // a rule that no longer exists should not sit there as a dead button.
  useEffect(() => {
    if (!campaignId || !allPages.length) return;
    setPins((current) => reconcileQuickLinks(campaignId, current, allPages));
  }, [allPages, campaignId]);

  const pinnedPages = useMemo(() => {
    const byId = new Map(allPages.map((page) => [page.id, page]));
    return pins.flatMap((pin) => {
      const page = byId.get(pin.id);
      return page ? [page] : [];
    });
  }, [allPages, pins]);

  function togglePin(page: CampaignCodexPage): void {
    if (!campaignId) return;
    setPins(toggleQuickLink(campaignId, { id: page.id, stem: page.stem, title: page.title }));
  }

  function movePin(id: string, delta: -1 | 1): void {
    if (!campaignId) return;
    setPins(moveQuickLink(campaignId, id, delta));
  }

  function pageCard(page: CampaignCodexPage) {
    const actionIntent: OpenCodexPageIntent = page.source === "campaign" ? "edit" : "customize";
    return (
      <article className="campaign-codex-page" key={`${page.source}:${page.id}`}>
        <button
          className="campaign-codex-page-main"
          onClick={() => openPage(page, campaignId, "read")}
          title={`Open ${page.title} in the Codex`}
        >
          <span className="campaign-codex-page-title">{page.title}</span>
          <span className="campaign-codex-page-id">{page.id}</span>
        </button>
        <div className="campaign-codex-statuses" aria-label={`${page.title} status`}>
          <span className={`campaign-codex-badge source-${page.builtIn ? "builtin" : page.source}`}>
            {page.source === "campaign" ? "Campaign" : page.builtIn ? "Built-in" : "Official"}
          </span>
          <span className={`campaign-codex-badge visibility-${page.visibility}`}>
            {page.visibility === "curator" ? "Curator only" : "Players"}
          </span>
          {/* "Not pulled" would read as broken on a built-in rule.
              It is already in force — that is what built-in means. */}
          <span className={`campaign-codex-badge ${page.builtIn ? "pulled" : page.pulled ? "pulled" : "not-pulled"}`}>
            {page.builtIn ? "In force" : page.pulled ? "Pulled" : "Not pulled"}
          </span>
        </div>
        <div className="campaign-codex-actions">
          <button
            className={"ghost-btn xs" + (isPinned(pins, page.id) ? " pinned" : "")}
            onClick={() => togglePin(page)}
            aria-pressed={isPinned(pins, page.id)}
            title={isPinned(pins, page.id) ? "Remove from quick links" : "Add to quick links"}
          >
            {isPinned(pins, page.id) ? "★" : "☆"}
          </button>
          <button className="ghost-btn xs" onClick={() => openPage(page, campaignId, "read")}>
            Open
          </button>
          <button className="primary-btn xs" onClick={() => openPage(page, campaignId, actionIntent)}>
            {page.source === "campaign" ? "Edit" : "Customize"}
          </button>
        </div>
      </article>
    );
  }

  if (!curator) return null;

  const builtInCount = allPages.filter((page) => page.builtIn).length;
  const officialCount = allPages.filter((page) => page.source === "official" && !page.builtIn).length;
  const campaignCount = allPages.filter((page) => page.source === "campaign").length;

  return (
    <section className="campaign-codex" aria-label="Campaign Codex">
      <div className="campaign-codex-head">
        <div>
          <div className="dash-eyebrow">Campaign Codex · Curator</div>
          <h2 className="campaign-codex-title">Campaign Settings</h2>
          <p className="campaign-codex-summary">
            {snapshot
              ? `${builtInCount} built-in · ${officialCount} official · ${campaignCount} campaign ${campaignCount === 1 ? "change" : "changes"} · revision ${snapshot.revision}`
              : "Every rule in force — built-in lineages included — used by character creation, sheets, and the table."}
          </p>
        </div>
        <button
          className="chip"
          onClick={() => {
            // Refresh exists for the case the cache cannot see: a page edited
            // outside the app. Re-read from disk, not from memory.
            invalidatePageFileCache();
            setReloadToken((token) => token + 1);
          }}
          disabled={loading}
        >
          {loading ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      {snapshot && (
        <input
          className="campaign-codex-filter"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          placeholder="Filter connected pages, types, or ids…"
          aria-label="Filter Campaign Codex"
        />
      )}

      {error && <p className="campaign-codex-error">Could not read this campaign's Codex: {error}</p>}
      {!error && loading && !snapshot && <p className="list-empty">Reading campaign settings…</p>}
      {!error && !loading && snapshot && allPages.length === 0 && (
        <p className="list-empty">No Codex pages are connected to this campaign yet.</p>
      )}
      {!error && snapshot && allPages.length > 0 && filter.trim() && groups.length === 0 && (
        <p className="list-empty">No connected Codex pages match that filter.</p>
      )}

      {pinnedPages.length > 0 && (
        <div className="campaign-codex-pinned" aria-label="Quick links">
          <div className="campaign-codex-pinnedhead">Quick links</div>
          <div className="campaign-codex-pinrail">
            {pinnedPages.map((page, index) => (
              <div className="campaign-codex-pin" key={page.id}>
                <button
                  className="campaign-codex-pin-open"
                  onClick={() => openPage(page, campaignId, page.source === "campaign" ? "edit" : "customize")}
                  title={`${page.source === "campaign" ? "Edit" : "Customize"} ${page.title}`}
                >
                  {page.title}
                </button>
                <div className="campaign-codex-pin-order">
                  <button
                    className="ghost-btn xs"
                    onClick={() => movePin(page.id, -1)}
                    disabled={index === 0}
                    aria-label={`Move ${page.title} earlier`}
                    title="Move earlier"
                  >
                    ←
                  </button>
                  <button
                    className="ghost-btn xs"
                    onClick={() => movePin(page.id, 1)}
                    disabled={index === pinnedPages.length - 1}
                    aria-label={`Move ${page.title} later`}
                    title="Move later"
                  >
                    →
                  </button>
                  <button
                    className="ghost-btn xs"
                    onClick={() => togglePin(page)}
                    aria-label={`Unpin ${page.title}`}
                    title="Unpin"
                  >
                    ★
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {groups.length > 0 && (
        <div className="campaign-codex-groups">
          {tree.map((section) => (
            <details
              className="campaign-codex-group"
              key={section.key}
              // A filter is a search: showing the matches inside collapsed
              // sections would hide the very thing that was searched for.
              open={!!filter.trim() || openGroups.includes(section.key)}
              onToggle={(event) =>
                setOpenGroups(setGroupOpen(campaignId, section.key, event.currentTarget.open))
              }
            >
              <summary className="campaign-codex-grouphead">
                <span>{section.label}</span>
                <span className="campaign-codex-count">{section.count}</span>
              </summary>
              {section.pages && (
                <div className="campaign-codex-pages">
                  {section.pages.map((page) => pageCard(page))}
                </div>
              )}
              {/* Genus and Ciphers open into their domains/paradigms — a second
                  collapse level, so 148 ciphers never sit flat in the list. */}
              {section.children && (
                <div className="campaign-codex-subgroups">
                  {section.children.map((child) => (
                    <details
                      className="campaign-codex-group sub"
                      key={child.key}
                      open={!!filter.trim() || openGroups.includes(child.key)}
                      onToggle={(event) =>
                        setOpenGroups(setGroupOpen(campaignId, child.key, event.currentTarget.open))
                      }
                    >
                      <summary className="campaign-codex-grouphead sub">
                        <span>{child.label}</span>
                        <span className="campaign-codex-count">{child.pages.length}</span>
                      </summary>
                      <div className="campaign-codex-pages gallery">
                        {child.pages.map((page) => pageCard(page))}
                      </div>
                    </details>
                  ))}
                </div>
              )}
            </details>
          ))}
        </div>
      )}
    </section>
  );
}
