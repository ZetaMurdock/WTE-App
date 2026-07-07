import type { Campaign } from "../models/campaign";
import type { TabId } from "./TopBar";
import { CampaignPicker } from "./CampaignPicker";

interface Props {
  loading: boolean;
  campaign: Campaign | null;
  campaigns: Campaign[];
  onCreate: (name: string) => void;
  onRename: (id: string, name: string) => void;
  onArchive: (id: string) => void;
  onSelect: (id: string) => void;
  onOpenTool: (tab: TabId) => void;
  onSwitchCampaign: () => void;
}

export function Dashboard({
  loading,
  campaign,
  campaigns,
  onCreate,
  onRename,
  onArchive,
  onSelect,
  onOpenTool,
  onSwitchCampaign,
}: Props) {
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
        <Panel title="Characters" empty="No characters yet" />
        <Panel title="Active scene" empty="No scene set" />
        <Panel title="Recent Codex" empty="No pages opened" />
        <Panel title="Session notes" empty="No notes yet" />
        <Panel title="Next session" empty="Not scheduled" />
      </div>

      <div className="dash-launch">
        <div className="dash-eyebrow">Quick launch</div>
        <div className="launch-row">
          <button className="launch-btn" onClick={() => onOpenTool("sheet")}>
            Character Sheet
          </button>
          <button className="launch-btn" onClick={() => onOpenTool("vtt")}>
            VTT
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
