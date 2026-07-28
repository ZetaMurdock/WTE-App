import { useState, type FormEvent } from "react";
import type { Campaign } from "../models/campaign";

interface Props {
  campaigns: Campaign[];
  /** Archived campaigns, so they can be restored. Nothing in the app used to list
   *  these, which made "Archive" a permanent one-way door. */
  archived?: Campaign[];
  onCreate: (name: string) => void;
  onRename: (id: string, name: string) => void;
  onArchive: (id: string) => void;
  onUnarchive?: (id: string) => void;
  onSelect: (id: string) => void;
}

export function CampaignPicker({
  campaigns,
  archived = [],
  onCreate,
  onRename,
  onArchive,
  onUnarchive,
  onSelect,
}: Props) {
  const [name, setName] = useState("");
  const [showArchived, setShowArchived] = useState(false);

  function handleCreate(e: FormEvent) {
    e.preventDefault();
    const n = name.trim();
    if (!n) return;
    onCreate(n);
    setName("");
  }

  function handleRename(c: Campaign) {
    const next = prompt("Rename campaign", c.name);
    if (next && next.trim()) onRename(c.id, next.trim());
  }

  function handleArchive(c: Campaign) {
    // The wording is now true: archived campaigns really are restorable, from the
    // section below. Before that section existed, nothing in the app ever listed
    // them, so this said "hidden from this list" while being permanent — taking
    // every character, scene, asset and roll keyed to the campaign with it.
    if (confirm(`Archive "${c.name}"? It moves to Archived below, and you can restore it at any time.`)) {
      onArchive(c.id);
    }
  }

  return (
    <div className="picker">
      <div className="dash-eyebrow">Welcome to W.T.E</div>
      <h1 className="picker-title">Campaigns</h1>
      <p className="picker-sub">
        Create a campaign to organise characters, scenes, and codex pages — or open an existing one.
      </p>

      <form className="picker-form" onSubmit={handleCreate}>
        <input
          className="picker-input"
          type="text"
          placeholder="New campaign name…"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoFocus
        />
        <button className="primary-btn" type="submit" disabled={!name.trim()}>
          Create
        </button>
      </form>

      {campaigns.length === 0 ? (
        <p className="list-empty">No campaigns yet — create your first one above.</p>
      ) : (
        <ul className="campaign-list">
          {campaigns.map((c) => (
            <li className="campaign-item" key={c.id}>
              <button className="campaign-open" onClick={() => onSelect(c.id)}>
                {c.name}
              </button>
              <span className="campaign-meta">{new Date(c.updatedAt).toLocaleDateString()}</span>
              <button className="icon-btn" onClick={() => handleRename(c)}>
                Rename
              </button>
              <button className="icon-btn" onClick={() => handleArchive(c)}>
                Archive
              </button>
            </li>
          ))}
        </ul>
      )}

      {archived.length > 0 && (
        <div className="archived-block">
          <button className="link-btn" onClick={() => setShowArchived((v) => !v)}>
            {showArchived ? "Hide" : "Show"} archived ({archived.length})
          </button>
          {showArchived && (
            <ul className="campaign-list archived">
              {archived.map((c) => (
                <li className="campaign-item" key={c.id}>
                  <span className="campaign-open muted">{c.name}</span>
                  <span className="campaign-meta">{new Date(c.updatedAt).toLocaleDateString()}</span>
                  {onUnarchive && (
                    <button className="icon-btn" onClick={() => onUnarchive(c.id)}>
                      Restore
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
