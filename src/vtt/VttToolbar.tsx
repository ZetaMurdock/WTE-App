import { useSyncExternalStore } from "react";
import { getMasterVolume, setMasterVolume, subscribeMasterVolume } from "../lib/audioPrefs";

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
  /** Curator-only: session Play Mode (players collapse to tokens + rolls). */
  play?: { on: boolean; range: number; onToggle: () => void; onRange: (v: number) => void };
  /** Curator-only: preview the table exactly as a player sees it. */
  preview?: { on: boolean; onToggle: () => void };
  /** Curator-only: the Cinematic director's booth (camera lock + screen FX). */
  cine?: { on: boolean; open: boolean; onToggle: () => void };
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
  play,
  preview,
  cine,
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
      {(play || preview) && <span className="vtt2-group-label">Session</span>}
      {play && (
        <button
          className={"chip" + (play.on ? " active" : "")}
          onClick={play.onToggle}
          title="Play Mode — players' UI collapses to token movement + rolls; their camera follows their token"
        >
          {play.on ? "◼ End play" : "▶ Play"}
        </button>
      )}
      {play?.on && (
        <label className="vtt2-play-range" title="How far players can zoom out while playing (100% = normal camera)">
          View
          <input type="range" min={0.1} max={1} step={0.05} value={play.range} onChange={(e) => play.onRange(parseFloat(e.target.value))} />
          {Math.round(play.range * 100)}%
        </label>
      )}
      {preview && (
        <button
          className={"chip" + (preview.on ? " active" : "")}
          onClick={preview.onToggle}
          title="See the table exactly as a player does — fog, hidden walls and lights, player tools"
        >
          Player view
        </button>
      )}
      {cine && (
        <button
          className={"chip" + (cine.open || cine.on ? " active" : "")}
          onClick={cine.onToggle}
          title="Cinematic — lock players' cameras on a token, shake the frame, run screen effects"
        >
          {cine.on ? "● Cinematic" : "Cinematic"}
        </button>
      )}
      <span className="rank-spacer" />
      <MasterVolume />
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

/** One slider for EVERYTHING this device plays: scene music, table sfx,
 *  spatial emitters. Per-device — it never affects what others hear. */
function MasterVolume() {
  const vol = useSyncExternalStore(subscribeMasterVolume, getMasterVolume);
  return (
    <label className="vtt2-vol" title="Master volume — music, table sounds, and spatial audio on this device">
      <span className="vtt2-vol-label">Vol</span>
      <input type="range" min={0} max={1} step={0.02} value={vol} onChange={(e) => setMasterVolume(parseFloat(e.target.value))} />
    </label>
  );
}
