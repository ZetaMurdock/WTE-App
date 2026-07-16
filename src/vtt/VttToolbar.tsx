interface Props {
  sceneName: string;
  onRename: (name: string) => void;
  tokenCount: number;
  campaignReady: boolean;
  scenesOpen: boolean;
  actorsOpen: boolean;
  encounterOpen: boolean;
  assetsOpen: boolean;
  abilitiesOpen: boolean;
  rollsOpen: boolean;
  gridOpen: boolean;
  /** Undefined disables these (no campaign → no persisted scenes / vault). */
  onToggleScenes?: () => void;
  onToggleActors?: () => void;
  onToggleEncounter?: () => void;
  onToggleAssets?: () => void;
  onToggleAbilities?: () => void;
  onToggleRolls?: () => void;
  /** Undefined hides Grid & Map (netplay players don't get Curator controls). */
  onToggleGrid?: () => void;
  syncOn: boolean;
  syncPeers: number;
}

// The slim top bar: panel toggles + scene identity. Map TOOLS live in the
// floating action bar (VttActionBar) so this stays uncluttered.
export function VttToolbar({
  sceneName,
  onRename,
  tokenCount,
  campaignReady,
  scenesOpen,
  actorsOpen,
  encounterOpen,
  assetsOpen,
  abilitiesOpen,
  rollsOpen,
  gridOpen,
  onToggleScenes,
  onToggleActors,
  onToggleEncounter,
  onToggleAssets,
  onToggleAbilities,
  onToggleRolls,
  onToggleGrid,
  syncOn,
  syncPeers,
}: Props) {
  return (
    <div className="vtt2-toolbar">
      <span className="vtt2-brand">VTT v2</span>
      <span className="vtt2-group-label">Panels</span>
      <button className={"chip" + (scenesOpen ? " active" : "")} onClick={onToggleScenes} disabled={!onToggleScenes} title="Scene browser — list, create, rename, and switch scenes">
        Scenes
      </button>
      <button className={"chip" + (actorsOpen ? " active" : "")} onClick={onToggleActors} disabled={!onToggleActors} title="Actors — spawn linked vault characters as tokens">
        Actors
      </button>
      <button className={"chip" + (encounterOpen ? " active" : "")} onClick={onToggleEncounter} disabled={!onToggleEncounter} title="Encounter — initiative, turn order, round counter, HP/status">
        Encounter
      </button>
      <button className={"chip" + (assetsOpen ? " active" : "")} onClick={onToggleAssets} disabled={!onToggleAssets} title="Assets — map backgrounds + token art">
        Assets
      </button>
      <button className={"chip" + (abilitiesOpen ? " active" : "")} onClick={onToggleAbilities} disabled={!onToggleAbilities} title="Abilities — your character's actions, abilities, and base rolls">
        Abilities
      </button>
      <button className={"chip" + (rollsOpen ? " active" : "")} onClick={onToggleRolls} disabled={!onToggleRolls} title="Roll feed — recent + live dice rolls">
        Rolls
      </button>
      {onToggleGrid && (
        <>
          <span className="vtt2-group-label">Scene</span>
          <button className={"chip" + (gridOpen ? " active" : "")} onClick={onToggleGrid} title="Grid & Map — resize the grid, fit the background">
            Grid &amp; Map
          </button>
        </>
      )}
      <span className="rank-spacer" />
      {syncOn && (
        <span className="vtt2-sync" title={`Live sync — ${syncPeers} peer${syncPeers === 1 ? "" : "s"} in the room`}>
          Live · {syncPeers}
        </span>
      )}
      <input
        className="vtt2-scene-name"
        value={sceneName}
        placeholder="Scene name"
        disabled={!campaignReady}
        onChange={(e) => onRename(e.target.value)}
      />
      <span className="vtt2-meta">{tokenCount} tokens</span>
    </div>
  );
}
