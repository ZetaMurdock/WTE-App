import { useEffect, useState } from "react";
import type { Campaign } from "../models/campaign";
import type { TabId } from "./TopBar";
import { CampaignPicker } from "./CampaignPicker";
import { listScenes } from "../vtt/data/sceneRepo";
import { CampaignDesk } from "./CampaignDesk";
import { nextSession, countDeskNotes } from "../lib/campaignDesk";

interface Props {
  loading: boolean;
  campaign: Campaign | null;
  campaigns: Campaign[];
  characterCount: number;
  /** Curator mode — unlocks GM screens (Curator notes, calendar editing). */
  curator: boolean;
  onCreate: (name: string) => void;
  onRename: (id: string, name: string) => void;
  onArchive: (id: string) => void;
  onSelect: (id: string) => void;
  onOpenTool: (tab: TabId) => void;
  onOpenCharacters: () => void;
  onSwitchCampaign: () => void;
}

export function Dashboard({
  loading,
  campaign,
  campaigns,
  characterCount,
  curator,
  onCreate,
  onRename,
  onArchive,
  onSelect,
  onOpenTool,
  onOpenCharacters,
  onSwitchCampaign,
}: Props) {
  // The campaign's active VTT v2 scene, shown on the dashboard as a shortcut in.
  // Re-fetched whenever the dashboard mounts (it re-mounts on every tab return).
  const [activeSceneName, setActiveSceneName] = useState<string | null>(null);
  // Desk summaries (localStorage-backed, so read synchronously on each mount).
  const next = campaign ? nextSession(campaign.id) : null;
  const noteCount = campaign ? countDeskNotes(campaign.id) : 0;
  useEffect(() => {
    let alive = true;
    if (!campaign) {
      setActiveSceneName(null);
      return;
    }
    listScenes(campaign.id)
      .then((all) => {
        if (!alive) return;
        const active = all.find((s) => s.active) ?? all[0] ?? null;
        setActiveSceneName(active?.name ?? null);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [campaign]);

  if (loading) {
    return (
      <div className="dashboard">
        <p className="list-empty">Loading…</p>
      </div>
    );
  }

  if (!campaign) {
    return (
      <div className="dashboard">
        <CampaignPicker
          campaigns={campaigns}
          onCreate={onCreate}
          onRename={onRename}
          onArchive={onArchive}
          onSelect={onSelect}
        />
      </div>
    );
  }

  return (
    <div className="dashboard">
      <div className="dash-header">
        <div>
          <div className="dash-eyebrow">Campaign</div>
          <h1 className="dash-title">{campaign.name}</h1>
        </div>
        <button className="ghost-btn" onClick={onSwitchCampaign}>
          Switch campaign
        </button>
      </div>

      <div className="dash-grid">
        <button className="panel panel-btn" onClick={onOpenCharacters}>
          <div className="panel-title">Characters</div>
          <div className={characterCount > 0 ? "panel-count" : "panel-empty"}>
            {characterCount > 0
              ? `${characterCount} character${characterCount === 1 ? "" : "s"} — open vault`
              : "No characters yet — create one"}
          </div>
        </button>
        <button className="panel panel-btn" onClick={() => onOpenTool("vtt2")}>
          <div className="panel-title">Active scene</div>
          <div className={activeSceneName ? "panel-count" : "panel-empty"}>
            {activeSceneName ? `${activeSceneName} — open VTT` : "No scene set — open VTT"}
          </div>
        </button>
        <button className="panel panel-btn" onClick={() => onOpenTool("codex")}>
          <div className="panel-title">Codex</div>
          <div className="panel-empty">Browse the archive</div>
        </button>
        <div className="panel">
          <div className="panel-title">Notes</div>
          <div className={noteCount > 0 ? "panel-count" : "panel-empty"}>
            {noteCount > 0 ? `${noteCount} note${noteCount === 1 ? "" : "s"} on the desk` : "No notes yet — jot below"}
          </div>
        </div>
        <div className="panel">
          <div className="panel-title">Next session</div>
          <div className={next ? "panel-count" : "panel-empty"}>
            {next ? `${next.date}${next.title ? ` · ${next.title}` : ""}` : "Not scheduled"}
          </div>
        </div>
      </div>

      <div className="dash-desk">
        <div className="dash-eyebrow">Campaign desk{curator ? " · Curator" : ""}</div>
        <CampaignDesk campaignId={campaign.id} curator={curator} />
      </div>
    </div>
  );
}
