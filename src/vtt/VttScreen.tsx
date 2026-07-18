import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { Campaign } from "../models/campaign";
import { isTauri } from "../lib/tauri";
import { PixiVttApp, peerInkColor, type VttSelection } from "./engine/PixiVttApp";
import { listScenes, saveScene, getScene, setActiveScene, deleteScene } from "./data/sceneRepo";
import { newScene, type VttScene, type VttZoneKind } from "./types/scene";
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
import type { NetMessage } from "../net/protocol";
import { addSessionRoll } from "./sync/rollSession";
import { SfxPlayer } from "./audio/sfxPlayer";
import { getMasterVolume, subscribeMasterVolume } from "../lib/audioPrefs";
import { reportSaveFailure } from "../lib/appToast";
import { VttCinePanel, type CineConfig } from "./VttCinePanel";
import { VttSceneBrowser } from "./VttSceneBrowser";
import { VttActorsPanel } from "./VttActorsPanel";
import { VttEncounterPanel } from "./VttEncounterPanel";
import { VttRollFeed, type RollLock } from "./VttRollFeed";
import { VttAssetPanel } from "./VttAssetPanel";
import { VttSoundboard } from "./VttSoundboard";
import { VttAbilitiesPanel } from "./VttAbilitiesPanel";
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
import { listAssets, addAsset, deleteAsset, type AssetKind, type VttAsset } from "./data/assetRepo";
import { useVttSync } from "./sync/vttSync";
import { fileToPngDataUrl } from "../lib/image";

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
export function VttScreen({ campaign, active = true }: { campaign: Campaign | null; active?: boolean }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<PixiVttApp | null>(null);
  const saveTimer = useRef<number | undefined>(undefined);
  const [scene, setScene] = useState<VttScene | null>(null);
  const [scenes, setScenes] = useState<VttScene[]>([]);
  // The left dock shows at most one panel at a time.
  const [leftPanel, setLeftPanel] = useState<"scenes" | "actors" | "encounter" | "assets" | "abilities" | null>(null);
  const [abilityCharId, setAbilityCharId] = useState<string | null>(null);
  const [pendingAoe, setPendingAoe] = useState<VttAbility | null>(null);
  // A soundboard clip armed for click-to-place as a spatial emitter.
  const [armedSound, setArmedSound] = useState<{ name: string; src: string } | null>(null);
  const [armedAoe, setArmedAoe] = useState<{ kind: AoeKind; cells: number; rounds: number } | null>(null);
  const [rollsOpen, setRollsOpen] = useState(false);
  const [gridOpen, setGridOpen] = useState(false);
  const [soundboardOpen, setSoundboardOpen] = useState(false);
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
      if (eng?.scene?.id === id) {
        patch(eng.scene);
        eng.redraw();
        eng.onChanged();
      } else {
        const s = await getScene(id);
        if (!s) return;
        patch(s);
        await saveScene(s);
      }
      // refresh the wheel's copies (music badge, names)
      if (campaign) setScenes(await listScenes(campaign.id).catch(() => []));
    },
    [campaign]
  );

  async function onSceneBgFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    const id = menuTarget.current;
    if (!f || !id) return;
    const uri = await fileToPngDataUrl(f).catch(() => null);
    if (uri) await patchScene(id, (s) => (s.data.background.src = uri));
  }
  async function onSceneMusicFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    const id = menuTarget.current;
    if (!f || !id) return;
    if (f.size > 12 * 1024 * 1024) return; // keep scene payloads sane
    const uri = await fileToDataUrl(f).catch(() => null);
    if (uri) await patchScene(id, (s) => (s.data.audio = { src: uri, volume: 0.5 }));
  }
  // Shader-compile feedback surfaced by the Grid panel's atmosphere controls.
  const [shaderError, setShaderError] = useState("");
  // Per-campaign Curator claim: only joining someone else's netplay room as a
  // player demotes you — hide Curator-only scene controls there.
  const net = useNet();
  const isNetPlayer = net.status === "connected" && net.role === "player";

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
    engineRef.current?.setPlayerView(asPlayer, viewId);
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
  useEffect(() => {
    if (!campaign) return;
    return net.subscribe("roll", (m, from) => {
      const r = m as Extract<NetMessage, { t: "roll" }>;
      const who = from === net.selfId ? "You" : peersRef.current.find((p) => p.id === from)?.name || from.slice(0, 6);
      addSessionRoll(campaign.id, {
        id: r.id || "live-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        who,
        label: r.label,
        formula: r.formula,
        result: r.result,
        at: Date.now(),
      });
    });
  }, [campaign, net.subscribe, net.selfId]);

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
  const [rollLock, setRollLock] = useState<RollLock | null>(null);
  const armRoll = useCallback((label: string, expr?: string) => {
    setRollLock({ label, expr });
    setRollsOpen(true);
  }, []);

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
  const [characters, setCharacters] = useState<CharacterRecord[]>([]);
  const [charsLoading, setCharsLoading] = useState(false);
  const [assets, setAssets] = useState<VttAsset[]>([]);
  const [assetsLoading, setAssetsLoading] = useState(false);
  const [tool, setTool] = useState<VttTool>("select");
  const [zoneBrush, setZoneBrush] = useState<{ kind: VttZoneKind; erase: boolean } | null>(null);
  const [sel, setSel] = useState<VttSelection>(null);
  const [tick, setTick] = useState(0); // re-render after engine mutations

  const persist = useCallback((s: VttScene) => {
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
      if (!eng || !eng.scene || !tok) return;
      const g = eng.scene.data.grid.size;
      const nx = tok.x + dx * g;
      const ny = tok.y + dy * g;
      // FACING follows the step even when blocked — you can turn to face a wall.
      const facing = Math.atan2(dy, dx);
      if (tok.facing !== facing) eng.updateToken(tokenId, { facing });
      // COLLISION: a step through a wall doesn't happen (walking, not teleporting).
      if (eng.moveBlocked(tok.x, tok.y, nx, ny)) return;
      eng.moveToken(tokenId, nx, ny, true);
      eng.onChanged();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, lastTokenId]);

  // Flush the debounced autosave immediately — used before switching scenes so
  // in-flight edits aren't lost when the engine's scene object is swapped out.
  const flush = useCallback(async () => {
    window.clearTimeout(saveTimer.current);
    const s = engineRef.current?.scene;
    if (s) await reportSaveFailure(saveScene(s), "the scene");
  }, []);

  // Adopt a full scene pushed by a peer (host scene switch / late-join snapshot).
  // Local view only — no DB write (it's the host's scene, not ours to persist).
  const adoptSnapshot = useCallback((remote: VttScene) => {
    setScene(remote);
    setSel(null);
    engineRef.current?.setScene(remote);
    engineRef.current?.select(null);
  }, []);

  // P2P sync (slice 10). broadcastOp is wired to the engine's local-op emitter;
  // broadcastSnapshot pushes the whole scene on host switches / to late joiners.
  const sync = useVttSync({
    engineRef,
    sceneId: scene?.id ?? null,
    getScene: () => engineRef.current?.scene ?? null,
    onSnapshot: adoptSnapshot,
  });
  const broadcastRef = useRef(sync.broadcastOp);
  broadcastRef.current = sync.broadcastOp;

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
    engine.onOp = (op) => broadcastRef.current(op);
    engine.onShaderError = (err) => setShaderError(err);
    engine.onTokenMoved = (id, x, y) => void tokenMovedRef.current(id, x, y);
    engine.onPing = (x, y) => pingOutRef.current(x, y);
    // Dev-only handle for debugging sync ops in the preview (stripped in prod).
    if (import.meta.env.DEV) (window as unknown as { __vttEngine?: PixiVttApp }).__vttEngine = engine;
    void engine.init(host);
    return () => {
      engineRef.current = null;
      engine.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load (or create) the campaign's scene, plus the full scene list for the browser.
  useEffect(() => {
    let alive = true;
    async function load() {
      let s: VttScene | null = null;
      let all: VttScene[] = [];
      if (campaign && isTauri()) {
        all = await listScenes(campaign.id).catch(() => [] as VttScene[]);
        s = all.find((x) => x.active) ?? all[0] ?? null;
      }
      if (!s) {
        // No campaign → an in-memory sandbox table; with a campaign, seed Scene 1.
        s = newScene(campaign?.id ?? "sandbox", campaign ? campaign.name + " · Scene 1" : "Sandbox");
        s.active = true;
        if (campaign) {
          await reportSaveFailure(saveScene(s), "the scene");
          all = [s];
        }
      }
      if (!alive) return;
      setScene(s);
      setScenes(all);
      engineRef.current?.setScene(s);
    }
    void load();
    return () => {
      alive = false;
    };
  }, [campaign]);

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
      setScene(s);
      setSel(null);
      engineRef.current?.setScene(s);
      engineRef.current?.select(null);
      await reloadScenes();
      // Push the new active scene to peers (covers the scene.switch case).
      sync.broadcastSnapshot();
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
      await flush();
      const target = (await getScene(id).catch(() => null)) ?? scenes.find((s) => s.id === id) ?? null;
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
  const onTokenCrossed = async (tokenId: string, x: number, y: number) => {
    if (isNetPlayer || linkBusy.current || switchingRef.current) return;
    const liveScene = engineRef.current?.scene;
    if (!campaign || !liveScene?.data.links?.length) return;
    const grid = liveScene.data.grid;
    const link = liveScene.data.links.find((l) => tokenInEdge(grid, l.edge, x, y));
    if (!link) return;
    linkBusy.current = true;
    try {
      const target = (await getScene(link.targetSceneId).catch(() => null)) ?? scenes.find((s) => s.id === link.targetSceneId) ?? null;
      if (!target || target.id === liveScene.id) return;
      const trigger = liveScene.data.tokens.find((t) => t.id === tokenId);
      if (!trigger) return;
      const others = liveScene.data.tokens.filter((t) => t.id !== tokenId && t.owner);
      const party = others.length > 0 && confirm(`Take the whole party through to "${target.name}"?`);
      const moving = party ? [trigger, ...others] : [trigger];
      liveScene.data.tokens = liveScene.data.tokens.filter((t) => !moving.includes(t));
      moving.forEach((t, i) => {
        const p = arrivalPos(grid, target.data.grid, link.edge, t.x, t.y, i);
        t.x = p.x;
        t.y = p.y;
        target.data.tokens.push(t);
      });
      await flush();
      await reportSaveFailure(saveScene(liveScene), "the scene");
      await reportSaveFailure(saveScene(target), "the scene");
      await adopt(target); // switches the whole table + snapshots to peers
    } finally {
      linkBusy.current = false;
    }
  };
  const tokenMovedRef = useRef(onTokenCrossed);
  tokenMovedRef.current = onTokenCrossed;

  // Step to the previous/next scene (wheel + arrow buttons on the scene rail).
  function stepScene(dir: 1 | -1) {
    if (!scenes.length) return;
    const idx = Math.max(0, scenes.findIndex((s) => s.id === scene?.id));
    const next = scenes[(idx + dir + scenes.length) % scenes.length];
    if (next && next.id !== scene?.id) void switchScene(next.id);
  }

  // Curator pushes a scene to the whole table: switch to it (which broadcasts a
  // snapshot to every player), and force a re-push when it is already active so
  // this doubles as a "pull drifted players back to my scene" re-sync.
  async function setActiveForEveryone(id: string) {
    if (id !== scene?.id) await switchScene(id);
    else sync.broadcastSnapshot();
  }

  async function createScene() {
    if (!campaign) return;
    await flush();
    const s = newScene(campaign.id, `${campaign.name} · Scene ${scenes.length + 1}`);
    await reportSaveFailure(saveScene(s), "the scene");
    await adopt(s);
  }

  async function renameSceneById(id: string, name: string) {
    if (id === scene?.id && engineRef.current?.scene) {
      engineRef.current.scene.name = name;
      setScene((s) => (s ? { ...s, name } : s));
      await reportSaveFailure(saveScene(engineRef.current.scene), "the scene");
    } else {
      const target = scenes.find((s) => s.id === id);
      if (target) await reportSaveFailure(saveScene({ ...target, name }), "the scene");
    }
    await reloadScenes();
  }

  async function deleteSceneById(id: string) {
    if (!campaign) return;
    await deleteScene(id).catch(() => {});
    if (id === scene?.id) {
      const remaining = await listScenes(campaign.id).catch(() => [] as VttScene[]);
      const next = remaining.find((x) => x.active) ?? remaining[0] ?? null;
      if (next) await adopt(next);
      else setScenes(remaining);
    } else {
      await reloadScenes();
    }
  }

  // Load the campaign's vault characters for the Actors panel.
  const loadCharacters = useCallback(async () => {
    if (!campaign || !isTauri()) {
      setCharacters([]);
      return;
    }
    setCharsLoading(true);
    const list = await listCharacters(campaign.id).catch(() => [] as CharacterRecord[]);
    setCharacters(list);
    setCharsLoading(false);
  }, [campaign]);

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

  useEffect(() => {
    void loadCharacters();
  }, [loadCharacters]);
  useEffect(() => {
    if (leftPanel === "actors") void loadCreatures();
  }, [leftPanel, loadCreatures]);

  function spawnCharacter(rec: CharacterRecord) {
    const spec = characterToTokenSpec(rec);
    // Net players OWN the tokens they spawn: peers won't apply another player's
    // moves to it, and player fog-vision reveals from it (both key on `owner`).
    if (isNetPlayer) spec.owner = net.selfId;
    engineRef.current?.spawnToken(spec);
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
      return;
    }
    setAssetsLoading(true);
    const list = await listAssets(campaign.id).catch(() => [] as VttAsset[]);
    // "blob" rows are internal scene-image storage — never shown in the browser.
    setAssets(list.filter((a) => a.kind !== "blob"));
    setAssetsLoading(false);
  }, [campaign]);

  useEffect(() => {
    void loadAssets();
  }, [loadAssets]);

  async function addAssetEntry(kind: AssetKind, name: string, uri: string) {
    if (!campaign) return;
    const a = await addAsset(campaign.id, kind, name, uri).catch(() => null);
    if (a) setAssets((cur) => [a, ...cur]);
  }
  async function removeAsset(id: string) {
    await deleteAsset(id).catch(() => {});
    setAssets((cur) => cur.filter((a) => a.id !== id));
  }
  function applyTokenArt(uri: string) {
    if (sel?.kind === "token") engineRef.current?.updateToken(sel.id, { img: uri });
  }
  function applyTokenModel(uri: string) {
    if (sel?.kind === "token") engineRef.current?.updateToken(sel.id, { model: uri });
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
  const abilityChar = characters.find((c) => c.id === (abilityCharId ?? selTokenCharId ?? characters[0]?.id)) ?? null;

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
        gridOpen={gridOpen}
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
          <span className="vtt2-playbar-hint">Play mode — move your token · double-click to ping</span>
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
          {!isNetPlayer && (
            <button className="chip" onClick={() => setPreviewAs(null)} title="Leave the player-view preview">
              Exit player view
            </button>
          )}
        </div>
      )}
      <div className="vtt2-stage" ref={hostRef}>
        {sel?.kind === "token" && engine && (
          <VttRadialMenu engine={engine} tokenId={sel.id} />
        )}
      </div>
      {!playHidden && (
        <VttActionBar
          tool={tool}
          onTool={pickTool}
          builder={!asPlayer}
          canDraw={live?.data.allowPlayerDraw !== false}
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
          onSetActiveForEveryone={(id) => void setActiveForEveryone(id)}
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
          characters={characters}
          loading={charsLoading}
          creatures={creatures}
          creaturesLoading={creaturesLoading}
          canSpawnCreatures={!asPlayer}
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
          onApplyModel={applyTokenModel}
          onRefresh={() => void loadAssets()}
          onClose={() => setLeftPanel(null)}
        />
      )}
      {campaign && leftPanel === "abilities" && (
        <VttAbilitiesPanel
          character={abilityChar}
          characters={characters.map((c) => ({ id: c.id, name: c.name }))}
          onPickCharacter={(id) => setAbilityCharId(id)}
          onArmRoll={armRoll}
          onUseAbility={(ability) => {
            // The roll already fired; if the ability implies an area, prompt to
            // place an editable hitbox.
            if (hasAoe(ability.meta)) setPendingAoe(ability);
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
          onMouseDown={(e) => {
            if (e.button !== 0) return; // right/middle keep panning
            const eng = engineRef.current;
            if (eng) {
              const w = eng.clientToWorld(e.clientX, e.clientY);
              eng.placeAoeAt(armedAoe.kind, w.x, w.y, { cells: armedAoe.cells, rounds: armedAoe.rounds });
            }
            setArmedAoe(null);
          }}
        >
          <span className="vtt2-aoe-place-hint">Click to place the area · Esc to cancel</span>
        </div>
      )}
      {armedSound && (
        <div
          className="vtt2-aoe-place"
          onMouseDown={(e) => {
            if (e.button !== 0) return;
            const eng = engineRef.current;
            if (eng) {
              const w = eng.clientToWorld(e.clientX, e.clientY);
              eng.addEmitterAt(w.x, w.y, armedSound);
            }
            setArmedSound(null);
          }}
        >
          <span className="vtt2-aoe-place-hint">Click to pin “{armedSound.name}” to the map · Esc to cancel</span>
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
      {campaign && <VttRollToast campaignId={campaign.id} />}
      {campaign && rollsOpen && (
        <VttRollFeed campaignId={campaign.id} lock={rollLock} onClearLock={() => setRollLock(null)} onClose={() => setRollsOpen(false)} />
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
      {sel && engine && live && (
        <VttInspector
          sel={sel}
          scene={live}
          onToken={(patch) => engine.updateToken(sel.id, patch)}
          onWall={(patch) => engine.updateWall(sel.id, patch)}
          onLight={(patch) => engine.updateLight(sel.id, patch)}
          onEmitter={(patch) => engine.updateEmitter(sel.id, patch)}
          onEffect={(patch) => engine.updateEffect(sel.id, patch)}
          onEffectKind={(kind) => engine.setEffectKind(sel.id, kind)}
          onDelete={() => engine.deleteSelected()}
          onClose={() => engine.select(null)}
          peers={net.status === "connected" ? net.peers.map((p) => ({ id: p.id, name: p.name })) : []}
          selfId={net.selfId}
        />
      )}
    </div>
  );
}
