import { useCodex } from "../game/useCodex";
import { AtlasWindow, type AtlasFocus } from "./atlas/AtlasWindow";
import { loadAtlas } from "./atlas/atlasRepo";
import { atlasForRole, MAX_ATLAS_WIRE_CHARS } from "./atlas/atlasModel";
import { bridgeEmit, bridgeListen, focusAtlasWindow, openAtlasWindow } from "./atlas/atlasBridge";
import { listRuleLayers } from "../lib/ruleLayerRepo";
import type { RuleLayer } from "../game/ruleLayers";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { Campaign } from "../models/campaign";
import { isTauri } from "../lib/tauri";
import { PixiVttApp, peerInkColor, type VttSelection } from "./engine/PixiVttApp";
import { listScenes, saveScene, getScene, setActiveScene, deleteScene } from "./data/sceneRepo";
import { newId, newScene, type VttScene, type VttToken, type VttZoneKind } from "./types/scene";
import type { VttTool } from "./types/tool";
import { VttToolbar } from "./VttToolbar";
import { VttActionBar } from "./VttActionBar";
import { VttGridPanel } from "./VttGridPanel";
import { VttSceneWheel } from "./VttSceneWheel";
import { VttRadialMenu } from "./VttRadialMenu";
// NOTE: The 3D view (engine3d/ThreeVttView) is VAULTED — the 2D top-down
// perspective is the standard and all scene modifications render there. The
// class file is kept on disk but is no longer instantiated from the screen.
import { VttInspector } from "./VttInspector";
import { useNet } from "../net/NetContext";
import {
  asRollResultMessage,
  type NetMessage,
  type RollMessage,
  type NetRollMode,
  type RollModeDecisionMessage,
  type RollModeRequestMessage,
  type RollRequestMessage,
  type RollResultMessage,
  type VttMoveRequestMessage,
} from "../net/protocol";
import { addSessionRoll, clearSessionRolls, rollSessionScope } from "./sync/rollSession";
import { logRoll, validateCompletedRoll } from "../lib/rolls";
import { resolveStatToken, rollMod, specRollMod } from "../game/wte";
import { SfxPlayer } from "./audio/sfxPlayer";
import { getMasterVolume, subscribeMasterVolume } from "../lib/audioPrefs";
import { reportSaveFailure, pushToast } from "../lib/appToast";
import { VttCinePanel, type CineConfig } from "./VttCinePanel";
import { VttSceneBrowser } from "./VttSceneBrowser";
import { VttActorsPanel } from "./VttActorsPanel";
import { VttEncounterPanel } from "./VttEncounterPanel";
import { VttRollFeed, type RollLock } from "./VttRollFeed";
import { VttAssetPanel } from "./VttAssetPanel";
import { VttSoundboard } from "./VttSoundboard";
import { VttDialogue } from "./VttDialogue";
import { VttDialogueController } from "./VttDialogueController";
import { VttAbilitiesPanel, type VttTargetRollIntent } from "./VttAbilitiesPanel";
import { VttRollToast } from "./VttRollToast";
import { VttAoePrompt, type AoePlacement, type AoeKind } from "./VttAoePrompt";
import { hasAoe } from "./data/effectMeta";
import { tokenInEdge, arrivalPos } from "./data/sceneLinks";
import type { VttAbility } from "./data/characterAbilities";
import { CharacterSheet } from "../components/characters/CharacterSheet";
import { listCharacters, getCharacter, upsertCharacter, type CharacterRecord } from "../lib/characters";
import {
  applyRemoteSheet,
  getPartySheets,
  pruneOwners,
  shouldBroadcastSheet,
  subscribePartySheets,
} from "./sync/partySheets";
import { characterToTokenSpec, creatureToTokenSpec, parseSpawnPayload } from "./data/actorSpawn";
import { listCreatures, computeCreature } from "../lib/codex";
import type { Creature } from "../models/codex";
import { listQuickCreatures, saveQuickCreature, deleteQuickCreature, type QuickCreature } from "./data/quickCreatures";
import { listAssets, addAsset, deleteAsset, type AssetKind, type VttAsset } from "./data/assetRepo";
import { useVttSync } from "./sync/vttSync";
import { applyOp, foreignOpAllowed, type VttOp } from "./sync/patches";
import { fileToPngDataUrl } from "../lib/image";
import { validateMoveAuthority } from "./sync/moveAuthority";
import {
  customizeCanonicalCharacterToken,
  ensureCanonicalCharacterToken,
  findNearestAvailableTokenPosition,
  loadTokenRegistry,
  migrateLegacyCharacterTokens,
  saveTokenRegistry,
  transferCanonicalCharacterToken,
  type TokenRegistryState,
} from "./data/tokenRegistry";
import { vttSnapshotFits } from "./sync/wireBudget";

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error("read failed"));
    r.readAsDataURL(file);
  });
}

function diceModSuffix(value: number): string {
  return value > 0 ? `+${value}` : value < 0 ? String(value) : "";
}

function requestedStatExpr(record: CharacterRecord, stat?: string): string {
  const resolved = stat ? resolveStatToken(stat) : null;
  if (resolved?.kind === "attr") {
    const value = (record.sheet.attributes as unknown as Record<string, number>)[resolved.key] ?? 0;
    return `1d20${diceModSuffix(rollMod(value))}`;
  }
  if (resolved?.kind === "spec") {
    const value = (record.sheet.specialties as unknown as Record<string, number>)[resolved.key] ?? 0;
    return `1d40${diceModSuffix(specRollMod(value))}`;
  }
  return "1d20";
}

