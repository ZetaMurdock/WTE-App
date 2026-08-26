import { useCodex } from "../game/useCodex";
import { useCampaignCodex } from "../game/useCampaignCodex";
import { AtlasWindow, type AtlasFocus } from "./atlas/AtlasWindow";
import { loadAtlas } from "./atlas/atlasRepo";
import { atlasForRole, MAX_ATLAS_WIRE_CHARS } from "./atlas/atlasModel";
import { bridgeEmit, bridgeListen, focusAtlasWindow, openAtlasWindow } from "./atlas/atlasBridge";
import { listRuleLayers } from "../lib/ruleLayerRepo";
import { loadRules } from "../lib/campaignRules";
import type { RuleLayer } from "../game/ruleLayers";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { Campaign } from "../models/campaign";
import { isTauri } from "../lib/tauri";
import { PixiVttApp, peerInkColor, type PlaceAoeOptions, type VttSelection } from "./engine/PixiVttApp";
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
  type RollRequestMessage,
  type RollResultMessage,
  type VttMoveRequestMessage,
} from "../net/protocol";
import { addSessionRoll, clearSessionRolls, rollSessionScope } from "./sync/rollSession";
import { contestTokens } from "./data/genusContest";
import { enqueueRollLock } from "./sync/rollLocks";
import { canonicalRollExpr, createRollId, logRoll, validateCompletedRoll } from "../lib/rolls";
import { VttResolutionCard } from "./VttResolutionCard";
import { rollDiceExpr, type RollResult } from "../game/wte";
import {
  clearOutcomes,
  declareOutcomeVerdict,
  dismissOutcome,
  hpAfterConsequence,
  lapseOutcomes,
  listOutcomes,
  markOutcomeApplied,
  unmarkOutcomeApplied,
  openOutcome,
  pruneOutcomes,
  pushOutcome,
  setOutcomeDamageRoll,
  settleByRequest,
  subscribeOutcomes,
  syncOutcomeTargets,
  type DamageRollMode,
  type OutcomeConsequence,
  type OutcomeTarget,
  type PendingOutcome,
} from "./data/outcomeLedger";
import { outcomesFromProposals } from "./data/recurringOutcome";
import { crossingLine, outcomeFromCrossing } from "./data/counterOutcome";
import type { RecurringProposal } from "./engine/systems/RecurringEffectSystem";
import { declaredAuraOwner, declaredPlacement } from "./data/effectTicks";
import { declaredOrigin } from "../game/abilityOrigin";
import { planOrigin, type OriginPlan } from "./data/originAnchor";
import { SfxPlayer } from "./audio/sfxPlayer";
import { getMasterVolume, subscribeMasterVolume } from "../lib/audioPrefs";
import { reportSaveFailure, pushToast } from "../lib/appToast";
import { setUndoScope } from "../lib/undoRedo";
import { adjudicateUndoableVitals, applyUndoableCondition } from "./undo/vitalsUndo";
import { applyUndoableCounter } from "./undo/counterUndo";
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
import { VttSummonPrompt, type SummonMode, type SummonRow } from "./VttSummonPrompt";
import { VttTamperPrompt } from "./VttTamperPrompt";
import { pageTampers, planTamper, tamperRulingCard, type DeclaredTamper } from "./data/tamperPlan";
import { findTamperTarget, listTamperTargets, type TamperTarget } from "./data/tamperTargets";
import { commitUndoableTamper } from "./undo/tamperUndo";
import { hasAoe } from "./data/effectMeta";
import {
  MAX_SUMMON_BATCH,
  packSummonCells,
  pageSummons,
  resolvePageSummons,
  summonBodySize,
  summonPlan,
} from "./data/summonPlacement";
import type { CodexSummonEntry } from "./data/summonRoster";
import { tokenInEdge, arrivalPos } from "./data/sceneLinks";
import type { VttAbility } from "./data/characterAbilities";
import { requestedRollOptions } from "./data/requestedRoll";
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

// VTT v2 (slice 1): Pixi renders the map; React owns the chrome. Beside the
// legacy VTT, not inside it — see the rework spec in docs/ / session notes.
/** One shared empty list. A fresh `[]` per read is a new reference every time,
 *  which `useSyncExternalStore` reads as "changed" and re-renders forever. */
const NO_OUTCOMES: PendingOutcome[] = [];

