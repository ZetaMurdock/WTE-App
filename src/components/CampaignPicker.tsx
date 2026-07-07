import { useState, type FormEvent } from "react";
import type { Campaign } from "../models/campaign";

interface Props {
  campaigns: Campaign[];
  onCreate: (name: string) => void;
  onRename: (id: string, name: string) => void;
  onArchive: (id: string) => void;
  onSelect: (id: string) => void;
}

export function CampaignPicker({ campaigns, onCreate, onRename, onArchive, onSelect }: Props) {
  const [name, setName] = useState("");

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
    if (confirm(`Archive "${c.name}"? It will be hidden from this list.`)) onArchive(c.id);
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
    </div>
  );
}
