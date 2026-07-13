import { useEffect, useState } from "react";
import type { Campaign } from "../models/campaign";
import type { TabId } from "./TopBar";
import { CampaignPicker } from "./CampaignPicker";
import { listScenes } from "../vtt/data/sceneRepo";

interface Props {
  loading: boolean;
  campaign: Campaign | null;
  campaigns: Campaign[];
  characterCount: number;
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
            {activeSceneName ? `${activeSceneName} — open VTT v2` : "No scene set — open VTT v2"}
          </div>
        </button>
        <Panel title="Recent Codex" empty="No pages opened" />
        <Panel title="Session notes" empty="No notes yet" />
        <Panel title="Next session" empty="Not scheduled" />
      </div>

      <div className="dash-launch">
        <div className="dash-eyebrow">Quick launch</div>
        <div className="launch-row">
          <button className="launch-btn" onClick={onOpenCharacters}>
            Characters
          </button>
          <button className="launch-btn" onClick={() => onOpenTool("sheet")}>
            Sheet (Legacy)
          </button>
          <button className="launch-btn" onClick={() => onOpenTool("vtt2")}>
            VTT v2
          </button>
          <button className="launch-btn" onClick={() => onOpenTool("vtt")}>
            VTT (Legacy)
          </button>
          <button className="launch-btn" onClick={() => onOpenTool("wiki")}>
            Codex
          </button>
        </div>
      </div>
    </div>
  );
}

function Panel({ title, empty }: { title: string; empty: string }) {
  return (
    <div className="panel">
      <div className="panel-title">{title}</div>
      <div className="panel-empty">{empty}</div>
    </div>
  );
}
