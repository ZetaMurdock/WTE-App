import type { Campaign } from "../../models/campaign";
import type { CharacterRecord } from "../../lib/characters";
import { deleteCharacter, updateCharacter } from "../../lib/characters";
import { getSpecies, getParadigm } from "../../game/wte";
import { ConfirmButton } from "../ui/ConfirmButton";

interface Props {
  campaign: Campaign;
  characters: CharacterRecord[];
  loading: boolean;
  onNew: () => void;
  onOpen: (id: string) => void;
  onChanged: () => void;
}

export function CharacterVault({ campaign, characters, loading, onNew, onOpen, onChanged }: Props) {
  async function handleRename(c: CharacterRecord) {
    const next = prompt("Rename character", c.name);
    if (next && next.trim()) {
      await updateCharacter(c.id, { name: next.trim() });
      onChanged();
    }
  }

  async function handleDelete(c: CharacterRecord) {
    await deleteCharacter(c.id);
    onChanged();
  }

  function subtitle(c: CharacterRecord): string {
    const parts = [getSpecies(c.sheet.speciesId)?.name, getParadigm(c.sheet.paradigmId)?.name].filter(Boolean);
    return parts.join(" · ") || "No species / paradigm set";
  }

  return (
    <div className="dashboard">
      <div className="dash-header">
        <div>
          <div className="dash-eyebrow">{campaign.name}</div>
          <h1 className="dash-title">Character Vault</h1>
        </div>
        <button className="primary-btn vault-new" onClick={onNew}>
          New character
        </button>
      </div>

      {loading ? (
        <p className="list-empty">Loading…</p>
      ) : characters.length === 0 ? (
        <p className="list-empty">No characters yet — create your first Inquisitor.</p>
      ) : (
        <div className="char-grid">
          {characters.map((c) => (
            <div className="char-card" key={c.id}>
              <button className="char-open" onClick={() => onOpen(c.id)}>
                <div className="char-name">{c.name}</div>
                <div className="char-meta">{subtitle(c)}</div>
              </button>
              <div className="char-actions">
                <button className="icon-btn" onClick={() => handleRename(c)}>
                  Rename
                </button>
                <ConfirmButton
                  label="Delete"
                  confirmLabel="Delete forever"
                  title="Delete this character"
                  onConfirm={() => void handleDelete(c)}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
