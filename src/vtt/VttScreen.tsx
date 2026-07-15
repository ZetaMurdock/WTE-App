import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { Campaign } from "../models/campaign";
import { isTauri } from "../lib/tauri";
import { PixiVttApp, type VttSelection } from "./engine/PixiVttApp";
import { listScenes, saveScene, getScene, setActiveScene, deleteScene } from "./data/sceneRepo";
import { newScene, type VttScene } from "./types/scene";
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
import { VttSceneBrowser } from "./VttSceneBrowser";
import { VttActorsPanel } from "./VttActorsPanel";
import { VttEncounterPanel } from "./VttEncounterPanel";
import { VttRollFeed } from "./VttRollFeed";
import { VttAssetPanel } from "./VttAssetPanel";
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
export function VttScreen({ campaign }: { campaign: Campaign | null }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<PixiVttApp | null>(null);
  const saveTimer = useRef<number | undefined>(undefined);
  const [scene, setScene] = useState<VttScene | null>(null);
  const [scenes, setScenes] = useState<VttScene[]>([]);
  // The left dock shows at most one panel at a time.
  const [leftPanel, setLeftPanel] = useState<"scenes" | "actors" | "encounter" | "assets" | null>(null);
  const [rollsOpen, setRollsOpen] = useState(false);
  const [gridOpen, setGridOpen] = useState(false);
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

  // Player perspective: fog reveals only from the player's OWN tokens (GM sees
  // all). Runs every render so it tracks role/selection changes in the 2D view.
  useEffect(() => {
    engineRef.current?.setPlayerView(isNetPlayer, net.selfId);
  });

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

  // --- Live character-sheet sync (Curator control over player sheets) --------
  // Players push their full record; the Curator (and the owner) apply incoming
  // records to the local DB and can open/edit them, edits flowing back the same
  // way. Runs at this always-mounted level so a sheet arrives even before its
  // overlay is opened. Bumping sheetSyncTick remounts an open sheet to reload.
  useEffect(() => {
    if (!campaign) return;
    return net.subscribe("sheet-patch", (m, from) => {
      const pm = m as Extract<NetMessage, { t: "sheet-patch" }>;
      const rec = pm.patch as CharacterRecord | undefined;
      if (!rec || !rec.id || !rec.sheet) return;
      applyRemoteSheet(rec, from);
      void upsertCharacter(rec);
      // Only reload the open overlay when THIS character changed, so an unrelated
      // party member's edit never interrupts the sheet you are looking at.
      if (rec.id === sheetCharIdRef.current) setSheetSyncTick((t) => t + 1);
    });
  }, [campaign, net.subscribe]);

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

  // Per-scene ambient music: play the ACTIVE scene's track (looped), stop when
  // it has none. Scene switches swap tracks automatically.
  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    const audio = engineRef.current?.scene?.data.audio ?? scene?.data.audio ?? null;
    if (audio?.src) {
      if (el.src !== audio.src) el.src = audio.src;
      el.loop = true;
      el.volume = audio.volume ?? 0.5;
      void el.play().catch(() => {});
    } else {
      el.pause();
      el.removeAttribute("src");
    }
  });
  const [characters, setCharacters] = useState<CharacterRecord[]>([]);
  const [charsLoading, setCharsLoading] = useState(false);
  const [assets, setAssets] = useState<VttAsset[]>([]);
  const [assetsLoading, setAssetsLoading] = useState(false);
  const [tool, setTool] = useState<VttTool>("select");
  const [sel, setSel] = useState<VttSelection>(null);
  const [tick, setTick] = useState(0); // re-render after engine mutations

  const persist = useCallback((s: VttScene) => {
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => void saveScene(s).catch(() => {}), 500);
  }, []);

  // Flush the debounced autosave immediately — used before switching scenes so
  // in-flight edits aren't lost when the engine's scene object is swapped out.
  const flush = useCallback(async () => {
    window.clearTimeout(saveTimer.current);
    const s = engineRef.current?.scene;
    if (s) await saveScene(s).catch(() => {});
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
          await saveScene(s).catch(() => {});
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

  async function switchScene(id: string) {
    if (!campaign || id === scene?.id) return;
    await flush();
    const target = await getScene(id).catch(() => null);
    if (target) await adopt(target);
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
    await saveScene(s).catch(() => {});
    await adopt(s);
  }

  async function renameSceneById(id: string, name: string) {
    if (id === scene?.id && engineRef.current?.scene) {
      engineRef.current.scene.name = name;
      setScene((s) => (s ? { ...s, name } : s));
      await saveScene(engineRef.current.scene).catch(() => {});
    } else {
      const target = scenes.find((s) => s.id === id);
      if (target) await saveScene({ ...target, name }).catch(() => {});
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
    engineRef.current?.spawnToken(characterToTokenSpec(rec));
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
    setAssets(list);
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

  return (
    <div className="vtt2">
      <VttToolbar
        sceneName={scene?.name ?? ""}
        onRename={renameScene}
        tokenCount={tokenCount}
        campaignReady={!!campaign}
        scenesOpen={leftPanel === "scenes"}
        actorsOpen={leftPanel === "actors"}
        encounterOpen={leftPanel === "encounter"}
        assetsOpen={leftPanel === "assets"}
        rollsOpen={rollsOpen}
        gridOpen={gridOpen}
        onToggleScenes={campaign ? () => setLeftPanel((p) => (p === "scenes" ? null : "scenes")) : undefined}
        onToggleActors={campaign ? () => setLeftPanel((p) => (p === "actors" ? null : "actors")) : undefined}
        onToggleEncounter={campaign ? () => setLeftPanel((p) => (p === "encounter" ? null : "encounter")) : undefined}
        onToggleAssets={campaign ? () => setLeftPanel((p) => (p === "assets" ? null : "assets")) : undefined}
        onToggleRolls={campaign ? () => setRollsOpen((v) => !v) : undefined}
        onToggleGrid={!isNetPlayer ? () => setGridOpen((v) => !v) : undefined}
        syncOn={sync.connected}
        syncPeers={sync.peerCount}
      />
      <div className="vtt2-stage" ref={hostRef}>
        {sel?.kind === "token" && engine && (
          <VttRadialMenu engine={engine} three={null} view3d={false} tokenId={sel.id} />
        )}
      </div>
      <VttActionBar
        tool={tool}
        onTool={pickTool}
        fogOn={fogOn}
        onToggleFog={() => engine?.toggleFog()}
      />
      {campaign && !isNetPlayer && (
        <VttSceneWheel
          scenes={scenes}
          activeId={scene?.id ?? null}
          onSwitch={(id) => void switchScene(id)}
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
          onSetActiveForEveryone={(id) => void setActiveForEveryone(id)}
          playerCount={net.status === "connected" ? net.peers.length : 0}
        />
      )}
      <input ref={sceneBgRef} type="file" accept="image/*" hidden onChange={(e) => void onSceneBgFile(e)} />
      <input ref={sceneMusicRef} type="file" accept="audio/*" hidden onChange={(e) => void onSceneMusicFile(e)} />
      <audio ref={audioRef} hidden />
      {gridOpen && !isNetPlayer && live && (
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
          canSpawnCreatures={!isNetPlayer}
          remoteChars={
            isNetPlayer
              ? [] // only the Curator gets live control over other players' sheets
              : partySheets
                  .filter((e) => e.ownerId !== net.selfId)
                  .map((e) => ({ id: e.record.id, name: e.record.name, owner: net.peers.find((p) => p.id === e.ownerId)?.name || "player" }))
          }
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
      {campaign && rollsOpen && <VttRollFeed campaignId={campaign.id} onClose={() => setRollsOpen(false)} />}
      {campaign && sheetCharId && (
        <div className="vtt2-sheet-overlay" onMouseDown={() => setSheetCharId(null)}>
          <div className="vtt2-sheet-modal" onMouseDown={(e) => e.stopPropagation()}>
            <CharacterSheet
              key={sheetCharId + ":" + sheetSyncTick}
              characterId={sheetCharId}
              campaignId={campaign.id}
              curator={!isNetPlayer}
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