// VTT v2 (slice 1): Pixi renders the map; React owns the chrome. Beside the
// legacy VTT, not inside it — see the rework spec in docs/ / session notes.
export function VttScreen({ campaign: localCampaign, active = true }: { campaign: Campaign | null; active?: boolean }) {
  const net = useNet();
  const isNetPlayer = net.status === "connected" && net.role === "player";
  // A joined player is working in the Curator's table namespace, even when a
  // different local campaign happens to be selected on their dashboard.
  const campaign = useMemo<Campaign | null>(() => {
    if (!isNetPlayer || !net.table?.campaignId) return localCampaign;
    return {
      id: net.table.campaignId,
      name: net.table.campaignName || "Curator's table",
      // Table-link bookkeeping (purse/inventory/lastSeen) must not create a
      // new campaign identity and tear down an already-received VTT snapshot.
      createdAt: 0,
      updatedAt: 0,
      archived: false,
    };
  }, [isNetPlayer, localCampaign, net.table?.campaignId, net.table?.campaignName]);
  const campaignIdRef = useRef<string | null>(campaign?.id ?? null);
  campaignIdRef.current = campaign?.id ?? null;
  const campaignLoadEpoch = useRef(0);
  const canPersistRef = useRef(!isNetPlayer);
  canPersistRef.current = !isNetPlayer;
  // A campaign override loading after the table opened must reach the action
  // lists, exactly as it reaches the sheet. Without this the VTT kept whatever
  // the Codex held when the screen first mounted.
  useCodex();
  // Campaign rule layers, loaded once per campaign. The table must charge the
  // same SS the contextual card explains.
  const [ruleLayers, setRuleLayers] = useState<RuleLayer[]>([]);
  useEffect(() => {
    const id = campaign?.id;
    if (!id) {
      setRuleLayers([]);
      return;
    }
    let live = true;
    listRuleLayers(id)
      .then((ls) => live && setRuleLayers(ls))
      .catch(() => live && setRuleLayers([]));
    return () => {
      live = false;
    };
  }, [campaign?.id]);
  const hostRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<PixiVttApp | null>(null);
  const saveTimer = useRef<number | undefined>(undefined);
  const [scene, setScene] = useState<VttScene | null>(null);
  const [scenes, setScenes] = useState<VttScene[]>([]);
  const scenesRef = useRef<VttScene[]>([]);
  scenesRef.current = scenes;
  const tokenRegistryRef = useRef<TokenRegistryState | null>(null);
  const registryOpRef = useRef<(op: VttOp) => void>(() => {});
  const registrySaveQueue = useRef<Promise<void>>(Promise.resolve());
  const saveTokenRegistryOrdered = useCallback((state: TokenRegistryState): Promise<void> => {
    // Appearance edits, portal transfers, spawns, and scene deletion can land
    // within milliseconds of one another. Preserve invocation order so a slow
    // older write can never restore a stale presence/profile over a newer one.
    const task = registrySaveQueue.current.catch(() => {}).then(() => saveTokenRegistry(state));
    registrySaveQueue.current = task.catch(() => {});
    return task;
  }, []);
  // The left dock shows at most one panel at a time.
  const [leftPanel, setLeftPanel] = useState<"scenes" | "actors" | "encounter" | "assets" | "abilities" | null>(null);
  const [abilityCharId, setAbilityCharId] = useState<string | null>(null);
  const [pendingAoe, setPendingAoe] = useState<VttAbility | null>(null);
  // A soundboard clip armed for click-to-place as a spatial emitter.
  const [armedSound, setArmedSound] = useState<{ name: string; src: string } | null>(null);
  const [armedAoe, setArmedAoe] = useState<{ kind: AoeKind; cells: number; rounds: number } | null>(null);
  const [rollsOpen, setRollsOpen] = useState(false);
  const [atlasOpen, setAtlasOpen] = useState(false);
  const [atlasFocus, setAtlasFocus] = useState<AtlasFocus | null>(null);
  const atlasFocusNonce = useRef(0);
  // The Atlas popped out into its own OS window. While it exists the inline
  // window stays closed, and this screen proxies its netplay traffic — the
  // WebRTC session lives here, not in the popped webview.
  const [atlasPopped, setAtlasPopped] = useState(false);
  const atlasPoppedRef = useRef(false);
  atlasPoppedRef.current = atlasPopped;
  const [characters, setCharacters] = useState<CharacterRecord[]>([]);
  const [charsLoading, setCharsLoading] = useState(false);
  const [gridOpen, setGridOpen] = useState(false);
  const [soundboardOpen, setSoundboardOpen] = useState(false);
  const [dialogueOpen, setDialogueOpen] = useState(false);
  // A character sheet opened as an overlay from the Actors panel (players view
  // their own character in the VTT; the Curator can open any). sheetSyncTick
  // remounts the overlay when a live edit arrives for the open character.
  const [sheetCharId, setSheetCharId] = useState<string | null>(null);
  const [sheetSyncTick, setSheetSyncTick] = useState(0);
  const sheetCharIdRef = useRef<string | null>(null);
  sheetCharIdRef.current = sheetCharId;
  // Live registry of sheets other players have shared into the room.
  const partySheets = useSyncExternalStore(subscribePartySheets, getPartySheets);
  // Scene-wheel right-click actions: the file pickers target a specific scene id,
  // and every setting is written to THAT scene only (nothing transfers).
  const sceneBgRef = useRef<HTMLInputElement>(null);
  const sceneMusicRef = useRef<HTMLInputElement>(null);
  const menuTarget = useRef<string | null>(null);
  const audioRef = useRef<HTMLAudioElement>(null);

  /** Patch a scene's data wherever it lives: the live engine scene, or storage. */
  const patchScene = useCallback(
    async (id: string, patch: (s: VttScene) => void) => {
      const eng = engineRef.current;
      try {
        if (eng?.scene?.id === id) {
          patch(eng.scene);
          eng.redraw();
          eng.onChanged();
          await saveScene(eng.scene);
        } else if (pinnedRef.current === id) {
          const task = pinnedQueue.current.catch(() => {}).then(async () => {
            let working = pinnedLive.current;
            if (!working || working.id !== id) {
              working = await getScene(id);
              if (!working || pinnedRef.current !== id) return;
              pinnedLive.current = working;
            }
            patch(working);
            await saveScene(working);
          });
          pinnedQueue.current = task;
          await task;
        } else {
          const stored = await getScene(id);
          if (!stored) return;
          patch(stored);
          await saveScene(stored);
        }
      } catch (e) {
        pushToast(`Couldn't update the scene — ${e instanceof Error ? e.message : String(e)}`, "error", 0);
        return;
      }
      // refresh the wheel's copies (music badge, names)
      if (campaign) {
        const targetCampaignId = campaign.id;
        const refreshed = await listScenes(targetCampaignId).catch(() => [] as VttScene[]);
        if (campaignIdRef.current === targetCampaignId) setScenes(refreshed);
      }
    },
    [campaign?.id]
  );

  async function onSceneBgFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    const id = menuTarget.current;
    if (!f || !id) return;
    const uri = await fileToPngDataUrl(f, 4096, 16 * 1024 * 1024).catch((error) => {
      pushToast(error instanceof Error ? error.message : "That map image could not be encoded.", "error");
      return null;
    });
    if (uri) await patchScene(id, (s) => {
      const projected = { ...s, data: { ...s.data, background: { ...s.data.background, src: uri } } };
      if (!vttSnapshotFits(projected)) throw new Error("That map would make the scene too large for players to receive.");
      s.data.background.src = uri;
    });
  }
  async function onSceneMusicFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    const id = menuTarget.current;
    if (!f || !id) return;
    if (f.size > 16 * 1024 * 1024) {
      pushToast("Scene audio must be 16 MB or smaller — netplay carries at most 24 MB in one message.", "error");
      return;
    }
    const uri = await fileToDataUrl(f).catch(() => null);
    if (uri) await patchScene(id, (s) => {
      const audio = { src: uri, volume: 0.5 };
      if (!vttSnapshotFits({ ...s, data: { ...s.data, audio } })) {
        throw new Error("That audio would make the scene too large for players to receive.");
      }
      s.data.audio = audio;
    });
  }
  // Shader-compile feedback surfaced by the Grid panel's atmosphere controls.
  const [shaderError, setShaderError] = useState("");
  // Per-campaign Curator claim: only joining someone else's netplay room as a
  // player demotes you — hide Curator-only scene controls there.
  // Players see the scene name on their Table tab without opening the VTT.
  const sceneNameForNet = scene?.name ?? "";
  useEffect(() => {
    if (net.status === "connected" && net.role === "host") net.announceScene(sceneNameForNet);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sceneNameForNet, net.status, net.role]);

  // Curator PLAYER VIEW: preview the table exactly as a player would see it —
  // walls/lights hidden, fog from the viewed peer's tokens, builder UI gone.
  // `previewAs` holds the peer id being impersonated (own id when solo).
  const [previewAs, setPreviewAs] = useState<string | null>(null);
  // Every UI gate below uses asPlayer (real player OR Curator previewing);
  // netplay AUTHORITY (sheet sync, portals, owner stamps) stays on isNetPlayer.
  const asPlayer = isNetPlayer || previewAs != null;
  const viewId = isNetPlayer ? net.selfId : previewAs ?? net.selfId;

  // Play Mode (Curator toggle, synced): players lose the chrome — token
  // movement + rolls only — and their camera locks to their own token.
  const [playMode, setPlayModeState] = useState({ on: false, range: 0.35 });
  const setPlayMode = useCallback(
    (next: { on: boolean; range: number }) => {
      setPlayModeState(next);
      if (net.status === "connected" && net.role === "host") net.publish({ t: "play-mode", on: next.on, range: next.range });
    },
    [net]
  );
  useEffect(() => {
    return net.subscribe("play-mode", (m, from) => {
      if (from === net.selfId) return;
      const hostId = peersRef.current.find((p) => p.role === "host")?.id;
      if (from !== hostId) return;
      const pm = m as Extract<NetMessage, { t: "play-mode" }>;
      setPlayModeState({ on: pm.on, range: pm.range });
    });
  }, [net.subscribe, net.selfId]);
  // The Curator Atlas over the wire. The host answers atlas-request whispers
  // even while their own Atlas window is closed — the campaign store is the
  // source, and only the role-FILTERED document ever leaves this machine.
  const atlasReqAt = useRef(new Map<string, number>());
  const atlasTooBigToastAt = useRef(0);
  // Serve the role-filtered Atlas from the campaign store: targeted (a
  // player's request) or broadcast (a popped-out curator window just saved).
  const serveAtlas = useRef<(to?: string) => void>(() => {});
  serveAtlas.current = (to?: string) => {
    if (net.status !== "connected" || net.role !== "host") return;
    const cid = campaignIdRef.current;
    if (!cid) return;
    void loadAtlas(cid).then(({ doc, refused }) => {
      // A refused load yields an EMPTY placeholder — serving that would
      // present a blank world as authoritative. Silence lets the player's
      // retry find us after the store recovers.
      if (refused) return;
      const msg = { t: "atlas" as const, doc: atlasForRole(doc, "player") };
      if (JSON.stringify(msg).length > MAX_ATLAS_WIRE_CHARS) {
        const nowT = Date.now();
        if (nowT - atlasTooBigToastAt.current > 60_000) {
          atlasTooBigToastAt.current = nowT;
          pushToast("A player asked for the Atlas, but it is too large to send (over 20 MB). Use a smaller map image or smaller sprites.", "error");
        }
        return;
      }
      net.publish(msg, to);
    });
  };
  useEffect(() => {
    if (net.status !== "connected" || net.role !== "host") return;
    return net.subscribe("atlas-request", (_m, from) => {
      // Players retry politely every 4s; anything faster is not a player.
      const nowT = Date.now();
      if (nowT - (atlasReqAt.current.get(from) ?? 0) < 2000) return;
      atlasReqAt.current.set(from, nowT);
      serveAtlas.current(from);
    });
  }, [net.subscribe, net.status, net.role]);
  // The main-window side of the pop-out bridge: do wire work the popped
  // webview cannot (it has no session), in both directions.
  useEffect(() => {
    if (!atlasPopped) return;
    return bridgeListen((m) => {
      if (m.kind === "saved") {
        serveAtlas.current(); // broadcast, if hosting
      } else if (m.kind === "want") {
        const hostId = peersRef.current.find((p) => p.role === "host")?.id;
        if (net.status === "connected" && net.role === "player" && hostId) net.publish({ t: "atlas-request" }, hostId);
      } else if (m.kind === "bring") {
        if (net.status === "connected" && net.role === "host") {
          net.publish({ t: "atlas-focus", x: m.x, y: m.y, zoom: m.zoom, label: m.label }, m.to);
        }
      } else if (m.kind === "hello") {
        if (net.status === "connected" && net.role === "host") {
          bridgeEmit({ kind: "peers", players: peersRef.current.filter((pr) => pr.role === "player").map((pr) => ({ id: pr.id, name: pr.name })) });
        }
      }
    });
  }, [atlasPopped, net.publish, net.status, net.role]);
  // Popped + joined: the host's documents arrive on THIS session — forward them.
  useEffect(() => {
    if (!atlasPopped || net.status !== "connected" || net.role !== "player") return;
    return net.subscribe("atlas", (m, from) => {
      const hostId = peersRef.current.find((pr) => pr.role === "host")?.id;
      if (from !== hostId) return;
      bridgeEmit({ kind: "netDoc", doc: (m as Extract<NetMessage, { t: "atlas" }>).doc });
    });
  }, [atlasPopped, net.subscribe, net.status, net.role]);
  // Popped + hosting: keep the popped window's BRING roster current.
  useEffect(() => {
    if (!atlasPopped || net.status !== "connected" || net.role !== "host") return;
    bridgeEmit({ kind: "peers", players: net.peers.filter((pr) => pr.role === "player").map((pr) => ({ id: pr.id, name: pr.name })) });
  }, [atlasPopped, net.peers, net.status, net.role]);
  // BROADCAST VIEW: the Curator flies this player's Atlas somewhere. The window
  // opens if it was closed — a cartographic update is not an ignorable ping.
  useEffect(() => {
    if (net.status !== "connected" || net.role !== "player") return;
    return net.subscribe("atlas-focus", (m, from) => {
      const hostId = peersRef.current.find((p) => p.role === "host")?.id;
      if (from !== hostId) return;
      const f = m as Extract<NetMessage, { t: "atlas-focus" }>;
      if (!Number.isFinite(f.x) || !Number.isFinite(f.y)) return;
      const zoom = typeof f.zoom === "number" && Number.isFinite(f.zoom) ? f.zoom : undefined;
      const label = typeof f.label === "string" ? f.label.slice(0, 80) : undefined;
      if (atlasPoppedRef.current) {
        // The Atlas lives in its own OS window right now — fly THAT, and
        // surface it.
        bridgeEmit({ kind: "focus", x: f.x, y: f.y, zoom, label });
        focusAtlasWindow();
        return;
      }
      setAtlasOpen(true);
      setAtlasFocus({ x: f.x, y: f.y, zoom, label, nonce: ++atlasFocusNonce.current });
    });
  }, [net.subscribe, net.status, net.role]);
  // Cinematic Mode (Curator-directed): synced like play-mode, applied by the engine.
  const [cine, setCineState] = useState<CineConfig>({ on: false });
  const [cineOpen, setCineOpen] = useState(false);
  const setCine = useCallback(
    (next: CineConfig) => {
      setCineState(next);
      engineRef.current?.setCinematic(next.on, next);
      if (net.status === "connected" && net.role === "host") {
        net.publish({ t: "cine", on: next.on, tokenId: next.tokenId, glsl: next.glsl, shake: next.shake });
      }
    },
    [net]
  );
  useEffect(() => {
    return net.subscribe("cine", (m, from) => {
      if (from === net.selfId) return;
      const hostId = peersRef.current.find((p) => p.role === "host")?.id;
      if (from !== hostId) return;
      const c = m as Extract<NetMessage, { t: "cine" }>;
      const next: CineConfig = { on: c.on, tokenId: c.tokenId, glsl: c.glsl, shake: c.shake };
      setCineState(next);
      engineRef.current?.setCinematic(next.on, next);
    });
  }, [net.subscribe, net.selfId]);

  // Late joiners land mid-session: the host repeats the current play state.
  const playModeRef = useRef(playMode);
  playModeRef.current = playMode;
  const cineRef = useRef(cine);
  cineRef.current = cine;
  const prevPeerCount = useRef(0);
  useEffect(() => {
    const grew = net.peers.length > prevPeerCount.current;
    prevPeerCount.current = net.peers.length;
    if (grew && net.role === "host" && net.status === "connected") {
      if (playModeRef.current.on) net.publish({ t: "play-mode", on: true, range: playModeRef.current.range });
      const c = cineRef.current;
      if (c.on) net.publish({ t: "cine", on: true, tokenId: c.tokenId, glsl: c.glsl, shake: c.shake });
    }
  }, [net.peers, net.role, net.status, net]);
  // The whole player chrome collapses while playing OR during a cinematic
  // (Curator keeps theirs unless previewing player view).
  const playHidden = (playMode.on || cine.on) && asPlayer;

  // Player perspective: fog reveals only from the player's OWN tokens (GM sees
  // all). Runs every render so it tracks role/selection changes in the 2D view.
  useEffect(() => {
    engineRef.current?.setPlayerView(asPlayer, viewId, isNetPlayer);
  });
  useEffect(() => {
    engineRef.current?.setPlayCam(playMode.on, playMode.range);
  }, [playMode]);

  // Joining a room as a player (or entering play mode) drops any scene-builder
  // tool still in hand; play mode pins players to Select. Curator-only panels
  // close too — a stale open Scene Studio would leak builder UI into the view.
  useEffect(() => {
    if (asPlayer && tool !== "select" && tool !== "pan" && tool !== "measure") setTool("select");
    if (playHidden && tool !== "select") setTool("select");
    if (asPlayer) {
      setGridOpen(false);
      setLeftPanel((p) => (p === "scenes" || p === "encounter" || p === "assets" ? null : p));
    }
    if (playHidden) setLeftPanel((p) => (p === "abilities" ? p : null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asPlayer, playHidden]);

  // Capture EVERY party roll into the durable session store at this always-mounted
  // level — even while the roll tray is closed — so opening the tray never loses
  // the shared history. (The tray used to hold the only `roll` listener and dropped
  // it on close, which is why the dice roller appeared to reset over a session.)
  const peersRef = useRef(net.peers);
  peersRef.current = net.peers;
  const rollScope = campaign ? rollSessionScope(campaign.id, net.status === "connected" ? net.room : null) : null;
  useEffect(() => {
    return () => {
      if (rollScope) clearSessionRolls(rollScope);
    };
  }, [rollScope]);
  useEffect(() => {
    if (!rollScope || !campaign || net.status !== "connected") return;
    return net.subscribe("roll", (raw, from) => {
      if (from === net.selfId) return;
      const wire = raw as RollMessage;
      const validated = validateCompletedRoll(wire);
      if (!validated) return;

      const hostId = net.role === "host"
        ? net.selfId
        : peersRef.current.find((peer) => peer.role === "host")?.id;

      // Players only display Curator-authored commits. Player broadcasts are
      // delivered to the host for validation and are never trusted peer-to-peer.
      if (net.role !== "host") {
        if (!hostId || from !== hostId) return;
        const who = wire.actor?.name || "Curator";
        addSessionRoll(rollScope, {
          ...validated,
          who,
          at: Number.isFinite(wire.at) ? Number(wire.at) : Date.now(),
          characterId: wire.actor?.characterId,
          tokenId: wire.actor?.tokenId,
          requestId: wire.requestId,
        });
        return;
      }

      // Requested rolls have their own one-time correlation channel below.
      if (wire.requestId) return;
      const peer = peersRef.current.find((candidate) => candidate.id === from && candidate.role === "player");
      if (!peer) return;
      const characterId = typeof wire.actor?.characterId === "string" && wire.actor.characterId.length <= 128
        ? wire.actor.characterId
        : undefined;
      const tokenId = typeof wire.actor?.tokenId === "string" && wire.actor.tokenId.length <= 128
        ? wire.actor.tokenId
        : undefined;
      if (tokenId && !characterId) return;

      if (characterId) {
        const liveToken = [
          ...(engineRef.current?.scene?.data.tokens ?? []),
          ...(pinnedLive.current?.data.tokens ?? []),
        ].find((token) =>
          token.characterId === characterId && token.owner === from &&
          (!tokenId || token.id === tokenId)
        );
        const registry = tokenRegistryRef.current;
        const registryOwned = registry?.profiles[characterId]?.controllerId === from &&
          (!tokenId || registry.presences[characterId]?.tokenId === tokenId);
        const sheetOwned = !tokenId && partySheets.some((entry) =>
          entry.record.id === characterId && entry.ownerId === from
        );
        if (!liveToken && !registryOwned && !sheetOwned) return;
      }

      const actorName = characterId
        ? characters.find((record) => record.id === characterId)?.name ||
          partySheets.find((entry) => entry.record.id === characterId)?.record.name || peer.name
        : peer.name;
      const at = Date.now();
      const accepted: RollMessage = {
        t: "roll",
        ...validated,
        at,
        actor: { peerId: from, characterId, tokenId, name: actorName },
      };
      addSessionRoll(rollScope, {
        ...validated,
        who: actorName,
        at,
        characterId,
        tokenId,
      });
      void logRoll(
        campaign.id,
        characterId ?? null,
        { formula: validated.formula, result: validated.result, detail: validated.detail },
        { id: validated.id, at, baseExpr: validated.baseExpr, actorName, tokenId, mode: validated.mode }
      );
      net.publish(accepted);
    });
  }, [campaign, characters, net.publish, net.role, net.selfId, net.status, net.subscribe, partySheets, rollScope]);

  // PING — double-click "look here", every peer sees the pulse in your ink.
  const pingOutRef = useRef<(x: number, y: number) => void>(() => {});
  pingOutRef.current = (x, y) => {
    if (net.status === "connected") net.publish({ t: "vtt-ping", x, y });
  };
  useEffect(() => {
    return net.subscribe("vtt-ping", (m, from) => {
      if (from === net.selfId) return;
      const p = m as Extract<NetMessage, { t: "vtt-ping" }>;
      const hostId = peersRef.current.find((x) => x.role === "host")?.id;
      engineRef.current?.showPing(p.x, p.y, peerInkColor(from, from === hostId));
    });
  }, [net.subscribe, net.selfId]);

  // Table audio: the Curator's soundboard reaches everyone. Always-mounted so a
  // clip lands even with every panel closed; self is skipped (the sender's own
  // soundboard already plays locally) and only the HOST may drive table audio.
  const sfxRef = useRef<SfxPlayer | null>(null);
  useEffect(() => {
    return net.subscribe("sfx", (m, from) => {
      if (from === net.selfId) return;
      const hostId = peersRef.current.find((p) => p.role === "host")?.id;
      if (from !== hostId) return;
      if (!sfxRef.current) sfxRef.current = new SfxPlayer();
      sfxRef.current.apply(m as Extract<NetMessage, { t: "sfx" }>);
    });
  }, [net.subscribe, net.selfId]);
  // Leaving the VTT (or the room) silences anything still looping.
  useEffect(() => {
    return () => sfxRef.current?.stopAll();
  }, []);

  // Armed roll context — the Abilities panel LOCKS a labeled roll (with the
  // ability's own dice pre-filled) into the tray; the player presses Roll there.
  const [rollLocks, setRollLocks] = useState<RollLock[]>([]);
  const rollLock = rollLocks[0] ?? null;
  const pendingRollRequests = useRef(new Map<string, { request: RollRequestMessage; ownerPeerId: string; expectedBaseExpr?: string }>());
  const queueRollLock = useCallback((lock: RollLock) => {
    setRollLocks((current) => {
      if (lock.requestId && current.some((item) => item.requestId === lock.requestId)) return current;
      return [...current, lock];
    });
    setRollsOpen(true);
  }, []);
  const armRoll = useCallback((label: string, expr?: string) => {
    queueRollLock({ label, expr });
  }, [queueRollLock]);

  // A targeted save/check is armed only on the intended player's bound
  // character. The modifier is resolved from that player's current sheet.
  useEffect(() => {
    if (!isNetPlayer || !campaign) return;
    return net.subscribe("roll-request", (raw, from) => {
      const request = raw as RollRequestMessage;
      const hostId = peersRef.current.find((peer) => peer.role === "host")?.id;
      if (
        from !== hostId || request.targetPeerId !== net.selfId ||
        request.targetCharacterId !== net.table?.inUseCharacterId ||
        (request.expiresAt != null && request.expiresAt < Date.now())
      ) return;
      const token = request.targetTokenId
        ? engineRef.current?.scene?.data.tokens.find((candidate) => candidate.id === request.targetTokenId)
        : undefined;
      if (request.targetTokenId && (!token || token.owner !== net.selfId || token.characterId !== request.targetCharacterId)) return;
      void getCharacter(request.targetCharacterId).then((record) => {
        if (!record || record.campaignId !== campaign.id) return;
        if (request.expiresAt != null && request.expiresAt < Date.now()) return;
        queueRollLock({
          label: request.label,
          expr: requestedStatExpr(record, request.stat),
          requestId: request.requestId,
          requestedBy: peersRef.current.find((peer) => peer.id === from)?.name || "Curator",
          dc: request.dc,
        });
      });
    });
  }, [campaign, isNetPlayer, net.selfId, net.subscribe, net.table?.inUseCharacterId, queueRollLock]);

  // The host consumes a request exactly once, validates actor correlation, then
  // publishes the accepted result to the room under the player's identity.
  useEffect(() => {
    if (!campaign || net.role !== "host") return;
    return net.subscribe("roll-result", (raw, from) => {
      const result = raw as RollResultMessage;
      const pending = pendingRollRequests.current.get(result.requestId);
      if (!pending || pending.ownerPeerId !== from) return;
      const request = pending.request;
      if (request.expiresAt != null && request.expiresAt < Date.now()) {
        pendingRollRequests.current.delete(result.requestId);
        return;
      }
      const validated = validateCompletedRoll(result);
      if (
        !validated ||
        result.actor.characterId !== request.targetCharacterId ||
        result.actor.tokenId !== request.targetTokenId ||
        (pending.expectedBaseExpr != null && validated.baseExpr !== pending.expectedBaseExpr)
      ) return;
      pendingRollRequests.current.delete(result.requestId);
      const at = Date.now();
      const actorName = characters.find((record) => record.id === result.actor.characterId)?.name ||
        peersRef.current.find((peer) => peer.id === from)?.name || "Player";
      const accepted: RollMessage = {
        t: "roll",
        ...validated,
        requestId: result.requestId,
        at,
        actor: { ...result.actor, peerId: from, name: actorName },
      };
      if (rollScope) {
        addSessionRoll(rollScope, {
          id: validated.id,
          who: actorName,
          label: validated.label,
          formula: validated.formula,
          result: validated.result,
          at,
          characterId: result.actor.characterId,
          tokenId: result.actor.tokenId,
          requestId: result.requestId,
          baseExpr: validated.baseExpr,
          mode: validated.mode,
          detail: validated.detail,
        });
      }
      void logRoll(
        campaign.id,
        result.actor.characterId,
        {
          formula: validated.formula,
          result: validated.result,
          detail: validated.detail,
        },
        {
          id: validated.id,
          at,
          baseExpr: validated.baseExpr,
          actorName,
          tokenId: result.actor.tokenId,
          requestId: result.requestId,
          mode: validated.mode,
        }
      );
      net.publish(accepted);
    });
  }, [campaign, characters, net.publish, net.role, net.subscribe, rollScope]);

  const publishVttRoll = useCallback(
    (message: RollMessage) => {
      const requested = asRollResultMessage(message);
      if (requested && isNetPlayer) {
        const hostId = peersRef.current.find((peer) => peer.role === "host")?.id;
        if (hostId) net.publish(requested, hostId);
        else pushToast("The requested roll could not reach the Curator.", "error");
        return;
      }
      if (net.status === "connected") net.publish(message);
    },
    [isNetPlayer, net]
  );

  const modeApprovals = useRef(new Map<string, (accepted: boolean) => void>());
  useEffect(() => net.subscribe("roll-mode-decision", (raw, from) => {
    if (!isNetPlayer) return;
    const hostId = peersRef.current.find((peer) => peer.role === "host")?.id;
    if (from !== hostId) return;
    const decision = raw as RollModeDecisionMessage;
    const resolve = modeApprovals.current.get(decision.requestId);
    if (!resolve) return;
    modeApprovals.current.delete(decision.requestId);
    resolve(decision.accepted);
    pushToast(decision.accepted ? "The Curator approved the roll posture." : "The Curator declined the roll posture.", decision.accepted ? "info" : "error");
  }), [isNetPlayer, net.subscribe]);

  useEffect(() => net.subscribe("roll-mode-request", (raw, from) => {
    if (net.role !== "host") return;
    const peer = peersRef.current.find((candidate) => candidate.id === from && candidate.role === "player");
    if (!peer) return;
    const request = raw as RollModeRequestMessage;
    const posture = request.mode.startsWith("double-") ? `Double ${request.mode.endsWith("adv") ? "Advantage" : "Disadvantage"}` : request.mode === "adv" ? "Advantage" : "Disadvantage";
    const accepted = window.confirm(`${request.actorName || peer.name} wants to roll ${request.label} with ${posture}. Accept?`);
    net.publish({ t: "roll-mode-decision", requestId: request.requestId, accepted }, from);
  }), [net.publish, net.role, net.subscribe]);

  const authorizeRollMode = useCallback((mode: Exclude<NetRollMode, "normal">, label: string): Promise<boolean> => {
    if (!isNetPlayer || net.status !== "connected") return Promise.resolve(true);
    const hostId = peersRef.current.find((peer) => peer.role === "host")?.id;
    if (!hostId) return Promise.resolve(false);
    const requestId = `rm-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    return new Promise<boolean>((resolve) => {
      modeApprovals.current.set(requestId, resolve);
      net.publish({ t: "roll-mode-request", requestId, mode, label }, hostId);
      pushToast("Waiting for Curator approval…", "info");
      window.setTimeout(() => {
        const pending = modeApprovals.current.get(requestId);
        if (!pending) return;
        modeApprovals.current.delete(requestId);
        pending(false);
        pushToast("The roll posture request expired.", "error");
      }, 60_000);
    });
  }, [isNetPlayer, net.publish, net.status]);

  // Esc cancels an armed click-to-place AoE / spatial sound.
  useEffect(() => {
    if (!armedAoe && !armedSound) return;
    const onEsc = (e: KeyboardEvent) =>
      e.key === "Escape" && (setArmedAoe(null), setArmedSound(null));
    window.addEventListener("keydown", onEsc);
    return () => window.removeEventListener("keydown", onEsc);
  }, [armedAoe, armedSound]);

  // --- Live character-sheet sync (Curator control over player sheets) --------
  // Players push their full record; the Curator (and the owner) apply incoming
  // records to the local DB and can open/edit them, edits flowing back the same
  // way. Runs at this always-mounted level so a sheet arrives even before its
  // overlay is opened. Bumping sheetSyncTick remounts an open sheet to reload.
  //
  // AUTHORIZATION: the host (Curator) may update any sheet; a peer may only
  // create/update sheets THEY shared (first-writer-wins owner binding in the
  // partySheets store). A record that already exists in OUR local vault (this
  // campaign) can only be updated by the host — so a forged "first share" can
  // never overwrite the Curator's own characters.
  const hostIdOf = () => (net.role === "host" ? net.selfId : peersRef.current.find((p) => p.role === "host")?.id ?? null);
  useEffect(() => {
    if (!campaign) return;
    return net.subscribe("sheet-patch", (m, from) => {
      void (async () => {
        const pm = m as Extract<NetMessage, { t: "sheet-patch" }>;
        const rec = pm.patch as CharacterRecord | undefined;
        if (!rec || !rec.id || !rec.sheet) return;
        const hostId = hostIdOf();
        const privileged = from === net.selfId || (hostId != null && from === hostId);
        if (!privileged) {
          const tracked = getPartySheets().find((e) => e.record.id === rec.id);
          if (!tracked) {
            // Unseen record — reject if it collides with a character in OUR vault.
            const existing = await getCharacter(rec.id).catch(() => undefined);
            if (existing && existing.campaignId === campaign.id) return;
          }
        }
        if (!applyRemoteSheet(rec, from, { selfId: net.selfId, hostId })) return;
        void upsertCharacter(rec);
        // Only reload the open overlay when THIS character changed, so an unrelated
        // party member's edit never interrupts the sheet you are looking at.
        if (rec.id === sheetCharIdRef.current) setSheetSyncTick((t) => t + 1);
      })();
    });
  }, [campaign, net.subscribe, net.selfId, net.role]);

  // Forget a peer's shared sheets when they leave the room.
  useEffect(() => {
    pruneOwners(new Set(net.peers.map((p) => p.id)), net.selfId);
  }, [net.peers, net.selfId]);

  // Broadcast a locally-saved sheet to the room, skipping echoes of what we just
  // sent/received (content-hash guarded in the store).
  const broadcastSheet = useCallback(
    async (charId: string) => {
      if (net.status !== "connected") return;
      const rec = await getCharacter(charId).catch(() => undefined);
      if (rec && shouldBroadcastSheet(rec, net.selfId)) {
        net.publish({ t: "sheet-patch", charId, patch: rec, rev: Date.now() });
      }
    },
    [net]
  );

  // Share the sheet to the room when its overlay opens (initial hand-off), then
  // on every save (via the overlay's onChanged).
  useEffect(() => {
    if (sheetCharId) void broadcastSheet(sheetCharId);
  }, [sheetCharId, broadcastSheet]);

  // The Curator can't open a player's sheet until that player has shared it (they
  // broadcast on open/save). "Request sheets" lets the Curator PULL them: on a
  // host request, every player pushes ALL their campaign characters so they land
  // in the Curator's Actors → Players list, ready to open + edit. (Force-sends,
  // bypassing the unchanged-content guard.)
  const requestSheets = useCallback(() => {
    if (net.status === "connected" && net.role === "host") net.publish({ t: "sheet-request" });
  }, [net]);
  useEffect(() => {
    if (!campaign || net.role === "host") return; // only players answer
    return net.subscribe("sheet-request", (_m, from) => {
      const hostId = peersRef.current.find((p) => p.role === "host")?.id;
      if (from !== hostId) return; // only the Curator may ask
      void (async () => {
        const mine = await listCharacters(campaign.id).catch(() => [] as CharacterRecord[]);
        for (const rec of mine) net.publish({ t: "sheet-patch", charId: rec.id, patch: rec, rev: Date.now() });
      })();
    });
  }, [campaign, net.subscribe, net.role]);

  // Per-scene ambient music: play the ACTIVE scene's track (looped), stop when
  // it has none. Scene switches swap tracks automatically.
  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    const audio = engineRef.current?.scene?.data.audio ?? scene?.data.audio ?? null;
    if (audio?.src) {
      if (el.src !== audio.src) el.src = audio.src;
      el.loop = true;
      el.volume = Math.max(0, Math.min(1, (audio.volume ?? 0.5) * getMasterVolume()));
      void el.play().catch(() => {});
    } else {
      el.pause();
      el.removeAttribute("src");
    }
  });
  // ONE master volume scales scene music, received table sfx, and spatial
  // emitters together — moving the slider retunes audio that's already playing.
  useEffect(() => {
    const apply = (v: number) => {
      const el = audioRef.current;
      const audio = engineRef.current?.scene?.data.audio ?? scene?.data.audio ?? null;
      if (el && audio?.src) el.volume = Math.max(0, Math.min(1, (audio.volume ?? 0.5) * v));
      sfxRef.current?.setMaster(v);
      if (engineRef.current) engineRef.current.spatial.master = v;
    };
    apply(getMasterVolume());
    return subscribeMasterVolume(apply);
  });
  const [assets, setAssets] = useState<VttAsset[]>([]);
  const [assetsLoading, setAssetsLoading] = useState(false);
  const [tool, setTool] = useState<VttTool>("select");
  const [zoneBrush, setZoneBrush] = useState<{ kind: VttZoneKind; erase: boolean } | null>(null);
  const [sel, setSel] = useState<VttSelection>(null);
  const [tick, setTick] = useState(0); // re-render after engine mutations

  const persist = useCallback((s: VttScene) => {
    // Remote table state belongs to the Curator. Players keep it in memory and
    // never autosave a received snapshot/patch into their local SQLite scenes.
    if (!canPersistRef.current) return;
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => void reportSaveFailure(saveScene(s), "the scene"), 500);
  }, []);

  // Keyboard token movement: the LAST token you clicked stays arrow-key /
  // WASD-drivable — one cell per press — even after the selection moves on or
  // clears (clicking empty space to pan must not strand your character).
  // Only while the VTT is the visible tab, never while typing in a field.
  // Snaps + syncs like a drag-drop, so peers see the move.
  const [lastTokenId, setLastTokenId] = useState<string | null>(null);
  useEffect(() => {
    if (sel?.kind === "token") setLastTokenId(sel.id);
  }, [sel]);
  useEffect(() => {
    if (!active || !lastTokenId) return;
    const tokenId = lastTokenId;
    function onKey(e: KeyboardEvent) {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable)) return;
      let dx = 0;
      let dy = 0;
      switch (e.key) {
        case "ArrowUp": case "w": case "W": dy = -1; break;
        case "ArrowDown": case "s": case "S": dy = 1; break;
        case "ArrowLeft": case "a": case "A": dx = -1; break;
        case "ArrowRight": case "d": case "D": dx = 1; break;
        default: return;
      }
      e.preventDefault();
      const eng = engineRef.current;
      const tok = eng?.scene?.data.tokens.find((x) => x.id === tokenId);
      if (!eng || !eng.scene || !tok || !eng.canControlToken(tokenId)) return;
      const g = eng.scene.data.grid.size;
      const nx = tok.x + dx * g;
      const ny = tok.y + dy * g;
      eng.requestTokenMove(tokenId, tok.x, tok.y, nx, ny);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, lastTokenId]);

  // Flush the debounced autosave immediately — used before switching scenes so
  // in-flight edits aren't lost when the engine's scene object is swapped out.
  const flush = useCallback(async (): Promise<boolean> => {
    if (!canPersistRef.current) return true;
    window.clearTimeout(saveTimer.current);
    const s = engineRef.current?.scene;
    if (!s) return true;
    try {
      await saveScene(s);
      return true;
    } catch (e) {
      pushToast(`Couldn't save the scene — ${e instanceof Error ? e.message : String(e)}`, "error", 0);
      return false;
    }
  }, []);

  // Adopt a full scene pushed by a peer (host scene switch / late-join snapshot).
  // Local view only — no DB write (it's the host's scene, not ours to persist).
  const adoptSnapshot = useCallback((remote: VttScene) => {
    setScene(remote);
    setSel(null);
    engineRef.current?.setScene(remote);
    engineRef.current?.select(null);
  }, []);

  // ── Scene pinning ──────────────────────────────────────────────────────────
  // The Curator can PIN a scene for the table: players stay on it (and keep
  // playing there) while the Curator roams other scenes to prep. Player ops on
  // the pinned scene land in a working copy here and persist, so nothing that
  // happens while the Curator is away is lost.
  const [pinnedSceneId, setPinnedSceneId] = useState<string | null>(null);
  const pinnedRef = useRef<string | null>(null);
  pinnedRef.current = pinnedSceneId;
  /** Working copy of the pinned scene while the Curator is elsewhere. */
  const pinnedLive = useRef<VttScene | null>(null);
  const pinnedSaveTimer = useRef<number | undefined>(undefined);
  /** Foreign ops apply in arrival order, even when the first must await a DB load. */
  const pinnedQueue = useRef<Promise<void>>(Promise.resolve());

  // Persist the working copy now and let it go (pin released / host returning).
  // A queue can grow while a save is in flight, so keep draining/saving until
  // both the queue and the exact working object we saved are still current.
  // Only then may the working copy be retired. A failed save leaves the pin and
  // its in-memory state intact so the Curator can retry without losing a turn.
  const flushPinned = useCallback(async (): Promise<boolean> => {
    window.clearTimeout(pinnedSaveTimer.current);
    for (;;) {
      const queued = pinnedQueue.current;
      try {
        await queued;
      } catch (e) {
        pushToast(`Couldn't finish the pinned-scene changes — ${e instanceof Error ? e.message : String(e)}`, "error", 0);
        return false;
      }
      // An op was appended while the previous tail settled. Drain that too.
      if (queued !== pinnedQueue.current) continue;

      const working = pinnedLive.current;
      if (!working) return true;
      try {
        await saveScene(working);
      } catch (e) {
        pushToast(`Couldn't save the pinned scene — ${e instanceof Error ? e.message : String(e)}`, "error", 0);
        return false;
      }
      // An op that arrived during persistence may have mutated this same object;
      // save it once more before clearing. If nothing changed, this is the exact
      // copy that reached storage and can safely be handed back to the DB.
      if (queued !== pinnedQueue.current || working !== pinnedLive.current) continue;
      window.clearTimeout(pinnedSaveTimer.current);
      pinnedLive.current = null;
      return true;
    }
  }, []);

  // A pin can't outlive its context: new campaign or a dropped room means
  // nobody is being held anywhere any more.
  useEffect(() => {
    const pin = pinnedRef.current;
    if (!pin) return;
    void flushPinned().then((saved) => {
      if (!saved || pinnedRef.current !== pin) return;
      setPinnedSceneId(null);
      pinnedRef.current = null;
    });
  }, [campaign?.id, flushPinned]);
  useEffect(() => {
    if (net.status !== "connected" && pinnedRef.current) {
      const pin = pinnedRef.current;
      void flushPinned().then((saved) => {
        if (!saved || pinnedRef.current !== pin) return;
        setPinnedSceneId(null);
        pinnedRef.current = null;
      });
    }
  }, [net.status, flushPinned]);

  function schedulePinnedSave(working: VttScene): void {
    window.clearTimeout(pinnedSaveTimer.current);
    pinnedSaveTimer.current = window.setTimeout(() => {
      // Put persistence on the same tail as player ops. flushPinned/deletion can
      // now await an autosave that has already started instead of racing it and
      // letting INSERT OR REPLACE recreate a deleted scene afterward.
      pinnedQueue.current = pinnedQueue.current.catch(() => {}).then(async () => {
        if (pinnedLive.current === working) {
          await reportSaveFailure(saveScene(working), "the scene");
        }
      });
    }, 800);
  }

  /** Keep the canonical character profile in step with whichever authoritative
   * scene received the op. This deliberately accepts a scene argument: while
   * the Curator roams, player customization lands in `pinnedLive`, not in the
   * Pixi engine's current scene. */
  function syncCanonicalRegistryForScene(op: VttOp, authoritativeScene: VttScene): void {
    const registry = tokenRegistryRef.current;
    if (!campaign || !canPersistRef.current || !registry) return;

    const freshest = new Map<string, VttScene>();
    for (const candidate of scenesRef.current) freshest.set(candidate.id, candidate);
    const engineScene = engineRef.current?.scene;
    if (engineScene) freshest.set(engineScene.id, engineScene);
    const pinned = pinnedLive.current;
    if (pinned) freshest.set(pinned.id, pinned);
    freshest.set(authoritativeScene.id, authoritativeScene);
    const allScenes = [...freshest.values()];
    let next: TokenRegistryState | null = null;

    if (op.op === "token.update") {
      const token = authoritativeScene.data.tokens.find((candidate) => candidate.id === op.id);
      if (token?.characterId) {
        const customized = customizeCanonicalCharacterToken(
          registry,
          allScenes,
          token.characterId,
          { name: token.name, color: token.color, size: token.size, img: token.img, vision: token.vision }
        );
        next = customized?.state ?? null;
      }
    } else if (op.op === "token.assign") {
      const token = authoritativeScene.data.tokens.find((candidate) => candidate.id === op.id);
      const profile = token?.characterId ? registry.profiles[token.characterId] : undefined;
      if (token?.characterId && profile) {
        next = {
          ...registry,
          profiles: {
            ...registry.profiles,
            [token.characterId]: { ...profile, controllerId: op.owner, updatedAt: Date.now() },
          },
        };
      }
    } else if (op.op === "token.remove") {
      const characterId = Object.keys(registry.presences).find((id) => registry.presences[id].tokenId === op.id);
      if (characterId) {
        const presences = { ...registry.presences };
        delete presences[characterId];
        next = { ...registry, presences };
      }
    }

    if (next) {
      tokenRegistryRef.current = next;
      void reportSaveFailure(saveTokenRegistryOrdered(next), "the token profile");
    }
  }

  // Player activity on the PINNED scene while the Curator roams: those ops
  // arrive scoped to a scene we aren't viewing. Apply them to the working copy
  // under the same authorization the live receive path enforces, then debounce
  // a save. (Fresh closure every render, so `net` is always current.)
  async function onForeignOp(sceneId: string, op: VttOp, from: string): Promise<boolean> {
    if (net.status !== "connected" || net.role !== "host" || sceneId !== pinnedRef.current) return false;
    let accepted = false;
    const task = pinnedQueue.current.catch(() => {}).then(async () => {
      if (sceneId !== pinnedRef.current) return; // unpinned while queued
      // The host arrived on the pinned scene while this op waited — apply live.
      const eng = engineRef.current;
      if (eng?.scene?.id === sceneId) {
        if (foreignOpAllowed(eng.scene.data, op, from)) {
          accepted = eng.applyRemote(op);
        }
        return;
      }
      let s = pinnedLive.current;
      if (!s || s.id !== sceneId) {
        s = await getScene(sceneId).catch(() => null);
        if (!s || sceneId !== pinnedRef.current) return;
        pinnedLive.current = s;
      }
      // (The wall-collision defense is skipped here — the mover's own client
      // enforces walls on the scene it is actually standing in.)
      if (!foreignOpAllowed(s.data, op, from)) return;
      if (op.op === "token.update" && op.patch.img !== undefined && !vttSnapshotFits({
        ...s,
        data: {
          ...s.data,
          tokens: s.data.tokens.map((token) => token.id === op.id ? { ...token, ...op.patch } : token),
        },
      })) return;
      if (!applyOp(s.data, op)) return;
      syncCanonicalRegistryForScene(op, s);
      accepted = true;
      schedulePinnedSave(s);
    });
    pinnedQueue.current = task;
    try {
      await task;
      return accepted;
    } catch (e) {
      pushToast(`Couldn't apply a pinned-scene change — ${e instanceof Error ? e.message : String(e)}`, "error", 0);
      return false;
    }
  }

  async function onForeignMoveRequest(request: VttMoveRequestMessage, from: string) {
    let decision: {
      ok: boolean;
      x: number;
      y: number;
      reason?: "not-owner" | "stale" | "wall" | "occupied" | "out-of-bounds" | "invalid" | "wrong-scene";
    } = { ok: false, x: request.fromX, y: request.fromY, reason: "wrong-scene" };

    // The same queue used by pinned patches serializes moves too. Two players
    // racing for one empty square are therefore evaluated against one ordered
    // authoritative scene state.
    pinnedQueue.current = pinnedQueue.current.catch(() => {}).then(async () => {
      if (net.status !== "connected" || net.role !== "host" || request.scope !== pinnedRef.current) return;
      let stored = pinnedLive.current;
      if (!stored || stored.id !== request.scope) {
        stored = await getScene(request.scope).catch(() => null);
        if (!stored || request.scope !== pinnedRef.current) return;
        pinnedLive.current = stored;
      }
      const authority = validateMoveAuthority(
        { grid: stored.data.grid, tokens: stored.data.tokens, walls: stored.data.walls, revision: 0 },
        { peerId: from, role: "player" },
        {
          tokenId: request.tokenId,
          fromX: request.fromX,
          fromY: request.fromY,
          toX: request.toX,
          toY: request.toY,
        }
      );
      if (!authority.ok) {
        decision = { ok: false, x: authority.x, y: authority.y, reason: authority.reason };
        return;
      }
      if (!applyOp(stored.data, { op: "token.move", id: authority.tokenId, x: authority.x, y: authority.y })) return;
      decision = { ok: true, x: authority.x, y: authority.y };
      // Movement on a scene the Curator is not viewing must still use the same
      // border-link transfer path as live movement. A completed transfer saves
      // both scenes directly, so no stale pinned autosave should follow it.
      const transferred = await tokenMovedRef.current(authority.tokenId, authority.x, authority.y, stored);
      if (transferred) return;
      schedulePinnedSave(stored);
    });
    await pinnedQueue.current;
    return decision;
  }

  // P2P sync (slice 10). broadcastOp is wired to the engine's local-op emitter;
  // broadcastSnapshot pushes the whole scene on host switches / to late joiners.
  const sync = useVttSync({
    engineRef,
    expectedCampaignId: campaign?.id ?? null,
    sceneId: scene?.id ?? null,
    getScene: () => engineRef.current?.scene ?? null,
    onSnapshot: adoptSnapshot,
    onForeignOp,
    onForeignMoveRequest,
    // A late joiner belongs on the players' pinned scene, not wherever the
    // Curator happens to be browsing. Freshest copy wins: the working copy if
    // player ops have landed since the Curator left, else storage.
    getLateJoinScene: async () => {
      const pin = pinnedRef.current;
      if (!pin || pin === (engineRef.current?.scene?.id ?? null)) return null;
      return pinnedLive.current?.id === pin ? pinnedLive.current : await getScene(pin).catch(() => null);
    },
  });
  const broadcastRef = useRef(sync.broadcastOp);
  broadcastRef.current = sync.broadcastOp;
  const moveRequestRef = useRef(sync.requestMove);
  moveRequestRef.current = sync.requestMove;

  registryOpRef.current = (op: VttOp) => {
    const liveScene = engineRef.current?.scene;
    if (liveScene) syncCanonicalRegistryForScene(op, liveScene);
  };

  // Boot the engine once.
  useEffect(() => {
    const host = hostRef.current;
    if (!host || engineRef.current) return;
    const engine = new PixiVttApp();
    engineRef.current = engine;
    engine.onChanged = () => {
      if (engine.scene) persist(engine.scene);
      setTick((t) => t + 1);
    };
    engine.onSelect = (s) => setSel(s);
    engine.onOp = (op) => {
      registryOpRef.current(op);
      broadcastRef.current(op);
    };
    engine.onRemoteApplied = (op) => registryOpRef.current(op);
    engine.onShaderError = (err) => setShaderError(err);
    engine.onSceneBudgetError = () => pushToast(
      "That media would make this scene too large for players to receive. Remove another large map, sound, prop, or token image first.",
      "error",
      0
    );
    // A map that fails to load leaves the plain fill behind, which looks exactly
    // like a scene that never had a map. Say which it is.
    engine.bg.onImageError = (detail) => pushToast(detail, "error", 0);
    engine.onTokenMoved = (id, x, y) => void tokenMovedRef.current(id, x, y);
    engine.onMoveRequested = (id, fromX, fromY, toX, toY) => moveRequestRef.current(id, fromX, fromY, toX, toY);
    engine.onPing = (x, y) => pingOutRef.current(x, y);
    // Dev-only handle for debugging sync ops in the preview (stripped in prod).
    if (import.meta.env.DEV) (window as unknown as { __vttEngine?: PixiVttApp }).__vttEngine = engine;
    // A failed init must NEVER be a silent black canvas again. That exact
    // swallow hid a CSP crash in every packaged build: chrome worked, data
    // saved, and the table was a void with no error anywhere.
    engine.init(host).catch((e) => {
      const why = e instanceof Error ? e.message : String(e);
      pushToast(
        `The table could not start its renderer: ${why}. The scene chrome still works and nothing has been lost, but the map cannot be drawn.`,
        "error",
        0
      );
    });
    return () => {
      engineRef.current = null;
      engine.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load (or create) the campaign's scene, plus the full scene list for the browser.
  useEffect(() => {
    let alive = true;
    const epoch = ++campaignLoadEpoch.current;
    const targetCampaignId = campaign?.id ?? null;
    const current = () => alive && campaignLoadEpoch.current === epoch && campaignIdRef.current === targetCampaignId;
    // Never leave the previous campaign interactive while the next campaign's
    // scenes/registry are still resolving.
    tokenRegistryRef.current = null;
    setScene(null);
    setScenes([]);
    setSel(null);
    engineRef.current?.clearScene();
    async function load() {
      if (isNetPlayer) {
        // The host snapshot is the only scene source while joined. Do not query
        // or seed a same-id local scene before that snapshot arrives.
        return;
      }
      let s: VttScene | null = null;
      let all: VttScene[] = [];
      let readFailed = false;
      let loadedTokenRegistry: TokenRegistryState | null = null;
      if (campaign && isTauri()) {
        // Do NOT conflate a failed read with an empty campaign. This used to be
        // `.catch(() => [])` and, finding no scenes, wrote a brand-new "Scene 1"
        // marked active straight over the campaign — so a locked database (a second
        // app instance, an antivirus handle) was enough to make every scene vanish
        // from the rail and be replaced by an empty one. The failure was never
        // surfaced either: only the subsequent SAVE was wrapped.
        try {
          all = await listScenes(campaign.id);
          if (!current()) return;
          const loadedRegistry = await loadTokenRegistry(campaign.id);
          if (!current()) return;
          if (loadedRegistry.status === "corrupt") {
            pushToast(
              "The campaign's token registry is damaged. Existing scene tokens were left untouched so they can be recovered safely.",
              "error",
              0
            );
          } else {
            const migrated = migrateLegacyCharacterTokens(campaign.id, all, loadedRegistry.state);
            try {
              // Archive duplicate snapshots before removing any duplicate scene
              // presence, keeping migration reversible if a later write fails.
              await saveTokenRegistryOrdered(migrated.state);
              if (!current()) return;
              loadedTokenRegistry = migrated.state;
              for (let i = 0; i < all.length; i++) {
                if (JSON.stringify(all[i].data.tokens) !== JSON.stringify(migrated.scenes[i].data.tokens)) {
                  await saveScene(migrated.scenes[i]);
                  if (!current()) return;
                }
              }
              all = migrated.scenes;
              if (migrated.report.deduplicated.length > 0) {
                const count = migrated.report.deduplicated.reduce((sum, item) => sum + item.retiredTokenIds.length, 0);
                pushToast(`Consolidated ${count} duplicate character token${count === 1 ? "" : "s"}; archived copies remain recoverable.`, "info");
              }
            } catch (e) {
              if (!current()) return;
              loadedTokenRegistry = null;
              pushToast(`Couldn't initialize canonical tokens — ${e instanceof Error ? e.message : String(e)}. Scene tokens were not migrated.`, "error", 0);
            }
          }
        } catch (e) {
          if (!current()) return;
          readFailed = true;
          pushToast(
            `Couldn't read this campaign's scenes: ${e instanceof Error ? e.message : String(e)}. Nothing has been changed — close any other copy of W.T.E, then reopen this tab.`,
            "error",
            0
          );
        }
        s = all.find((x) => x.active) ?? all[0] ?? null;
      }
      if (!s && !readFailed) {
        // Only seed when the query SUCCEEDED and genuinely returned no scenes.
        // No campaign → an in-memory sandbox table; with a campaign, seed Scene 1.
        s = newScene(campaign?.id ?? "sandbox", campaign ? campaign.name + " · Scene 1" : "Sandbox");
        s.active = true;
        if (campaign) {
          try {
            await saveScene(s);
            if (!current()) return;
            all = [s];
          } catch (e) {
            if (!current()) return;
            pushToast(`Couldn't create the campaign's first scene — ${e instanceof Error ? e.message : String(e)}`, "error", 0);
            s = null;
            readFailed = true;
          }
        }
      }
      if (!current()) return;
      tokenRegistryRef.current = loadedTokenRegistry;
      setScene(s);
      setScenes(all);
      // `s` is null only when the scene read FAILED — in that case we deliberately
      // hand the engine nothing rather than a blank stand-in, so no autosave can
      // fire against a scene we never actually loaded. The error toast above tells
      // the user what happened.
      if (s) engineRef.current?.setScene(s);
    }
    void load();
    return () => {
      alive = false;
    };
  }, [campaign?.id, isNetPlayer]);

  const reloadScenes = useCallback(async () => {
    if (!campaign || !isTauri()) return;
    const all = await listScenes(campaign.id).catch(() => [] as VttScene[]);
    setScenes(all);
  }, [campaign]);

  // Adopt a scene as the live one: mark it active in the DB, swap it into the
  // engine, clear any selection, and refresh the browser list.
  const adopt = useCallback(
    async (s: VttScene) => {
      if (campaign) await setActiveScene(campaign.id, s.id).catch(() => {});
      s.active = true;
      // Returning to the pinned scene: the engine takes over the working copy,
      // so retire it (its content is `s` itself when switchScene preferred it).
      if (pinnedLive.current?.id === s.id) {
        window.clearTimeout(pinnedSaveTimer.current);
        pinnedLive.current = null;
      }
      setScene(s);
      setSel(null);
      engineRef.current?.setScene(s);
      engineRef.current?.select(null);
      await reloadScenes();
      // Push the new active scene to peers (covers the scene.switch case) —
      // UNLESS a different scene is pinned for the table: then the Curator is
      // just roaming, and the players stay where they are.
      const pin = pinnedRef.current;
      if (!pin || s.id === pin) sync.broadcastSnapshot();
    },
    [campaign, reloadScenes, sync]
  );

  // Guard against double-clicks / wheel-spam interleaving two switches; fall back
  // to the in-memory list when the DB read misses (the old silent no-op bug).
  const switchingRef = useRef(false);
  async function switchScene(id: string) {
    if (!campaign || id === scene?.id || switchingRef.current) return;
    switchingRef.current = true;
    try {
      if (!(await flush())) return;
      // Returning to the players' pinned map transfers ownership of its working
      // copy back to the live engine. Drain and persist every queued player op
      // before loading it; on failure, stay on the current scene and keep the
      // recoverable in-memory copy pinned.
      if (pinnedRef.current === id) {
        if (!(await flushPinned())) return;
        // A queued player move may have crossed a portal while we drained it,
        // advancing the table pin and adopting that destination. Do not then
        // pull the table back to the portal's source.
        if (pinnedRef.current !== id) return;
      }
      // The pinned scene's working copy is fresher than storage while player
      // ops are still debouncing — never load a stale DB copy over it.
      const target =
        (pinnedLive.current?.id === id ? pinnedLive.current : null) ??
        (await getScene(id).catch(() => null)) ??
        scenes.find((s) => s.id === id) ??
        null;
      if (target) await adopt(target);
    } finally {
      switchingRef.current = false;
    }
  }

  // Border-portal crossings (multi-map links) — HOST-side detection: fires for
  // local drops/steps and for remote players' moves (via applyRemote). Carries
  // the traveller (and optionally the whole party) into the linked scene at the
  // opposite edge, then switches the table there.
  const linkBusy = useRef(false);
  const onTokenCrossed = async (tokenId: string, x: number, y: number, sourceOverride?: VttScene): Promise<boolean> => {
    if (isNetPlayer || (switchingRef.current && !sourceOverride)) return false;
    const liveScene = sourceOverride ?? engineRef.current?.scene;
    if (!campaign || !liveScene?.data.links?.length) return false;
    const grid = liveScene.data.grid;
    const link = liveScene.data.links.find((l) => tokenInEdge(grid, l.edge, x, y));
    if (!link) return false;
    const transfer = async (): Promise<boolean> => {
      // Never load a stale DB target over an in-memory scene the Curator is
      // editing or over the players' pinned working copy.
      const engineScene = engineRef.current?.scene;
      const pinned = pinnedLive.current;
      const target =
        (engineScene?.id === link.targetSceneId ? engineScene : null) ??
        (pinned?.id === link.targetSceneId ? pinned : null) ??
        (await getScene(link.targetSceneId).catch(() => null)) ??
        scenesRef.current.find((candidate) => candidate.id === link.targetSceneId) ??
        null;
      if (!target || target.id === liveScene.id) return false;
      const trigger = liveScene.data.tokens.find((t) => t.id === tokenId);
      if (!trigger) return false;
      const others = liveScene.data.tokens.filter((t) => t.id !== tokenId && t.owner);
      const party = others.length > 0 && confirm(`Take the whole party through to "${target.name}"?`);
      const moving = party ? [trigger, ...others] : [trigger];
      // This also clears a pending autosave whose old object could otherwise
      // overwrite a freshly transferred target after the direct writes below.
      if (!(await flush())) return false;
      const freshest = new Map<string, VttScene>();
      for (const candidate of scenesRef.current) freshest.set(candidate.id, candidate);
      if (engineScene) freshest.set(engineScene.id, engineScene);
      if (pinned) freshest.set(pinned.id, pinned);
      freshest.set(liveScene.id, liveScene);
      freshest.set(target.id, target);
      let working: VttScene[] = [...freshest.values()]
        .map((candidate) => ({
          ...candidate,
          data: { ...candidate.data, tokens: candidate.data.tokens.map((token) => ({ ...token, statuses: token.statuses ? [...token.statuses] : undefined })) },
        }));
      let registry = tokenRegistryRef.current;

      for (let i = 0; i < moving.length; i++) {
        const traveller = moving[i];
        const preferred = arrivalPos(grid, target.data.grid, link.edge, traveller.x, traveller.y, i);
        if (traveller.characterId) {
          if (!registry) {
            pushToast("Canonical token storage is unavailable; the scene transfer was cancelled.", "error");
            return false;
          }
          const transferred = transferCanonicalCharacterToken(registry, working, traveller.characterId, target.id, preferred);
          if (!transferred.ok) {
            pushToast(`Couldn't transfer ${traveller.name} (${transferred.reason}).`, "error");
            return false;
          }
          working = transferred.scenes;
          registry = transferred.state;
          continue;
        }
        const source = working.find((candidate) => candidate.id === liveScene.id)!;
        const destination = working.find((candidate) => candidate.id === target.id)!;
        const sourceToken = source.data.tokens.find((candidate) => candidate.id === traveller.id);
        if (!sourceToken) continue;
        const point = findNearestAvailableTokenPosition(destination, sourceToken, preferred);
        if (!point) {
          pushToast(`There is no open arrival space for ${sourceToken.name}.`, "error");
          return false;
        }
        source.data.tokens = source.data.tokens.filter((candidate) => candidate.id !== sourceToken.id);
        destination.data.tokens.push({ ...sourceToken, x: point.x, y: point.y });
      }

      const nextSource = working.find((candidate) => candidate.id === liveScene.id)!;
      const nextTarget = working.find((candidate) => candidate.id === target.id)!;
      // Destination-first persistence makes an interrupted transfer recover as
      // a reversible duplicate, never as a lost actor.
      try {
        await saveScene(nextTarget);
        await saveScene(nextSource);
      } catch (e) {
        pushToast(`Couldn't save the scene transfer — ${e instanceof Error ? e.message : String(e)}. The original token was kept.`, "error", 0);
        return false;
      }
      if (registry) {
        tokenRegistryRef.current = registry;
        await reportSaveFailure(saveTokenRegistryOrdered(registry), "the token registry");
      }
      // A portal departing the table's pinned scene moves the pin with the
      // players. Set it before adopt(), otherwise adopt suppresses the target
      // snapshot because it still believes everyone must remain on the source.
      if (pinnedRef.current === liveScene.id) {
        setPinnedSceneId(nextTarget.id);
        pinnedRef.current = nextTarget.id;
      }
      if (pinnedLive.current?.id === liveScene.id) {
        window.clearTimeout(pinnedSaveTimer.current);
        pinnedLive.current = null;
      }
      setScenes(working);
      await adopt(nextTarget); // switches the whole table + snapshots to peers
      return true;
    };

    const runTransfer = async (): Promise<boolean> => {
      if (linkBusy.current) return false;
      linkBusy.current = true;
      try {
        return await transfer();
      } finally {
        linkBusy.current = false;
      }
    };

    if (!sourceOverride && pinnedRef.current === link.targetSceneId) {
      // The destination is the players' off-screen working scene. Put the
      // entire destination-first transfer on their op queue: earlier edits
      // become part of the target, and later edits wait until adopt() hands
      // that exact target to the live engine. No pinned customization/move is
      // overwritten by a portal arriving from the Curator's roaming scene.
      const task = pinnedQueue.current.catch(() => {}).then(() =>
        pinnedRef.current === link.targetSceneId ? runTransfer() : false
      );
      pinnedQueue.current = task.then(() => undefined);
      return await task;
    }
    return await runTransfer();
  };
  const tokenMovedRef = useRef<(tokenId: string, x: number, y: number, sourceOverride?: VttScene) => Promise<boolean>>(onTokenCrossed);
  tokenMovedRef.current = onTokenCrossed;

  // Step to the previous/next scene (wheel + arrow buttons on the scene rail).
  function stepScene(dir: 1 | -1) {
    if (!scenes.length) return;
    const idx = Math.max(0, scenes.findIndex((s) => s.id === scene?.id));
    const next = scenes[(idx + dir + scenes.length) % scenes.length];
    if (next && next.id !== scene?.id) void switchScene(next.id);
  }

  // Curator pushes a scene to the whole table AND PINS it there: every player
  // jumps to it and STAYS on it even while the Curator roams other scenes to
  // prep. Re-pinning the active scene doubles as a "pull drifted players back
  // to my scene" re-sync.
  async function setActiveForEveryone(id: string) {
    // Moving the pin banks the old working scene first. If storage rejects that
    // write, leave everyone where they are so no later load can hide the edits.
    if (pinnedRef.current && pinnedRef.current !== id && !(await flushPinned())) return;
    setPinnedSceneId(id);
    pinnedRef.current = id;
    if (id !== scene?.id) await switchScene(id);
    else sync.broadcastSnapshot();
  }

  // Release the pin: the table follows the Curator again, starting right now.
  async function releasePin() {
    if (!(await flushPinned())) return;
    setPinnedSceneId(null);
    pinnedRef.current = null;
    sync.broadcastSnapshot(); // everyone joins the Curator's current scene
  }

  async function createScene() {
    if (!campaign) return;
    if (!(await flush())) return;
    const s = newScene(campaign.id, `${campaign.name} · Scene ${scenes.length + 1}`);
    try {
      await saveScene(s);
    } catch (e) {
      pushToast(`Couldn't create the scene — ${e instanceof Error ? e.message : String(e)}`, "error", 0);
      return;
    }
    await adopt(s);
  }

  async function renameSceneById(id: string, name: string) {
    await patchScene(id, (target) => { target.name = name; });
    if (id === scene?.id) setScene((currentScene) => currentScene ? { ...currentScene, name } : currentScene);
  }

  async function deleteSceneById(id: string) {
    if (!campaign) return;
    const deletingPinnedScene = pinnedRef.current === id;
    let clearedDeletedPin = false;
    let deletingLiveScene = scene?.id === id;
    let liveCopy = deletingLiveScene && engineRef.current?.scene?.id === id ? engineRef.current.scene : null;
    let liveSelection = deletingLiveScene ? sel : null;
    if (deletingPinnedScene) {
      // Deletion is a pin transition too. Drain every player op and persist the
      // exact working copy first; then detach it before DELETE so neither the
      // debounce nor a late queued callback can INSERT OR REPLACE it afterward.
      if (!(await flushPinned())) return;
      // Draining may itself complete a player's portal and advance the pin. In
      // that case the requested source is no longer pinned; preserve the new
      // destination pin instead of releasing the table out from under them.
      if (pinnedRef.current === id) {
        window.clearTimeout(pinnedSaveTimer.current);
        pinnedLive.current = null;
        setPinnedSceneId(null);
        pinnedRef.current = null;
        clearedDeletedPin = true;
      }
      // A queued portal can also make this scene live while flushPinned waits.
      // Re-evaluate against the engine, not React's pre-await render snapshot.
      if (engineRef.current?.scene?.id === id) {
        deletingLiveScene = true;
        liveCopy = engineRef.current.scene;
        liveSelection = null;
      }
    }
    // The pending 500ms autosave holds the LIVE engine scene and saves with
    // INSERT OR REPLACE, so a delete that leaves the timer armed lets the scene
    // RESURRECT itself moments after the user confirmed removing it. Every other
    // scene-swapping path (switchScene, createScene, setActiveForEveryone,
    // releasePin) already flushes first; this one did not.
    if (deletingLiveScene) {
      // Deleting the live scene: cancel the write rather than flush it — there is
      // no sense persisting a row we are about to remove. Detach it from the
      // engine as well so a peer edit arriving during DELETE cannot arm a new
      // autosave that resurrects the row.
      window.clearTimeout(saveTimer.current);
      engineRef.current?.clearScene();
    } else {
      // Deleting a different scene: the pending edit belongs to the live scene and
      // must still land.
      if (!(await flush())) return;
    }
    // Report a failed delete instead of swallowing it — otherwise the scene stays
    // on disk while the UI acts as though it is gone.
    try {
      await deleteScene(id);
    } catch (e) {
      // The row still exists, so restore the table pin players were already on.
      // flushPinned saved it before deletion was attempted.
      if (clearedDeletedPin) {
        setPinnedSceneId(id);
        pinnedRef.current = id;
      }
      if (liveCopy) {
        engineRef.current?.setScene(liveCopy);
        if (liveSelection) engineRef.current?.select(liveSelection);
      }
      pushToast(`Couldn't delete the scene — ${e instanceof Error ? e.message : String(e)}`, "error", 0);
      return;
    }
    const registry = tokenRegistryRef.current;
    if (registry) {
      const presences = Object.fromEntries(
        Object.entries(registry.presences).filter(([, presence]) => presence.sceneId !== id)
      );
      if (Object.keys(presences).length !== Object.keys(registry.presences).length) {
        const nextRegistry = { ...registry, presences };
        tokenRegistryRef.current = nextRegistry;
        await reportSaveFailure(saveTokenRegistryOrdered(nextRegistry), "the token registry");
      }
    }
    if (deletingLiveScene) {
      const remaining = await listScenes(campaign.id).catch(() => [] as VttScene[]);
      const next = remaining.find((x) => x.active) ?? remaining[0] ?? null;
      if (next) await adopt(next);
      else {
        // Keep the renderer and every connected player from continuing to edit
        // a deleted object. A campaign always has one safe blank scene.
        const replacement = newScene(campaign.id, `${campaign.name} · Scene 1`);
        replacement.active = true;
        try {
          await saveScene(replacement);
          await adopt(replacement);
        } catch (e) {
          setScene(null);
          setScenes([]);
          setSel(null);
          engineRef.current?.clearScene();
          pushToast(`The last scene was deleted, but its replacement could not be saved — ${e instanceof Error ? e.message : String(e)}`, "error", 0);
        }
      }
    } else {
      await reloadScenes();
      // Players were looking at the deleted pinned scene. Move them onto the
      // Curator's still-valid current scene immediately; a denied late patch is
      // also corrected by this same authoritative snapshot.
      if (clearedDeletedPin) sync.broadcastSnapshot();
    }
  }

  // Load the campaign's vault characters for the Actors panel.
  const loadCharacters = useCallback(async () => {
    if (!campaign || !isTauri()) {
      setCharacters([]);
      setCharsLoading(false);
      return;
    }
    const targetCampaignId = campaign.id;
    setCharsLoading(true);
    const list = await listCharacters(targetCampaignId).catch(() => [] as CharacterRecord[]);
    if (campaignIdRef.current !== targetCampaignId) return;
    setCharacters(list);
    setCharsLoading(false);
  }, [campaign?.id]);

  // Codex creatures the Curator can spawn as linked tokens (sheets pulled from the Codex).
  const [creatures, setCreatures] = useState<Creature[]>([]);
  const [creaturesLoading, setCreaturesLoading] = useState(false);
  const loadCreatures = useCallback(async () => {
    if (!isTauri()) {
      setCreatures([]);
      return;
    }
    setCreaturesLoading(true);
    setCreatures(await listCreatures().catch(() => [] as Creature[]));
    setCreaturesLoading(false);
  }, []);

  // Quick creatures: stat blocks the Curator types straight into the Actors
  // panel (saved per campaign in localStorage — no Codex page needed).
  const [quickCreatures, setQuickCreatures] = useState<QuickCreature[]>([]);
  const qcCampaign = campaign?.id ?? "sandbox";
  useEffect(() => {
    setQuickCreatures(listQuickCreatures(qcCampaign));
  }, [qcCampaign]);
  function spawnQuick(qc: QuickCreature) {
    engineRef.current?.spawnToken(
      creatureToTokenSpec({
        name: qc.name,
        hp: qc.hp,
        dr: qc.dr,
        size: qc.size,
        stats: qc.stats,
        traits: qc.traits,
        desc: qc.desc,
        ts: Date.now(),
      })
    );
  }

  useEffect(() => {
    void loadCharacters();
  }, [loadCharacters]);
  useEffect(() => {
    if (leftPanel === "actors") void loadCreatures();
  }, [leftPanel, loadCreatures]);

  async function spawnCharacter(rec: CharacterRecord) {
    if (isNetPlayer) return;
    const engine = engineRef.current;
    const liveScene = engine?.scene;
    if (!engine || !liveScene) return;
    const spec = characterToTokenSpec(rec);
    const sharedOwner = partySheets.find((entry) => entry.record.id === rec.id)?.ownerId;
    if (sharedOwner) spec.owner = sharedOwner;

    // Sandbox remains scene-local. Persisted campaigns use one canonical
    // presence and transfer/focus it instead of creating another token.
    if (!campaign) {
      engine.spawnToken(spec);
      return;
    }
    const registry = tokenRegistryRef.current;
    if (!registry) {
      pushToast("Canonical token storage is unavailable; no duplicate token was created.", "error");
      return;
    }
    const preferred = engine.snap(engine.viewCenterWorld().x, engine.viewCenterWorld().y);
    const token: VttToken = {
      ...spec,
      id: newId("tk"),
      name: spec.name || rec.name,
      x: preferred.x,
      y: preferred.y,
      size: spec.size ?? 1,
      color: spec.color || "#689a96",
      visible: spec.visible ?? true,
    };
    const pinned = pinnedLive.current;
    const baseScenes = scenesRef.current.length
      ? scenesRef.current.map((candidate) =>
          candidate.id === liveScene.id ? liveScene : pinned?.id === candidate.id ? pinned : candidate
        )
      : [liveScene];
    const existingPresence = registry.presences[rec.id];
    if (pinnedRef.current && pinnedRef.current !== liveScene.id && existingPresence?.sceneId === pinnedRef.current) {
      pushToast("That character is on the pinned player scene. Switch to that scene, or make this scene active for everyone before transferring the token.", "error");
      return;
    }
    const result = ensureCanonicalCharacterToken(registry, baseScenes, liveScene.id, token, preferred);
    if (!result.ok) {
      const detail = result.reason === "ambiguous-presence"
        ? "Legacy duplicates must be reviewed before this character can move."
        : result.reason === "no-open-space"
          ? "There is no open space for this token on the current map."
          : `The token could not be placed (${result.reason}).`;
      pushToast(detail, "error");
      return;
    }

    // Save destination first. If a later source write fails, the recoverable
    // outcome is a duplicate, never a vanished character token.
    const changed = result.scenes.filter((next) => {
      const before = baseScenes.find((candidate) => candidate.id === next.id);
      return !before || JSON.stringify(before.data.tokens) !== JSON.stringify(next.data.tokens);
    });
    changed.sort((a, b) => (a.id === liveScene.id ? -1 : b.id === liveScene.id ? 1 : 0));
    try {
      for (const changedScene of changed) await saveScene(changedScene);
    } catch (e) {
      pushToast(`Couldn't save the canonical token move — ${e instanceof Error ? e.message : String(e)}`, "error", 0);
      return;
    }
    await reportSaveFailure(saveTokenRegistryOrdered(result.state), "the token registry");
    tokenRegistryRef.current = result.state;
    setScenes(result.scenes);
    const nextLive = result.scenes.find((candidate) => candidate.id === liveScene.id) ?? liveScene;
    setScene(nextLive);
    engine.setScene(nextLive);
    engine.select({ kind: "token", id: result.token.id });
    engine.centerOn(result.token.x, result.token.y);
    if (!pinnedRef.current || pinnedRef.current === liveScene.id) sync.broadcastSnapshot();
  }
  /** Spawn a Codex creature as a linked token — HP/DR/size/flags derived from its sheet. */
  function spawnCreature(c: Creature) {
    const d = computeCreature(c);
    engineRef.current?.spawnToken(
      creatureToTokenSpec({
        name: c.name,
        cls: c.cls,
        hp: d.hp,
        dr: d.dr,
        size: d.size,
        flags: d.flags,
        stats: c.stats,
        traits: c.traits,
        desc: c.lore,
        ts: Date.now(),
      })
    );
  }

  // Load the campaign's asset library for the Assets panel.
  const loadAssets = useCallback(async () => {
    if (!campaign || !isTauri()) {
      setAssets([]);
      setAssetsLoading(false);
      return;
    }
    const targetCampaignId = campaign.id;
    setAssetsLoading(true);
    const list = await listAssets(targetCampaignId).catch(() => [] as VttAsset[]);
    if (campaignIdRef.current !== targetCampaignId) return;
    // "blob" rows are internal scene-image storage — never shown in the browser.
    setAssets(list.filter((a) => a.kind !== "blob"));
    setAssetsLoading(false);
  }, [campaign?.id]);

  useEffect(() => {
    void loadAssets();
  }, [loadAssets]);

  async function addAssetEntry(kind: AssetKind, name: string, uri: string) {
    if (!campaign) return;
    const targetCampaignId = campaign.id;
    const a = await addAsset(targetCampaignId, kind, name, uri).catch(() => null);
    if (a && campaignIdRef.current === targetCampaignId) setAssets((cur) => [a, ...cur]);
  }
  async function removeAsset(id: string) {
    await reportSaveFailure(deleteAsset(id), "the asset deletion");
    setAssets((cur) => cur.filter((a) => a.id !== id));
  }
  function applyTokenArt(uri: string) {
    if (sel?.kind === "token") engineRef.current?.updateToken(sel.id, { img: uri });
  }
  /** Drop a prop (PNG map decoration) at the view centre — drag/rotate/resize
   *  from there like any token, but it renders as the full image: no disc,
   *  no label, no circular crop. */
  function placeProp(name: string, uri: string) {
    engineRef.current?.spawnToken({ name, img: uri, prop: true, size: 2, color: "#3a4150", visible: true });
  }

  // Codex creature spawns ride the legacy `wte-spawn-creature` channel. VTT v2
  // and the React Codex share one document, where `storage` events don't fire —
  // so the Codex also dispatches a same-window CustomEvent (see CodexBrowser).
  // The `storage` listener still catches spawns from the legacy sheet/wiki iframes.
  useEffect(() => {
    const lastTs = { v: 0 };
    function handle(raw: unknown) {
      const payload = parseSpawnPayload(raw);
      if (!payload) return;
      const ts = payload.ts ?? Date.now();
      if (ts === lastTs.v) return; // dedup a storage+custom double-fire
      lastTs.v = ts;
      engineRef.current?.spawnToken(creatureToTokenSpec(payload));
    }
    const onStorage = (e: StorageEvent) => {
      if (e.key === "wte-spawn-creature" && e.newValue) handle(e.newValue);
    };
    const onCustom = (e: Event) => handle((e as CustomEvent).detail);
    window.addEventListener("storage", onStorage);
    window.addEventListener("wte-spawn-creature", onCustom as EventListener);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("wte-spawn-creature", onCustom as EventListener);
    };
  }, []);

  function pickTool(t: VttTool) {
    setTool(t);
    engineRef.current?.setTool(t);
  }
  function renameScene(name: string) {
    if (!scene) return;
    const next = { ...scene, name };
    setScene(next);
    if (engineRef.current?.scene) engineRef.current.scene.name = name;
    persist(engineRef.current?.scene ?? next);
  }

  const engine = engineRef.current;
  const live = engine?.scene ?? scene;
  const tokenCount = live?.data.tokens.length ?? 0;
  const fogOn = live?.data.fog.enabled ?? false;
  void tick; // engine mutations bump this to refresh derived values above

  // Show the live scene's current token count in the browser's active row.
  const browserScenes = live ? scenes.map((s) => (s.id === live.id ? { ...s, data: live.data } : s)) : scenes;
  // Abilities panel binds to the selected token's linked character, else a chosen
  // one, else the first vault character.
  const selTokenCharId = sel?.kind === "token" ? live?.data.tokens.find((t) => t.id === sel.id)?.characterId ?? null : null;
  const boundPlayerCharacterId = isNetPlayer ? net.table?.inUseCharacterId ?? null : null;
  const abilityCharKey = isNetPlayer ? boundPlayerCharacterId : abilityCharId ?? selTokenCharId ?? characters[0]?.id;
  const abilityChar = characters.find((c) => c.id === abilityCharKey) ?? null;
  const abilityCharacters = isNetPlayer
    ? characters.filter((record) => record.id === boundPlayerCharacterId)
    : characters;
  const rollActorToken = abilityChar
    ? live?.data.tokens.find(
        (token) => token.characterId === abilityChar.id && (!isNetPlayer || token.owner === net.selfId)
      ) ?? null
    : null;

  const requestTargetRoll = (intent: VttTargetRollIntent) => {
    if (net.status !== "connected" || net.role !== "host" || sel?.kind !== "token") return;
    const target = live?.data.tokens.find((token) => token.id === sel.id);
    if (!target?.owner || !target.characterId || target.prop) {
      pushToast("Select a player-controlled character token before requesting that roll.", "error");
      return;
    }
    const requestId = `rr-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
    const request: RollRequestMessage = {
      t: "roll-request",
      requestId,
      label: `${intent.abilityName} — ${intent.label}`,
      stat: intent.stat,
      dc: intent.dc,
      targetPeerId: target.owner,
      targetCharacterId: target.characterId,
      targetTokenId: target.id,
      sourceCharacterId: intent.sourceCharacterId,
      sourceAbilityId: intent.abilityId,
      sourceAbilityName: intent.abilityName,
      createdAt: Date.now(),
      expiresAt: Date.now() + 5 * 60_000,
    };
    const targetRecord = characters.find((record) => record.id === target.characterId);
    pendingRollRequests.current.set(requestId, {
      request,
      ownerPeerId: target.owner,
      expectedBaseExpr: targetRecord ? requestedStatExpr(targetRecord, intent.stat) : undefined,
    });
    window.setTimeout(() => pendingRollRequests.current.delete(requestId), 5 * 60_000 + 1000);
    net.publish(request, target.owner);
    const ownerName = net.peers.find((peer) => peer.id === target.owner)?.name || target.name;
    pushToast(`Requested ${intent.label} from ${ownerName}.`, "info");
  };

  // Place an ability's area template at the chosen anchor (caster token / selected
  // token / view centre). placeAoeAt leaves it selected so it can be nudged/resized.
  const placeAoe = (_ability: VttAbility, p: AoePlacement) => {
    const eng = engineRef.current;
    if (!eng) return;
    const tokens = eng.scene?.data.tokens ?? [];
    let pos: { x: number; y: number };
    if (p.mode === "self") {
      const caster = abilityChar ? tokens.find((t) => t.characterId === abilityChar.id) : null;
      pos = caster ? { x: caster.x, y: caster.y } : eng.viewCenterWorld();
    } else if (p.mode === "selected") {
      const t = sel?.kind === "token" ? tokens.find((x) => x.id === sel.id) : null;
      pos = t ? { x: t.x, y: t.y } : eng.viewCenterWorld();
    } else {
      pos = eng.viewCenterWorld();
    }
    eng.placeAoeAt(p.kind, pos.x, pos.y, { cells: p.cells, rounds: p.rounds });
  };

  return (
    <div className="vtt2">
      {!playHidden && (
      <VttToolbar
        sceneName={scene?.name ?? ""}
        onRename={renameScene}
        tokenCount={tokenCount}
        campaignReady={!!campaign}
        scenesOpen={leftPanel === "scenes"}
        actorsOpen={leftPanel === "actors"}
        encounterOpen={leftPanel === "encounter"}
        assetsOpen={leftPanel === "assets"}
        abilitiesOpen={leftPanel === "abilities"}
        rollsOpen={rollsOpen}
        atlasOpen={atlasOpen}
        gridOpen={gridOpen}
        onToggleAtlas={campaign ? () => { if (atlasPoppedRef.current) focusAtlasWindow(); else setAtlasOpen((v) => !v); } : undefined}
        onToggleScenes={campaign && !asPlayer ? () => setLeftPanel((p) => (p === "scenes" ? null : "scenes")) : undefined}
        onToggleActors={campaign ? () => setLeftPanel((p) => (p === "actors" ? null : "actors")) : undefined}
        onToggleEncounter={campaign && !asPlayer ? () => setLeftPanel((p) => (p === "encounter" ? null : "encounter")) : undefined}
        onToggleAssets={campaign && !asPlayer ? () => setLeftPanel((p) => (p === "assets" ? null : "assets")) : undefined}
        onToggleAbilities={campaign ? () => setLeftPanel((p) => (p === "abilities" ? null : "abilities")) : undefined}
        onToggleRolls={campaign ? () => setRollsOpen((v) => !v) : undefined}
        onToggleGrid={!asPlayer ? () => setGridOpen((v) => !v) : undefined}
        syncOn={sync.connected}
        syncPeers={sync.peerCount}
        play={
          !isNetPlayer
            ? {
                on: playMode.on,
                range: playMode.range,
                onToggle: () => setPlayMode({ on: !playMode.on, range: playMode.range }),
                onRange: (v) => setPlayMode({ on: playMode.on, range: v }),
              }
            : undefined
        }
        preview={!isNetPlayer ? { on: previewAs != null, onToggle: () => setPreviewAs((p) => (p != null ? null : net.peers.find((x) => x.role === "player")?.id ?? net.selfId)) } : undefined}
        cine={!isNetPlayer ? { on: cine.on, open: cineOpen, onToggle: () => setCineOpen((v) => !v) } : undefined}
      />
      )}
      {playHidden && (
        <div className="vtt2-playbar">
          <span className="vtt2-playbar-hint">Play mode — move your token · double-click or double-tap to ping</span>
          {campaign && (
            <button className={"chip" + (leftPanel === "abilities" ? " active" : "")} onClick={() => setLeftPanel((p) => (p === "abilities" ? null : "abilities"))}>
              Abilities
            </button>
          )}
          {campaign && (
            <button className={"chip" + (rollsOpen ? " active" : "")} onClick={() => setRollsOpen((v) => !v)}>
              Rolls
            </button>
          )}
          {campaign && (
            <button className={"chip" + (atlasOpen ? " active" : "")} onClick={() => { if (atlasPoppedRef.current) focusAtlasWindow(); else setAtlasOpen((v) => !v); }} title="The world map — where you are in the world, not just in the scene">
              Atlas
            </button>
          )}
          {!isNetPlayer && (
            <button className="chip" onClick={() => setPreviewAs(null)} title="Leave the player-view preview">
              Exit player view
            </button>
          )}
        </div>
      )}
      <div className="vtt2-stage" ref={hostRef}>
        <span className="vtt2-touch-hint" aria-hidden="true">One finger selects or drags · two fingers pan and pinch-zoom</span>
        {sel?.kind === "token" && engine?.canControlToken(sel.id) && (
          <VttRadialMenu engine={engine} tokenId={sel.id} />
        )}
      </div>
      {!playHidden && (
        <VttActionBar
          tool={tool}
          onTool={pickTool}
          builder={!asPlayer}
          canDraw={isNetPlayer && live?.data.allowPlayerDraw !== false}
          fogOn={fogOn}
          onToggleFog={!asPlayer ? () => engine?.toggleFog() : undefined}
          onResetFog={!asPlayer ? () => engine?.resetFog() : undefined}
          onSpawnActor={campaign && !asPlayer ? () => setLeftPanel((p) => (p === "actors" ? null : "actors")) : undefined}
          onAddAsset={campaign && !asPlayer ? () => setLeftPanel((p) => (p === "assets" ? null : "assets")) : undefined}
          onOpenAbilities={campaign ? () => setLeftPanel((p) => (p === "abilities" ? null : "abilities")) : undefined}
        />
      )}
      {campaign && !asPlayer && (
        <VttSceneWheel
          scenes={scenes}
          activeId={scene?.id ?? null}
          onSwitch={(id) => void switchScene(id)}
          onStep={stepScene}
          onSetBackground={(id) => {
            menuTarget.current = id;
            sceneBgRef.current?.click();
          }}
          onSetMusic={(id) => {
            menuTarget.current = id;
            sceneMusicRef.current?.click();
          }}
          onClearMusic={(id) => void patchScene(id, (s) => (s.data.audio = null))}
          onOpenSettings={() => setGridOpen(true)}
          onOpenSoundboard={() => setSoundboardOpen(true)}
          onOpenDialogue={() => setDialogueOpen(true)}
          onSetActiveForEveryone={(id) => void setActiveForEveryone(id)}
          pinnedId={pinnedSceneId}
          onReleasePin={() => void releasePin()}
          onSetFolder={(id, folder) => {
            void patchScene(id, (sc) => { sc.data.folder = folder ?? undefined; });
            // patchScene persists, but the rail renders from the scenes STATE —
            // whose copy of a non-active scene is a different object entirely
            setScenes((cur) => cur.map((sc) => (sc.id === id ? { ...sc, data: { ...sc.data, folder: folder ?? undefined } } : sc)));
          }}
          playerCount={net.status === "connected" ? net.peers.length : 0}
        />
      )}
      <input ref={sceneBgRef} type="file" accept="image/*" hidden onChange={(e) => void onSceneBgFile(e)} />
      <input ref={sceneMusicRef} type="file" accept="audio/*" hidden onChange={(e) => void onSceneMusicFile(e)} />
      <audio ref={audioRef} hidden />
      {gridOpen && !asPlayer && live && (
        <VttGridPanel
          grid={live.data.grid}
          background={live.data.background}
          terrain={live.data.terrain ?? null}
          atmosphere={live.data.atmosphere ?? null}
          audio={live.data.audio ?? null}
          shaderError={shaderError}
          onGrid={(patch) => engine?.setGrid(patch)}
          onBackground={(patch) => engine?.setBackgroundProps(patch)}
          onTerrain={(t) => engine?.setTerrain(t)}
          onAtmosphere={(a) => { setShaderError(""); engine?.setAtmosphere(a); }}
          onSetMusic={() => {
            if (live) {
              menuTarget.current = live.id;
              sceneMusicRef.current?.click();
            }
          }}
          onClearMusic={() => engine?.scene && void patchScene(engine.scene.id, (s) => (s.data.audio = null))}
          onMusicVolume={(v) => engine?.scene && void patchScene(engine.scene.id, (s) => { if (s.data.audio) s.data.audio.volume = v; })}
          fog={live.data.fog}
          onFog={(p) => engine?.setFogConfig(p)}
          lightCount={live.data.lights.length}
          onAllLights={(p) => engine?.updateAllLights(p)}
          otherScenes={scenes.filter((s) => s.id !== live.id).map((s) => ({ id: s.id, name: s.name }))}
          links={live.data.links ?? []}
          onLinks={(next) => void patchScene(live.id, (s) => (s.data.links = next))}
          zones={live.data.zones ?? {}}
          zoneBrush={zoneBrush}
          onZoneBrush={(b) => {
            setZoneBrush(b);
            if (engine) engine.zoneBrush = b;
            if (b) pickTool("zone");
            else if (tool === "zone") pickTool("select");
          }}
          onZoneClear={(k) => engine?.clearZone(k)}
          zoneGlsl={live.data.zoneGlsl ?? {}}
          onZoneGlsl={(k, body) => {
            setShaderError("");
            engine?.setZoneGlsl(k, body);
          }}
          allowPlayerDraw={live.data.allowPlayerDraw !== false}
          onAllowPlayerDraw={(allow) => engine?.setAllowPlayerDraw(allow)}
          onClearDrawings={() => engine?.clearDrawings()}
          onClose={() => setGridOpen(false)}
        />
      )}
      {campaign && leftPanel === "scenes" && (
        <VttSceneBrowser
          scenes={browserScenes}
          activeId={scene?.id ?? null}
          onSwitch={(id) => void switchScene(id)}
          onCreate={() => void createScene()}
          onRename={(id, name) => void renameSceneById(id, name)}
          onDelete={(id) => void deleteSceneById(id)}
          onClose={() => setLeftPanel(null)}
        />
      )}
      {campaign && leftPanel === "actors" && (
        <VttActorsPanel
          characters={isNetPlayer ? abilityCharacters : characters}
          loading={charsLoading}
          creatures={creatures}
          creaturesLoading={creaturesLoading}
          canSpawnCreatures={!asPlayer}
          canSpawnCharacters={!asPlayer}
          quickCreatures={quickCreatures}
          onSaveQuick={(qc) => setQuickCreatures(saveQuickCreature(qcCampaign, qc))}
          onDeleteQuick={(id) => setQuickCreatures(deleteQuickCreature(qcCampaign, id))}
          onSpawnQuick={spawnQuick}
          remoteChars={
            asPlayer
              ? [] // only the Curator gets live control over other players' sheets
              : partySheets
                  .filter((e) => e.ownerId !== net.selfId)
                  .map((e) => ({ id: e.record.id, name: e.record.name, owner: net.peers.find((p) => p.id === e.ownerId)?.name || "player" }))
          }
          roomPlayers={
            !asPlayer && net.status === "connected"
              ? net.peers
                  .filter((p) => p.role !== "host" && p.id !== net.selfId)
                  .map((p) => ({ id: p.id, name: p.name, shared: partySheets.some((e) => e.ownerId === p.id) }))
              : []
          }
          onRequestSheets={!asPlayer && net.status === "connected" ? requestSheets : undefined}
          onSpawn={spawnCharacter}
          onSpawnCreature={spawnCreature}
          onOpenSheet={(rec) => setSheetCharId(rec.id)}
          onOpenSheetId={(id) => setSheetCharId(id)}
          onRefresh={() => {
            void loadCharacters();
            void loadCreatures();
          }}
          onClose={() => setLeftPanel(null)}
        />
      )}
      {campaign && leftPanel === "encounter" && live && (
        <VttEncounterPanel
          campaignId={campaign.id}
          sceneId={live.id}
          tokens={live.data.tokens}
          linkedId={live.data.encounterId ?? null}
          onLink={(id) => engine?.setEncounterId(id)}
          onTimeline={(round, turn) => engine?.setTimeline(round, turn)}
          onTokenHp={(tokenId, hp) => engine?.updateToken(tokenId, { hp })}
          onFocusToken={(tokenId) => engine?.select({ kind: "token", id: tokenId })}
          onClose={() => setLeftPanel(null)}
        />
      )}
      {campaign && leftPanel === "assets" && (
        <VttAssetPanel
          assets={assets}
          loading={assetsLoading}
          hasSelectedToken={sel?.kind === "token"}
          currentBg={live?.data.background.src}
          onAdd={(kind, name, uri) => void addAssetEntry(kind, name, uri)}
          onDelete={(id) => void removeAsset(id)}
          onUseBackground={(uri) => engine?.setBackground(uri)}
          onApplyToToken={applyTokenArt}
          onPlaceProp={placeProp}
          onRefresh={() => void loadAssets()}
          onClose={() => setLeftPanel(null)}
        />
      )}
      {campaign && leftPanel === "abilities" && (
        <VttAbilitiesPanel
          layers={ruleLayers}
          character={abilityChar}
          characters={abilityCharacters.map((c) => ({ id: c.id, name: c.name }))}
          onPickCharacter={(id) => setAbilityCharId(id)}
          lockCharacter={isNetPlayer}
          onArmRoll={armRoll}
          onRequestTargetRoll={
            net.status === "connected" && net.role === "host" && sel?.kind === "token" && !!live?.data.tokens.find((token) => token.id === sel.id)?.owner
              ? requestTargetRoll
              : undefined
          }
          onUseAbility={(ability) => {
            // The roll already fired; if the ability implies an area, prompt to
            // place an editable hitbox.
            if (!asPlayer && hasAoe(ability.meta)) setPendingAoe(ability);
          }}
          onClose={() => setLeftPanel(null)}
        />
      )}
      {pendingAoe && (
        <VttAoePrompt
          ability={pendingAoe}
          casterName={abilityChar?.name ?? null}
          hasSelectedToken={sel?.kind === "token"}
          onCancel={() => setPendingAoe(null)}
          onPlace={(p) => {
            if (p.mode === "click") setArmedAoe({ kind: p.kind, cells: p.cells, rounds: p.rounds });
            else placeAoe(pendingAoe, p);
            setPendingAoe(null);
          }}
        />
      )}
      {armedAoe && (
        <div
          className="vtt2-aoe-place"
          onPointerDown={(e) => {
            if (!e.isPrimary || e.button !== 0) return; // right/middle keep panning
            e.preventDefault();
            const eng = engineRef.current;
            if (eng) {
              const w = eng.clientToWorld(e.clientX, e.clientY);
              eng.placeAoeAt(armedAoe.kind, w.x, w.y, { cells: armedAoe.cells, rounds: armedAoe.rounds });
            }
            setArmedAoe(null);
          }}
        >
          <span className="vtt2-aoe-place-hint">Click or tap to place the area · Esc to cancel</span>
        </div>
      )}
      {armedSound && (
        <div
          className="vtt2-aoe-place"
          onPointerDown={(e) => {
            if (!e.isPrimary || e.button !== 0) return;
            e.preventDefault();
            const eng = engineRef.current;
            if (eng) {
              const w = eng.clientToWorld(e.clientX, e.clientY);
              eng.addEmitterAt(w.x, w.y, armedSound);
            }
            setArmedSound(null);
          }}
        >
          <span className="vtt2-aoe-place-hint">Click or tap to pin “{armedSound.name}” to the map · Esc to cancel</span>
        </div>
      )}
      {cineOpen && !asPlayer && live && (
        <VttCinePanel
          tokens={live.data.tokens}
          cine={cine}
          onChange={setCine}
          envFx={live.data.envFx ?? null}
          onEnvFx={(f) => engineRef.current?.setSceneEnvFx(f)}
          onClose={() => setCineOpen(false)}
        />
      )}
      <VttDialogue />
      {campaign && dialogueOpen && net.role === "host" && (
        <VttDialogueController campaignId={campaign.id} onClose={() => setDialogueOpen(false)} />
      )}
      {rollScope && <VttRollToast campaignId={rollScope} />}
      {campaign && atlasOpen && (
        <AtlasWindow
          campaignId={campaign.id}
          curator={!asPlayer}
          focus={atlasFocus}
          onClose={() => {
            setAtlasOpen(false);
            // A consumed broadcast must not replay on the next manual open.
            setAtlasFocus(null);
          }}
          onPopOut={() => {
            void openAtlasWindow(
              { campaignId: campaign.id, curator: !asPlayer, netPlayer: isNetPlayer },
              () => setAtlasPopped(false)
            ).then((ok) => {
              if (ok !== true) {
                pushToast("The Atlas window could not be opened: " + ok, "error");
                return;
              }
              setAtlasPopped(true);
              setAtlasOpen(false);
              setAtlasFocus(null);
            });
          }}
        />
      )}
      {campaign && rollsOpen && (
        <VttRollFeed
          campaignId={campaign.id}
          sessionKey={rollScope ?? campaign.id}
          actor={{ characterId: abilityChar?.id, tokenId: rollActorToken?.id, name: abilityChar?.name }}
          publishRoll={publishVttRoll}
          authorizeMode={authorizeRollMode}
          lock={rollLock}
          onClearLock={() => setRollLocks((current) => current.slice(1))}
          onClose={() => setRollsOpen(false)}
        />
      )}
      {campaign && soundboardOpen && (
        <VttSoundboard
          campaignId={campaign.id}
          sceneName={scene?.name ?? "Scene"}
          onClose={() => setSoundboardOpen(false)}
          onPlaceEmitter={(s) => {
            setArmedSound(s);
            setSoundboardOpen(false);
          }}
        />
      )}
      {campaign && sheetCharId && (
        <div className="vtt2-sheet-overlay" onMouseDown={() => setSheetCharId(null)}>
          <div className="vtt2-sheet-modal" onMouseDown={(e) => e.stopPropagation()}>
            <CharacterSheet
              key={sheetCharId + ":" + sheetSyncTick}
              characterId={sheetCharId}
              campaignId={campaign.id}
              curator={!asPlayer}
              onBack={() => setSheetCharId(null)}
              onChanged={() => {
                void loadCharacters();
                void broadcastSheet(sheetCharId);
              }}
            />
          </div>
        </div>
      )}
      {!campaign && <div className="vtt2-sandbox-note">Sandbox table — pick a campaign on the Dashboard to persist scenes.</div>}
      {sel && engine && live && (!asPlayer || (sel.kind === "token" && engine.canControlToken(sel.id))) && (
        <VttInspector
          sel={sel}
          scene={live}
          onToken={(patch) => engine.updateToken(sel.id, patch)}
          onRecoverTokenOwner={sel.kind === "token" ? () => {
            const token = live.data.tokens.find((candidate) => candidate.id === sel.id);
            if (!token?.owner) return;
            const ownerName = net.peers.find((peer) => peer.id === token.owner)?.name || token.owner;
            if (!confirm(`Recover ${token.name} from ${ownerName}? This only clears ownership; no token position or character data changes.`)) return;
            if (engine.administrativelyAssignToken(sel.id, null)) {
              pushToast(`${token.name} is now Curator-controlled and can be reassigned.`, "info");
            }
          } : undefined}
          onTokenImage={(file) => {
            if (!file) return;
            void fileToPngDataUrl(file, 2048, 4 * 1024 * 1024)
              .then((uri) => engine.updateToken(sel.id, { img: uri }))
              .catch(() => pushToast("That image could not be used for the token.", "error"));
          }}
          onWall={(patch) => engine.updateWall(sel.id, patch)}
          onLight={(patch) => engine.updateLight(sel.id, patch)}
          onEmitter={(patch) => engine.updateEmitter(sel.id, patch)}
          onEffect={(patch) => engine.updateEffect(sel.id, patch)}
          onEffectKind={(kind) => engine.setEffectKind(sel.id, kind)}
          onDelete={() => engine.deleteSelected()}
          onClose={() => engine.select(null)}
          peers={net.status === "connected" ? net.peers.map((p) => ({ id: p.id, name: p.name })) : []}
          selfId={net.selfId}
          curator={!asPlayer}
        />
      )}
    </div>
  );
}
