import { useEffect, useMemo, useState } from "react";
import {
  buildCampaignCodexSnapshot,
  type CampaignCodexPage,
  type CampaignCodexSnapshot,
} from "../lib/campaignCodex";
import { openCodexPage, type OpenCodexPageIntent } from "../lib/openCodexPage";
import { inferCodexSectionLabel } from "../lib/codexMechanicScaffold";

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

/** A dynamic view model: a new Codex kind automatically becomes a new group. */
export function groupCampaignCodexPages(pages: CampaignCodexPage[]): PageGroup[] {
  const groups = new Map<string, PageGroup>();
  for (const page of pages) {
    const raw = inferCodexSectionLabel({
      stem: page.stem,
      content: page.content,
      label: page.label,
      kind: page.kind,
    }) || page.kind.trim() || "Pages";
    const key = raw.toLocaleLowerCase();
    // Preserve an explicitly authored label's casing. Inferred/kind labels keep
    // the panel's existing sentence-case presentation (for example
    // "Roll formula" rather than changing an established dashboard heading).
    const displayLabel = page.label?.trim() ? humanize(raw) : humanize(raw.toLocaleLowerCase());
    const group = groups.get(key) ?? { key, label: displayLabel, pages: [] };
    group.pages.push(page);
    groups.set(key, group);
  }
  return [...groups.values()]
    .map((group) => ({
      ...group,
      pages: [...group.pages].sort((a, b) => a.title.localeCompare(b.title) || a.source.localeCompare(b.source)),
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

function openPage(page: CampaignCodexPage, campaignId: string, intent: OpenCodexPageIntent): void {
  openCodexPage(page.stem, undefined, { intent, campaignId, pageId: page.id });
}

export function CampaignCodexPanel({ campaignId, campaignName, curator }: Props) {
  const [snapshot, setSnapshot] = useState<CampaignCodexSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [reloadToken, setReloadToken] = useState(0);
  const [filter, setFilter] = useState("");

  useEffect(() => {
    if (!curator || !campaignId) return;
    let alive = true;
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

  const groups = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    const pages = needle
      ? (snapshot?.pages ?? []).filter((page) =>
          `${page.title}\n${page.id}\n${page.kind}\n${inferCodexSectionLabel({ stem: page.stem, content: page.content, label: page.label, kind: page.kind }) ?? ""}\n${page.source}`.toLowerCase().includes(needle)
        )
      : snapshot?.pages ?? [];
    return groupCampaignCodexPages(pages);
  }, [filter, snapshot]);

  if (!curator) return null;

  const officialCount = snapshot?.pages.filter((page) => page.source === "official").length ?? 0;
  const campaignCount = snapshot?.pages.filter((page) => page.source === "campaign").length ?? 0;

  return (
    <section className="campaign-codex" aria-label="Campaign Codex">
      <div className="campaign-codex-head">
        <div>
          <div className="dash-eyebrow">Campaign Codex · Curator</div>
          <h2 className="campaign-codex-title">Rules in force</h2>
          <p className="campaign-codex-summary">
            {snapshot
              ? `${officialCount} official · ${campaignCount} campaign ${campaignCount === 1 ? "change" : "changes"} · revision ${snapshot.revision}`
              : "Official rules and every campaign customization used by character creation, sheets, and the table."}
          </p>
        </div>
        <button className="chip" onClick={() => setReloadToken((token) => token + 1)} disabled={loading}>
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
      {!error && loading && !snapshot && <p className="list-empty">Reading the rules in force…</p>}
      {!error && !loading && snapshot && snapshot.pages.length === 0 && (
        <p className="list-empty">No Codex pages are connected to this campaign yet.</p>
      )}
      {!error && snapshot && snapshot.pages.length > 0 && filter.trim() && groups.length === 0 && (
        <p className="list-empty">No connected Codex pages match that filter.</p>
      )}

      {groups.length > 0 && (
        <div className="campaign-codex-groups">
          {groups.map((group) => (
            <details className="campaign-codex-group" key={group.key}>
              <summary className="campaign-codex-grouphead">
                <span>{group.label}</span>
                <span className="campaign-codex-count">{group.pages.length}</span>
              </summary>
              <div className="campaign-codex-pages">
                {group.pages.map((page) => {
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
                        <span className={`campaign-codex-badge source-${page.source}`}>
                          {page.source === "campaign" ? "Campaign" : "Official"}
                        </span>
                        <span className={`campaign-codex-badge visibility-${page.visibility}`}>
                          {page.visibility === "curator" ? "Curator only" : "Players"}
                        </span>
                        <span className={`campaign-codex-badge ${page.pulled ? "pulled" : "not-pulled"}`}>
                          {page.pulled ? "Pulled" : "Not pulled"}
                        </span>
                      </div>
                      <div className="campaign-codex-actions">
                        <button className="ghost-btn xs" onClick={() => openPage(page, campaignId, "read")}>
                          Open
                        </button>
                        <button className="primary-btn xs" onClick={() => openPage(page, campaignId, actionIntent)}>
                          {page.source === "campaign" ? "Edit" : "Customize"}
                        </button>
                      </div>
                    </article>
                  );
                })}
              </div>
            </details>
          ))}
        </div>
      )}
    </section>
  );
}
