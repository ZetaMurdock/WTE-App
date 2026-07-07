import { useCallback, useEffect, useState } from "react";
import type { Campaign } from "../../models/campaign";
import { listCharacters, type CharacterRecord } from "../../lib/characters";
import { isTauri } from "../../lib/tauri";
import { CharacterVault } from "./CharacterVault";
import { CharacterCreator } from "./CharacterCreator";
import { CharacterSheet } from "./CharacterSheet";

type View = { mode: "vault" } | { mode: "creator" } | { mode: "sheet"; id: string };

interface Props {
  campaign: Campaign | null;
  curator: boolean;
  /** Stable callback so the Dashboard character count refreshes after mutations. */
  onCharactersChanged: () => void;
}

export function CharactersTab({ campaign, curator, onCharactersChanged }: Props) {
  const [view, setView] = useState<View>({ mode: "vault" });
  const [characters, setCharacters] = useState<CharacterRecord[]>([]);
  const [loading, setLoading] = useState(true);

  const campaignId = campaign?.id;

  const reload = useCallback(async () => {
    if (!campaignId) {
      setCharacters([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setCharacters(await listCharacters(campaignId));
    setLoading(false);
    onCharactersChanged();
  }, [campaignId, onCharactersChanged]);

  // reload + reset to the vault whenever the active campaign changes
  useEffect(() => {
    setView({ mode: "vault" });
    void reload();
  }, [reload]);

  if (!isTauri()) {
    return (
      <div className="dashboard">
        <p className="list-empty">The character vault needs the desktop app (SQLite storage).</p>
      </div>
    );
  }
  if (!campaign) {
    return (
      <div className="dashboard">
        <p className="list-empty">Select or create a campaign first (Dashboard tab).</p>
      </div>
    );
  }

  if (view.mode === "creator") {
    return (
      <CharacterCreator
        campaignId={campaign.id}
        onCancel={() => setView({ mode: "vault" })}
        onDone={async (id) => {
          await reload();
          setView(id ? { mode: "sheet", id } : { mode: "vault" });
        }}
      />
    );
  }
  if (view.mode === "sheet") {
    return (
      <CharacterSheet
        characterId={view.id}
        campaignId={campaign.id}
        curator={curator}
        onChanged={reload}
        onBack={async () => {
          await reload();
          setView({ mode: "vault" });
        }}
      />
    );
  }
  return (
    <CharacterVault
      campaign={campaign}
      characters={characters}
      loading={loading}
      onNew={() => setView({ mode: "creator" })}
      onOpen={(id) => setView({ mode: "sheet", id })}
      onChanged={reload}
    />
  );
}