export function VttScreen({ campaign: localCampaign, active = true }: { campaign: Campaign | null; active?: boolean }) {
  const net = useNet();
  const isNetPlayer = net.status === "connected" && net.role === "player";
  const roomCodex = useCampaignCodex();
  const roomCodexReady = !isNetPlayer || (
    roomCodex.status === "ready" &&
    !!net.table?.campaignId &&
    roomCodex.campaignId === net.table.campaignId
  );
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
  // The ability whose declared `Summon:` steps are waiting on the Curator. The
  // ROWS are not stored beside it: the creature roster is still loading when
  // this is set, and a snapshot taken at that moment would tell the Curator a
  // creature with a perfectly good Codex page has no statline.
  const [pendingSummon, setPendingSummon] = useState<VttAbility | null>(null);
  // The ability whose declared `Tamper:` steps are waiting on the Curator. Like
  // the summon above it holds the ABILITY and not a snapshot of what it will act
  // on: the scene keeps moving while the dialog is open — a field expires, a
  // body walks out of a zone — and a list captured at open time would offer to
  // negate something that is already over.
  const [pendingTamper, setPendingTamper] = useState<VttAbility | null>(null);
  // A soundboard clip armed for click-to-place as a spatial emitter.
  const [armedSound, setArmedSound] = useState<{ name: string; src: string } | null>(null);
  const [armedAoe, setArmedAoe] = useState<{ kind: AoeKind; cells: number; rounds: number; declared: PlaceAoeOptions } | null>(null);
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
      if (!rollScope) return;
      clearSessionRolls(rollScope);
      // The cards go with the rolls that made them. A resolution outlives its
      // session only as a proposal to damage a token from a table nobody is
      // sitting at any more.
      clearOutcomes(rollScope);
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

  // A burning field's round arrives here. The round hook lives inside the
  // engine, which has no idea what a campaign scope is and — deliberately —
  // no way to write the damage it just worked out. So it hands over proposals
  // and they become Resolution Cards: the SAME cards a one-shot save opens,
  // with the same auto-apply gate and the same authorised write behind every
  // button. A recurring save is not a new kind of resolution and must not grow
  // a second path with its own rules about what may land unattended.
  const recurringRef = useRef<(proposals: RecurringProposal[]) => void>(() => {});
  recurringRef.current = (proposals) => {
    if (!rollScope) return;
    // One card per field per round, carrying every token inside it. `pushOutcome`
    // replaces by id, and a round's id is effect + round, so the same round
    // delivered twice lands on the card that already exists.
    for (const card of outcomesFromProposals(proposals, Date.now())) pushOutcome(rollScope, card);
  };

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
  useEffect(() => {
    if (isNetPlayer && !roomCodexReady) setRollLocks([]);
  }, [isNetPlayer, roomCodexReady]);
  const pendingRollRequests = useRef(new Map<string, { request: RollRequestMessage; ownerPeerId: string; expectedBaseExprs?: string[] }>());
  const queueRollLock = useCallback((lock: RollLock) => {
    if (!roomCodexReady) {
      pushToast("Wait for the Curator's Codex to finish syncing before rolling.", "error");
      return;
    }
    setRollLocks((current) => enqueueRollLock(current, lock));
    setRollsOpen(true);
  }, [roomCodexReady]);
  const armRoll = useCallback((label: string, expr?: string) => {
    queueRollLock({ label, expr });
  }, [queueRollLock]);

  // A targeted save/check is armed only on the intended player's bound
  // character. The modifier is resolved from that player's current sheet.
  useEffect(() => {
    if (!isNetPlayer || !campaign || !roomCodexReady) return;
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
        const options = requestedRollOptions(record, request);
        if (options.length === 0) {
          pushToast("The Curator requested an invalid Roll Axis path.", "error");
          return;
        }
        const isAxisRequest = !!request.rollAxis;
        queueRollLock({
          label: request.label,
          expr: isAxisRequest ? undefined : options[0].expr,
          choices: isAxisRequest ? options : undefined,
          requestId: request.requestId,
          requestedBy: peersRef.current.find((peer) => peer.id === from)?.name || "Curator",
          dc: request.dc,
        });
      });
    });
  }, [campaign, isNetPlayer, net.selfId, net.subscribe, net.table?.inUseCharacterId, queueRollLock, roomCodexReady]);

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
        (pending.expectedBaseExprs != null && !pending.expectedBaseExprs.includes(validated.baseExpr))
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
      // The verdict is the same number the feed just published — the card can
      // never disagree with the dice the table watched land.
      if (rollScope) settleByRequest(rollScope, result.requestId, validated.result);
    });
  }, [campaign, characters, net.publish, net.role, net.subscribe, rollScope]);

  const publishVttRoll = useCallback(
    (message: RollMessage) => {
      if (!roomCodexReady) {
        pushToast("That roll was blocked because the Curator's Codex is not ready.", "error");
        return;
      }
      const requested = asRollResultMessage(message);
      if (requested && isNetPlayer) {
        const hostId = peersRef.current.find((peer) => peer.role === "host")?.id;
        if (hostId) net.publish(requested, hostId);
        else pushToast("The requested roll could not reach the Curator.", "error");
        return;
      }
      // A Curator rolling a request on their own machine has no wire round-trip
      // to correlate it, so the card is settled where the dice are committed —
      // the same number the feed just recorded, never a second throw.
      if (rollScope && message.requestId) settleByRequest(rollScope, message.requestId, message.result);
      if (net.status === "connected") net.publish(message);
    },
    [isNetPlayer, net, rollScope, roomCodexReady]
  );

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
    engine.onRecurring = (proposals) => recurringRef.current(proposals);
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
  // Undo history follows the SCENE, not only the tab. An inverse for damage on
  // a map the Curator has since left would write HP back on bodies nobody is
  // looking at — the same invisible edit the workspace scoping exists to stop.
  // The key nests under App's `workspace:vtt2`, so a tab switch still clears it.
  const liveSceneId = live?.id ?? null;
  useEffect(() => {
    if (!active || !liveSceneId) return;
    setUndoScope(`workspace:vtt2:${liveSceneId}`);
  }, [active, liveSceneId]);
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

  // ── Genus contest: Curator's combatant vs the selected token ──
  // The defender is whatever token is selected, resolved to its character
  // record. Both sides' Focus, Control and rank come off the records; the
  // defender answers with their most strongly focused genus.
  const contestDefender = useMemo(() => {
    if (asPlayer || sel?.kind !== "token") return null;
    const token = live?.data.tokens.find((candidate) => candidate.id === sel.id);
    if (!token?.characterId || token.characterId === abilityChar?.id) return null;
    const record =
      characters.find((candidate) => candidate.id === token.characterId) ??
      partySheets.find((entry) => entry.record.id === token.characterId)?.record ??
      null;
    return record ? { record, name: record.name || token.name || "the target", tokenId: token.id } : null;
  }, [asPlayer, sel, live, characters, partySheets, abilityChar]);

  /** Put a roll the Curator's own machine threw into the shared feed, so the
   *  table sees the dice behind a verdict rather than only its conclusion. */
  const commitRollToFeed = useCallback(
    (roll: RollResult | undefined, who: string, characterId: string | undefined) => {
      if (!roll || !rollScope) return;
      const modifier = roll.detail.modifier;
      const baseExpr = roll.baseExpr ?? `1d${roll.detail.die}${modifier > 0 ? `+${modifier}` : modifier < 0 ? String(modifier) : ""}`;
      const id = createRollId();
      const at = Date.now();
      addSessionRoll(rollScope, {
        id,
        label: roll.detail.label,
        formula: roll.formula,
        baseExpr,
        result: roll.result,
        mode: roll.detail.mode ?? "normal",
        detail: roll.detail,
        who,
        at,
        characterId,
      });
      publishVttRoll({
        t: "roll",
        id,
        label: roll.detail.label,
        formula: roll.formula,
        baseExpr,
        result: roll.result,
        mode: roll.detail.mode ?? "normal",
        detail: roll.detail,
        at,
        actor: { characterId, name: who },
      } as RollMessage);
    },
    [rollScope, publishVttRoll]
  );

  const contestSelectedToken = useCallback(
    (ability: VttAbility) => {
      if (!abilityChar || !contestDefender) return;
      const outcome = contestTokens(abilityChar, ability, contestDefender.record, ruleLayers);
      if (!outcome) {
        pushToast(`${contestDefender.name} has no genus to contest ${ability.name} — it resolves unopposed.`, "info");
        return;
      }
      // Dice were thrown only on a Focus tie; commit them to the feed so the
      // whole table sees the same contested Control rolls the verdict used.
      commitRollToFeed(outcome.result.aRoll, abilityChar.name || "Attacker", abilityChar.id);
      commitRollToFeed(outcome.result.bRoll, contestDefender.name, contestDefender.record.id);
      pushToast(
        `Contest — ${ability.name} (Focus ${outcome.attacker.focus}) vs ${contestDefender.name}'s ${outcome.defenderAbility} (Focus ${outcome.defender.focus}): ${outcome.verdict}`,
        "info",
        9000
      );
    },
    [abilityChar, contestDefender, commitRollToFeed, ruleLayers]
  );

  // ── The outcome ledger ────────────────────────────────────────────────────
  // A requested save is only half a resolution; the other half is what failing
  // it costs. These cards carry that second half — and never apply it
  // themselves. Every number below reaches a token through the same validated
  // op a Curator's manual edit uses.
  const outcomes = useSyncExternalStore(
    useCallback(
      (listener: () => void) => (rollScope ? subscribeOutcomes(rollScope, listener) : () => {}),
      [rollScope]
    ),
    useCallback(() => (rollScope ? listOutcomes(rollScope) : NO_OUTCOMES), [rollScope])
  );

  // The table's confirm policy, re-read on the same signal `saveRules` fires.
  // Read only at mount, it would strand a Curator who switched auto-apply on
  // mid-session: the cards already on screen would keep asking for two clicks
  // until something unrelated happened to re-render the map.
  const [autoApplyDeclared, setAutoApplyDeclared] = useState(false);
  useEffect(() => {
    const id = campaign?.id;
    const read = () => setAutoApplyDeclared(id ? loadRules(id).autoApplyDeclared : false);
    read();
    window.addEventListener("wte-pages-changed", read);
    return () => window.removeEventListener("wte-pages-changed", read);
  }, [campaign?.id]);

  // The ledger's expiry is only a promise until something enforces it. A card
  // whose roll never came would otherwise sit over the map for the rest of the
  // session, and a scope the table has left would keep its dead cards forever.
  useEffect(() => {
    if (!rollScope) return;
    const timer = window.setInterval(() => pruneOutcomes(rollScope, Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, [rollScope]);

  const outcomeToken = useCallback(
    (target: OutcomeTarget) =>
      target.tokenId ? live?.data.tokens.find((token) => token.id === target.tokenId) ?? null : null,
    [live]
  );

  // A batch card can outlive the bodies on it: a 23-target zone resolves over
  // several wire round-trips, and a token can die, be deleted or be dragged to
  // another scene in between. Reconciling against the live scene moves that fact
  // onto the row BEFORE the Curator clicks Apply, instead of leaving them to
  // discover it from a refusal toast afterwards.
  useEffect(() => {
    if (!rollScope || !live) return;
    syncOutcomeTargets(rollScope, new Set(live.data.tokens.map((token) => token.id)));
  }, [live, rollScope]);

  // The round advanced. Targets that never rolled are MARKED, never resolved —
  // see `lapsePendingTargets` for why silently expiring and silently applying
  // are both refusals of the Curator's authority rather than conveniences.
  //
  // Fires on a CHANGE, exactly like the encounter tick, and never on the first
  // reading: a card opened during round 4 would otherwise be told, in the same
  // frame, that round 4 had already moved on without it.
  const timelineRound = live?.data.timeline.round;
  const lastRound = useRef<number | null>(null);
  useEffect(() => {
    if (!rollScope || timelineRound == null) return;
    const prior = lastRound.current;
    lastRound.current = timelineRound;
    if (prior == null || timelineRound <= prior) return;
    lapseOutcomes(rollScope, timelineRound);
  }, [rollScope, timelineRound]);

  const rollConsequence = useCallback(
    (outcome: PendingOutcome, consequence: OutcomeConsequence): number | null => {
      if (!consequence.expr) return null;
      const roll = rollDiceExpr(`${outcome.sourceAbilityName} — ${consequence.label}`, consequence.expr);
      if (!roll) return null;
      // The caster is the one this CARD names. Reading the Abilities panel's
      // current pick instead would file the damage under whoever the Curator
      // happened to click between the save and applying what it cost.
      const caster = outcome.casterCharacterId
        ? characters.find((record) => record.id === outcome.casterCharacterId) ?? null
        : null;
      commitRollToFeed(roll, caster?.name || "Curator", caster?.id);
      return roll.result;
    },
    [characters, commitRollToFeed]
  );

  const applyOutcomeDamage = useCallback(
    (outcome: PendingOutcome, target: OutcomeTarget, consequence: OutcomeConsequence, amount: number) => {
      const engine = engineRef.current;
      const token = outcomeToken(target);
      if (!engine || !token) {
        pushToast(`${target.name} is no longer on this scene.`, "error");
        return;
      }
      if (token.hp == null) {
        pushToast(`${token.name} tracks no HP — set its vitals before applying damage.`, "error");
        return;
      }
      // Read BEFORE the write: the engine mutates this very token in place, so
      // a toast that interpolated `token.hp` afterwards would report the new
      // value on both sides of the arrow — "13 → 13" for a hit of 27.
      const before = token.hp;
      const next = hpAfterConsequence(before, token.hpMax, amount);
      // Nothing is announced and nothing is marked applied until the op is
      // actually authored. A card claiming damage the engine refused would send
      // the table on with a wrong number and no way to notice.
      // The row's "applied" mark rides the same undo entry as the HP. Restoring
      // the body while the card still read "Applied" would leave the Curator
      // looking at healed damage with no way to rule on it again.
      const scope = rollScope;
      // A heal comes through this same path with a negative amount. Labelling
      // its inverse "damage to Vex" would put a tooltip on the undo button
      // naming an act that never happened, on the one control whose entire job
      // is to say what it is about to take back.
      const act = amount >= 0 ? "damage to" : "healing on";
      if (!adjudicateUndoableVitals(engine, token.id, { hp: next }, {
        label: `${act} ${token.name}`,
        subject: token.name,
        onRefused: (reason) => pushToast(reason, "error"),
        restore: scope
          ? (phase) => (phase === "undo" ? unmarkOutcomeApplied : markOutcomeApplied)(scope, outcome.id, target.id, consequence.id)
          : undefined,
      })) {
        pushToast(`${token.name}'s HP was not changed — that token could not be written to.`, "error");
        return;
      }
      if (rollScope) markOutcomeApplied(rollScope, outcome.id, target.id, consequence.id);
      const verb = amount >= 0 ? "took" : "healed";
      pushToast(`${token.name} ${verb} ${Math.abs(amount)} — ${before} → ${next} HP.`, "info");
    },
    [outcomeToken, rollScope]
  );

  const applyOutcomeCondition = useCallback(
    (outcome: PendingOutcome, target: OutcomeTarget, consequence: OutcomeConsequence) => {
      const engine = engineRef.current;
      const token = outcomeToken(target);
      // The BARE name, not the formatted tag: the countdown lives in the scene's
      // condition clocks, so a pip reading "Slowed (2)" would make a second
      // application of "Slowed (3)" look like a different condition and defeat
      // the Stacking rule its page declares.
      const status = consequence.condition?.trim();
      if (!engine || !token || !status) {
        pushToast(`${target.name} is no longer on this scene.`, "error");
        return;
      }
      const scope = rollScope;
      if (!applyUndoableCondition(engine, { tokenId: token.id, status, rounds: consequence.rounds }, {
        label: `${status} on ${token.name}`,
        subject: token.name,
        onRefused: (reason) => pushToast(reason, "error"),
        restore: scope
          ? (phase) => (phase === "undo" ? unmarkOutcomeApplied : markOutcomeApplied)(scope, outcome.id, target.id, consequence.id)
          : undefined,
      })) {
        pushToast(`${status} was not applied — ${token.name} could not be written to.`, "error");
        return;
      }
      if (rollScope) markOutcomeApplied(rollScope, outcome.id, target.id, consequence.id);
      const clock = consequence.rounds ? ` for ${consequence.rounds} round${consequence.rounds === 1 ? "" : "s"}` : "";
      pushToast(`${token.name} is ${status}${clock}.`, "info");
    },
    [outcomeToken, rollScope]
  );

  /**
   * Move a custom-currency track, and hand any mark it crossed straight back to
   * the Curator.
   *
   * The crossing is the whole reason this is not just another vitals write. `At
   * 8: Damage: 1d100` is an ordinary consequence that happens to be armed by an
   * integer, so it opens its own Resolution Card rather than applying itself —
   * the same rule the recurring ticks follow, for the same reason: an engine
   * that could commit a 1d100 because a number reached 8 would be adjudicating,
   * and adjudicating is the Curator's.
   *
   * The card is pushed only AFTER the engine reports the move landed. A refused
   * write (a player-owned token, a body that left the scene) must not leave a
   * threshold card standing for a track that never moved.
   *
   * Undo has to take the crossing's CARD back too, not only the number. Putting
   * Blight back to 7 while "Blight reached 8" still sat on screen would leave
   * the Curator holding a 1d100 armed by an arrival that no longer happened —
   * so the card is captured here and swapped by the same inverse.
   */
  const applyOutcomeCounter = useCallback(
    (outcome: PendingOutcome, target: OutcomeTarget, consequence: OutcomeConsequence) => {
      const engine = engineRef.current;
      const token = outcomeToken(target);
      const name = consequence.counter?.trim();
      if (!engine || !token || !name || !consequence.delta) {
        pushToast(`${target.name} is no longer on this scene.`, "error");
        return;
      }
      const scope = rollScope;
      // Filled below, read only when an inverse runs — by then the crossing has
      // either produced a card or it has not.
      let crossingCard: PendingOutcome | null = null;
      const plan = applyUndoableCounter(
        engine,
        {
          tokenId: token.id,
          name,
          delta: consequence.delta,
          cap: consequence.cap,
          thresholds: (consequence.thresholds ?? []).map((threshold) => threshold.at),
        },
        {
          label: `${name} ${consequence.delta > 0 ? "+" : ""}${consequence.delta} on ${token.name}`,
          subject: token.name,
          onRefused: (reason) => pushToast(reason, "error"),
          restore: scope
            ? (phase) => {
                (phase === "undo" ? unmarkOutcomeApplied : markOutcomeApplied)(
                  scope, outcome.id, target.id, consequence.id
                );
                if (!crossingCard) return;
                if (phase === "undo") dismissOutcome(scope, crossingCard.id);
                else pushOutcome(scope, crossingCard);
              }
            : undefined,
        }
      );
      if (!plan) {
        pushToast(`${name} was not changed — ${token.name} could not be written to.`, "error");
        return;
      }
      if (rollScope) markOutcomeApplied(rollScope, outcome.id, target.id, consequence.id);
      pushToast(
        `${token.name}: ${crossingLine(plan.name, plan.to, plan.cap, plan.crossed)}${plan.capped ? " (at the cap)" : ""}.`,
        "info"
      );
      if (!plan.crossed.length || !rollScope) return;
      const card = outcomeFromCrossing({
        outcome,
        target,
        consequence,
        crossed: plan.crossed,
        value: plan.to,
        now: Date.now(),
      });
      if (!card) return;
      // Recorded, not re-derived on redo: the card carries the crossing the
      // table watched, and rebuilding it would restamp its timestamp and TTL.
      crossingCard = card;
      pushOutcome(rollScope, card);
    },
    [outcomeToken, rollScope]
  );

  // Both go through the scope, not through the card in hand. The card React is
  // holding is a snapshot, and on a 23-target zone the other rows are still
  // settling off the wire while the Curator reads it — writing the snapshot back
  // would erase every roll that landed in between.
  const declareOutcome = useCallback(
    (outcome: PendingOutcome, target: OutcomeTarget, verdict: "pass" | "fail") => {
      if (rollScope) declareOutcomeVerdict(rollScope, outcome.id, target.id, verdict);
    },
    [rollScope]
  );

  const chooseDamageRoll = useCallback(
    (outcome: PendingOutcome, mode: DamageRollMode) => {
      if (rollScope) setOutcomeDamageRoll(rollScope, outcome.id, mode);
    },
    [rollScope]
  );

  const dropOutcome = useCallback(
    (outcomeId: string) => {
      if (rollScope) dismissOutcome(rollScope, outcomeId);
    },
    [rollScope]
  );

  const abilityCharacters = isNetPlayer
    ? characters.filter((record) => record.id === boundPlayerCharacterId)
    : characters;
  const rollActorToken = abilityChar
    ? live?.data.tokens.find(
        (token) => token.characterId === abilityChar.id && (!isNetPlayer || token.owner === net.selfId)
      ) ?? null
    : null;

  const requestTargetRoll = (intent: VttTargetRollIntent) => {
    if (asPlayer || sel?.kind !== "token") return;
    const target = live?.data.tokens.find((token) => token.id === sel.id);
    if (!target || target.prop) {
      pushToast("Select a target token before resolving that roll.", "error");
      return;
    }
    const now = Date.now();
    const requestId = `rr-${now.toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
    // A player-owned character answers for itself over the wire. Everything
    // else — an NPC, a creature, or the whole table sitting offline — is the
    // Curator's to roll, and the card is the same either way.
    const overWire =
      net.status === "connected" && net.role === "host" && !!target.owner && !!target.characterId;
    const targetRecordForRoll = target.characterId
      ? characters.find((record) => record.id === target.characterId) ?? null
      : null;
    if (rollScope) {
      pushOutcome(
        rollScope,
        openOutcome({
          id: `oc-${requestId}`,
          sourceAbilityId: intent.abilityId,
          sourceAbilityName: intent.abilityName,
          effect: intent.effect,
          // Both travel; the ledger decides. Declared steps supersede the prose
          // deriver there, in one place, so this call site cannot become a
          // second opinion about which source wins.
          steps: intent.steps,
          casterCharacterId: intent.sourceCharacterId,
          // One target, which is the batch card's degenerate case — the same
          // card, the same store and the same policies an area ability gets.
          targets: [{ tokenId: target.id, name: target.name, requestId }],
          dc: intent.dc,
          rollLabel: intent.label,
          now,
        })
      );
    }
    if (!overWire) {
      const options = targetRecordForRoll ? requestedRollOptions(targetRecordForRoll, intent) : [];
      // A Roll Axis request answers with BOTH legal sources, and which one a
      // target answers with belongs to the table, not to the engine. Taking the
      // first would silently deny every locally-rolled save its specialty route,
      // so the Curator is handed the same choice the player's tray offers; the
      // request id rides along and the tray's own roll settles this card.
      if (options.length > 1) {
        queueRollLock({
          label: `${target.name} — ${intent.label}`,
          choices: options,
          requestId,
          dc: intent.dc,
          actor: { characterId: target.characterId, tokenId: target.id, name: target.name },
        });
        return;
      }
      // No record to roll from (a bare creature token) leaves the card pending
      // rather than inventing a modifier — the Curator declares it at the table.
      const roll = options[0] ? rollDiceExpr(`${target.name} — ${intent.label}`, options[0].expr) : null;
      if (roll) {
        commitRollToFeed(roll, target.name, target.characterId ?? undefined);
        if (rollScope) settleByRequest(rollScope, requestId, roll.result);
      } else {
        pushToast(`Roll ${intent.label} for ${target.name}, then set the verdict on the card.`, "info");
      }
      return;
    }
    const request: RollRequestMessage = {
      t: "roll-request",
      requestId,
      label: `${intent.abilityName} — ${intent.label}`,
      stat: intent.stat,
      rollAxis: intent.rollAxis,
      dc: intent.dc,
      targetPeerId: target.owner as string,
      targetCharacterId: target.characterId as string,
      targetTokenId: target.id,
      sourceCharacterId: intent.sourceCharacterId,
      sourceAbilityId: intent.abilityId,
      sourceAbilityName: intent.abilityName,
      createdAt: now,
      expiresAt: now + 5 * 60_000,
    };
    const expectedOptions = targetRecordForRoll ? requestedRollOptions(targetRecordForRoll, intent) : undefined;
    pendingRollRequests.current.set(requestId, {
      request,
      ownerPeerId: target.owner as string,
      // Canonicalized: the responder's tray sends canonicalRollExpr output, so
      // the comparison must be canonical-vs-canonical or it never matches.
      expectedBaseExprs: expectedOptions
        ?.map((option) => canonicalRollExpr(option.expr) ?? option.expr),
    });
    window.setTimeout(() => pendingRollRequests.current.delete(requestId), 5 * 60_000 + 1000);
    net.publish(request, target.owner);
    const ownerName = net.peers.find((peer) => peer.id === target.owner)?.name || target.name;
    pushToast(`Requested ${intent.label} from ${ownerName}.`, "info");
  };

  // Place an ability's area template at the chosen anchor (caster token / selected
  // token / view centre). placeAoeAt leaves it selected so it can be nudged/resized.
  // What the PAGE declared, when it declared anything, in the form a placement
  // takes. The prompt still owns shape, size and lifetime — the Curator re-aims
  // and resizes on the fly, and a declared block must not take that away — but
  // the cadence, the in-zone tag and the anchor are mechanics, not placement,
  // and they come off the page.
  //
  // Derived HERE rather than inside `placeAoe`, because the prompt's "click"
  // mode does not place anything: it arms the cursor and the template lands on a
  // later pointer event, from React state. Deriving it at the drop site left
  // that path reading nothing at all, so the most natural way to aim a field —
  // click where you want it — was the one way that placed an inert circle.
  //
  // Provenance rides only a template that actually keeps happening. It is read
  // by exactly one thing, the card a round's ticks open, so writing it onto
  // every hand-placed area would put a field in the scene and on the wire that
  // no reader ever looks at, for the whole undeclared corpus.
  /**
   * Where this ability fires FROM, resolved against the scene on screen.
   *
   * Read from BOTH halves of the page — an `Origin:` bullet where the block
   * declares one, and the `Component:` header otherwise, which is how all 148
   * shipped Ciphers already say it. Recomputed at each use rather than memoised
   * because it depends on where bodies are STANDING: an origin that resolved to
   * a token two rounds ago is a stale square now.
   */
  const abilityOriginPlan = (ability: VttAbility): OriginPlan => {
    const data = engineRef.current?.scene?.data ?? null;
    const caster = abilityChar ? data?.tokens.find((t) => t.characterId === abilityChar.id) ?? null : null;
    return planOrigin(declaredOrigin(ability.effect, ability.actions), data, caster?.id ?? null);
  };

  const declaredAoeOptions = (ability: VttAbility): PlaceAoeOptions => {
    const placement = declaredPlacement(ability.actions);
    const tokens = engineRef.current?.scene?.data.tokens ?? [];
    const casterToken = abilityChar ? tokens.find((t) => t.characterId === abilityChar.id) ?? null : null;
    // What one template cannot carry is said out loud. A page that declared two
    // recurring saves is asking for two resolutions and gets one; silence would
    // let it deliver less than it promised and still look complete.
    if (placement.extraStatuses.length || placement.extraSaves.length) {
      const missed = [...placement.extraStatuses, ...placement.extraSaves.map((tick) => tick.label)];
      pushToast(`${ability.name}: this template carries one in-zone tag and one recurring save — ${missed.join(", ")} needs its own.`, "info");
    }
    // `attach self` names the body the field rides, and an ability with a
    // declared ORIGIN does not fire from the caster's body — a Cipher mounted
    // on a Component is standing wherever the Component is. So the origin's
    // token, when the map found one, is the body the aura rides; the caster is
    // the fallback for the abilities that never declared an origin, which is
    // every one of them today. Same binding either way: `auraTokenId`, the
    // reconcile pass P3 already wired into every path that moves a body.
    const originToken = abilityOriginPlan(ability).tokenId;
    const auraOwner = declaredAuraOwner(placement, originToken ?? casterToken?.id ?? null);
    return {
      ...(placement.status ? { status: placement.status } : {}),
      ...(placement.ticks.length
        ? {
            ticks: placement.ticks,
            ...(ability.abilityId ? { sourceAbilityId: ability.abilityId } : {}),
            sourceAbilityName: ability.name,
            ...(abilityChar ? { casterCharacterId: abilityChar.id } : {}),
          }
        : {}),
      ...(auraOwner ? { auraTokenId: auraOwner } : {}),
    };
  };

  // ── Declared summons ───────────────────────────────────────────────────────
  // The table's own creature content, in the shape `resolveSummon` matches
  // names against. Derived through `computeCreature` — the same derivation the
  // Actors panel spawns a creature with — so a Lesser Stygian called up by an
  // ability and one dropped by hand cannot end up with different HP.
  const summonRoster = useMemo(
    () => ({
      quick: quickCreatures,
      codex: creatures.map((c): CodexSummonEntry => {
        const derived = computeCreature(c);
        return {
          name: c.name,
          cls: c.cls,
          hp: derived.hp,
          dr: derived.dr,
          size: derived.size,
          flags: derived.flags,
          stats: c.stats,
          traits: c.traits,
          desc: c.lore,
        };
      }),
    }),
    [quickCreatures, creatures]
  );

  const summonRows: SummonRow[] = useMemo(
    () => (pendingSummon ? resolvePageSummons(pendingSummon.actions, summonRoster) : []),
    [pendingSummon, summonRoster]
  );

  /** Where a summon packs outward from, for the anchor the Curator picked. */
  const summonAnchor = (mode: SummonMode): { x: number; y: number } | null => {
    const eng = engineRef.current;
    const tokens = eng?.scene?.data.tokens ?? [];
    if (mode === "self") {
      const caster = abilityChar ? tokens.find((t) => t.characterId === abilityChar.id) : null;
      return caster ? { x: caster.x, y: caster.y } : null;
    }
    if (mode === "selected") {
      const picked = sel?.kind === "token" ? tokens.find((t) => t.id === sel.id) : null;
      return picked ? { x: picked.x, y: picked.y } : null;
    }
    return eng ? eng.viewCenterWorld() : null;
  };

  const casterToken = () => {
    const tokens = engineRef.current?.scene?.data.tokens ?? [];
    return abilityChar ? tokens.find((t) => t.characterId === abilityChar.id) ?? null : null;
  };

  /** How many of a row's bodies the map could actually hold at that anchor —
   *  asked live as the Curator switches anchors, so the shortfall is visible
   *  while the placement is still cancellable. */
  const summonRoomFor = (row: SummonRow, mode: SummonMode): number => {
    const scene = engineRef.current?.scene;
    const anchor = summonAnchor(mode);
    if (!scene || !anchor) return 0;
    const want = Math.min(row.summon.count, MAX_SUMMON_BATCH);
    return packSummonCells(scene.data.grid, scene.data.tokens, anchor, summonBodySize(row.resolution), want).length;
  };

  /**
   * Commit every declared summon on one page as one act per creature.
   *
   * Ids are minted HERE and handed to the planner, which stays pure: a planner
   * that generated its own ids could not be re-run to preview a placement
   * without inventing a hundred throwaway token ids each time the Curator moved
   * the anchor.
   */
  const placeSummons = (mode: SummonMode) => {
    const eng = engineRef.current;
    const scene = eng?.scene;
    if (!eng || !scene) return;
    const anchor = summonAnchor(mode);
    if (!anchor) {
      pushToast("There is nowhere to gather them — pick another anchor.", "error");
      return;
    }
    const ability = pendingSummon;
    if (!ability) return;
    const caster = casterToken();
    for (const row of summonRows) {
      const plan = summonPlan({
        summon: row.summon,
        resolution: row.resolution,
        // Read fresh each time round: the previous row's bodies are already on
        // the scene and the next row must pack around them, not through them.
        scene: eng.scene ?? scene,
        anchor,
        batchId: newId("sm"),
        origin: {
          sourceAbilityId: ability.abilityId,
          sourceAbilityName: ability.name,
          casterCharacterId: abilityChar?.id,
          casterTokenId: caster?.id,
          bornRound: (eng.scene ?? scene).data.timeline.round,
        },
        tokenIds: Array.from({ length: Math.min(row.summon.count, MAX_SUMMON_BATCH) }, () => newId("tk")),
      });
      if (!plan.ok) {
        pushToast(plan.detail, "error", 0);
        continue;
      }
      const placed = eng.placeSummonBatch(plan.tokens);
      if (placed === 0) {
        pushToast(`${row.summon.name} could not be placed.`, "error");
        continue;
      }
      const shortfall = plan.shortfall > 0 ? ` — ${plan.shortfall} had nowhere to stand` : "";
      const unstatted = plan.unstatted
        ? ` They carry no profile: nothing in this campaign is named “${row.summon.name}”.`
        : "";
      pushToast(`Placed ${placed} × ${row.summon.name}${shortfall}.${unstatted}`, "info", plan.unstatted ? 0 : undefined);
    }
    setPendingSummon(null);
  };

  /** Dismissal for the selected body's whole batch — Curator only, and only
   *  when the selected token actually came from a summon. */
  const dismissSummonOf = (selection: VttSelection): (() => void) | undefined => {
    if (asPlayer || selection?.kind !== "token") return undefined;
    const token = live?.data.tokens.find((t) => t.id === selection.id);
    const origin = token?.meta?.summon;
    if (!origin) return undefined;
    return () => {
      const eng = engineRef.current;
      if (!eng) return;
      // A body handed to a player is not the Curator's to remove, and the count
      // in the prompt has to be the count that will actually go — a dialog that
      // said 100 and dismissed 98 would leave two minions standing with no
      // explanation on screen for why.
      const { total, refused } = eng.summonBatchCensus(origin.batchId);
      const held = refused ? ` (${refused} assigned to a player will stay)` : "";
      if (!confirm(`Dismiss ${total - refused} × ${origin.name} summoned by ${origin.sourceAbilityName}?${held}`)) return;
      const gone = eng.dismissSummonBatch(origin.batchId);
      if (gone) pushToast(`Dismissed ${gone} × ${origin.name}.${held}`, "info");
    };
  };

  // ── Tamper: one ability acting on another ability's effect ───────────────
  //
  // Everything here reads the LIVE scene rather than a captured list, and the
  // preview is recomputed on every render for the same reason the summon prompt
  // asks `roomFor` live: a Curator with the dialog open is looking at a map that
  // is still moving.

  const tamperSteps: DeclaredTamper[] = useMemo(
    () => (pendingTamper ? pageTampers(pendingTamper.actions) : []),
    [pendingTamper]
  );

  const tamperTargets: TamperTarget[] = useMemo(
    () => (pendingTamper && live ? listTamperTargets(live.data) : []),
    [pendingTamper, live]
  );

  /** The body of whoever raised an effect. `reflect` needs a TOKEN and the
   *  effect records a CHARACTER, so the join happens here — the only layer that
   *  holds both — and an absent answer is passed through as absent rather than
   *  substituted for. */
  const tamperSource = (casterCharacterId: string | undefined) => {
    if (!casterCharacterId || !live) return { sourceTokenId: undefined, sourceName: undefined };
    const token = live.data.tokens.find((candidate) => candidate.characterId === casterCharacterId);
    const record = characters.find((candidate) => candidate.id === casterCharacterId);
    return { sourceTokenId: token?.id, sourceName: record?.name ?? token?.name };
  };

  const previewTamper = (step: DeclaredTamper, targetId: string) => {
    const data = engineRef.current?.scene?.data ?? live?.data;
    if (!data) return null;
    const target = findTamperTarget(data, targetId);
    if (!target) return null;
    return planTamper({
      data,
      target,
      mode: step.mode,
      rounds: step.rounds,
      ...tamperSource(target.casterCharacterId),
    });
  };

  /**
   * Commit one tamper.
   *
   * Re-planned against the live scene at the moment of the click rather than
   * committing the proposal the prompt rendered: between the render and the
   * press the round can advance, expiring the very field this is about to
   * remove, and a write built from the stale plan would strip pips for a zone
   * that had already gone.
   */
  const confirmTamper = (step: DeclaredTamper, targetId: string) => {
    const eng = engineRef.current;
    const ability = pendingTamper;
    if (!eng?.scene || !ability) return;
    const proposal = previewTamper(step, targetId);
    if (!proposal) {
      pushToast("That effect is no longer on this scene.", "error");
      setPendingTamper(null);
      return;
    }
    if (proposal.verdict === "refused") {
      pushToast(proposal.refusal ?? "That tamper could not resolve.", "error", 0);
      return;
    }
    if (proposal.verdict === "ruling") {
      // Redirect and copy have no mechanic the engine can honestly execute, so
      // they become a card that states the question — the same unrolled shape a
      // counter crossing opens, and the same rule applies: a ruling is never
      // auto-applied, whatever the table opted into.
      const card = rollScope
        ? tamperRulingCard({
            proposal,
            sourceAbilityId: ability.abilityId ?? ability.id,
            sourceAbilityName: ability.name,
            casterCharacterId: abilityChar?.id,
            now: Date.now(),
          })
        : null;
      if (card && rollScope) pushOutcome(rollScope, card);
      else pushToast(proposal.ruling ?? "That one is yours to rule.", "info", 0);
      setPendingTamper(null);
      return;
    }
    if (!proposal.write) return;
    if (
      !commitUndoableTamper(eng, proposal.write, {
        label: proposal.label,
        onRefused: (reason) => pushToast(reason, "error", 0),
      })
    ) {
      return;
    }
    // The caveats are repeated in the toast, not left in the dialog that is
    // about to close. What a cascade could NOT reach is the thing a Curator has
    // to act on afterwards, and it must not vanish with the prompt.
    pushToast(
      [proposal.label, ...proposal.caveats].join(" — "),
      "info",
      proposal.caveats.length ? 0 : undefined
    );
    setPendingTamper(null);
  };

  const placeAoe = (p: AoePlacement, declared: PlaceAoeOptions, originAt?: { x: number; y: number } | null) => {
    const eng = engineRef.current;
    if (!eng) return;
    const tokens = eng.scene?.data.tokens ?? [];
    // The declared origin's square, when the Curator kept that mode. Taken
    // ahead of the token search below because an origin may be a placed marker
    // rather than a body — there is nothing in `tokens` to find.
    if (p.mode === "origin" && originAt) {
      eng.placeAoeAt(p.kind, originAt.x, originAt.y, { cells: p.cells, rounds: p.rounds, ...declared });
      return;
    }
    // Where the template LANDS, which is not the same question as whose body an
    // aura rides — see `declaredAuraOwner`. Placing on a selected token used to
    // answer both at once, which bound a caster's own field to whatever was
    // selected: in a fight, almost always their target.
    let anchor: VttToken | null = null;
    if (p.mode === "self") {
      anchor = (abilityChar ? tokens.find((t) => t.characterId === abilityChar.id) : null) ?? null;
    } else if (p.mode === "selected") {
      anchor = (sel?.kind === "token" ? tokens.find((x) => x.id === sel.id) : null) ?? null;
    }
    const pos = anchor ? { x: anchor.x, y: anchor.y } : eng.viewCenterWorld();
    eng.placeAoeAt(p.kind, pos.x, pos.y, { cells: p.cells, rounds: p.rounds, ...declared });
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
          // The tracker's HP column is adjudication too, and it had the same
          // hole: on a player's token the write was refused while the row kept
          // the new number, so the tracker and the token disagreed.
          onTokenHp={(tokenId, hp) => {
            if (!engine) return;
            const name = engine.scene?.data.tokens.find((token) => token.id === tokenId)?.name ?? "that token";
            adjudicateUndoableVitals(engine, tokenId, { hp }, {
              label: `HP on ${name}`,
              subject: name,
              onRefused: (reason) => pushToast(reason, "error"),
            });
          }}
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
          onRequestTargetRoll={!asPlayer && sel?.kind === "token" ? requestTargetRoll : undefined}
          // Which windows are open right now. An unlinked encounter or a
          // stopped timeline leaves the field absent rather than zeroed: a
          // per-encounter limit with no encounter running has nothing to count
          // against, and a zero would have counted it against a window the
          // table was never in.
          usage={
            rollScope
              ? {
                  scope: rollScope,
                  window: {
                    sceneId: live?.id ?? null,
                    encounterId: live?.data.encounterId ?? null,
                    round: live?.data.timeline.round || null,
                    turnId: live?.data.timeline.turn ? String(live.data.timeline.turn) : null,
                  },
                }
              : undefined
          }
          onContestTarget={contestDefender && !asPlayer ? contestSelectedToken : undefined}
          contestTargetName={contestDefender?.name}
          onUseAbility={(ability) => {
            // The roll already fired; if the ability implies an area, prompt to
            // place an editable hitbox.
            if (!asPlayer && hasAoe(ability.meta)) setPendingAoe(ability);
            // A declared summon is its own proposal and rides beside the area
            // prompt rather than inside it: an ability may place a field AND
            // call bodies into it, and folding the two into one dialog would
            // make the Curator aim a template to confirm a creature.
            // A declared tamper is its own proposal too, and rides beside both:
            // Catalyst places a field AND negates one, and folding the two into
            // one dialog would make the Curator aim a template to answer a
            // question about somebody else's effect.
            if (!asPlayer && pageTampers(ability.actions).length > 0) setPendingTamper(ability);
            if (!asPlayer && pageSummons(ability.actions).length > 0) {
              setPendingSummon(ability);
              // The roster is only loaded when the Actors panel opens, and a
              // summon needs it now — without this every creature with a Codex
              // page resolves as unstatted the first time it is called.
              void loadCreatures();
            }
          }}
          onClose={() => setLeftPanel(null)}
        />
      )}
      {/* ONE gate, and it is inside the card — `viewer` is a required prop the
          component honours in front of its auto-apply effect as well as its
          markup. This used to read `!asPlayer && …` here, where no test could
          reach it. A second copy of the rule on this line would be the half that
          rots. */}
      {outcomes.length > 0 && (
        <VttResolutionCard
          outcomes={outcomes}
          viewer={asPlayer ? "player" : "curator"}
          autoApplyDeclared={autoApplyDeclared}
          onRoll={rollConsequence}
          onApplyDamage={applyOutcomeDamage}
          onApplyCondition={applyOutcomeCondition}
          onApplyCounter={applyOutcomeCounter}
          onDeclare={declareOutcome}
          onSetDamageRoll={chooseDamageRoll}
          onDismiss={dropOutcome}
        />
      )}
      {pendingAoe && (
        <VttAoePrompt
          ability={pendingAoe}
          casterName={abilityChar?.name ?? null}
          hasSelectedToken={sel?.kind === "token"}
          origin={abilityOriginPlan(pendingAoe)}
          onCancel={() => setPendingAoe(null)}
          onPlace={(p) => {
            // Read ONCE, here, and carried into the armed state: the click mode
            // lands its template on a pointer event with no ability in scope.
            const declared = declaredAoeOptions(pendingAoe);
            if (p.mode === "click") setArmedAoe({ kind: p.kind, cells: p.cells, rounds: p.rounds, declared });
            else placeAoe(p, declared, abilityOriginPlan(pendingAoe).at);
            setPendingAoe(null);
          }}
        />
      )}
      {pendingTamper && tamperSteps.length > 0 && (
        <VttTamperPrompt
          abilityName={pendingTamper.name}
          steps={tamperSteps}
          targets={tamperTargets}
          preview={previewTamper}
          onConfirm={confirmTamper}
          onCancel={() => setPendingTamper(null)}
        />
      )}
      {pendingSummon && summonRows.length > 0 && (
        <VttSummonPrompt
          abilityName={pendingSummon.name}
          rows={summonRows}
          casterName={abilityChar?.name ?? null}
          hasCasterToken={!!casterToken()}
          hasSelectedToken={sel?.kind === "token"}
          loading={creaturesLoading}
          roomFor={summonRoomFor}
          onPlace={placeSummons}
          onCancel={() => setPendingSummon(null)}
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
              eng.placeAoeAt(armedAoe.kind, w.x, w.y, { cells: armedAoe.cells, rounds: armedAoe.rounds, ...armedAoe.declared });
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
          authorizeMode={(mode, label) => net.authorizeRollMode(mode, label, abilityChar?.name)}
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
          onDismissSummon={dismissSummonOf(sel)}
          onClose={() => engine.select(null)}
          peers={net.status === "connected" ? net.peers.map((p) => ({ id: p.id, name: p.name })) : []}
          selfId={net.selfId}
          curator={!asPlayer}
        />
      )}
      {!roomCodexReady && (
        <div className="vtt2-codex-gate" role="alert" aria-live="assertive">
          <div className="panel vtt2-codex-gate-card">
            <div className="panel-title">Campaign Codex</div>
            <p className="list-empty">
              {roomCodex.status === "error"
                ? roomCodex.message
                : "Syncing and applying the Curator's formulas, character options, and table rules before rolls are enabled…"}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
