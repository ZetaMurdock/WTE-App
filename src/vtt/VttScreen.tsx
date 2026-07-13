import { useCallback, useEffect, useRef, useState } from "react";
import type { Campaign } from "../models/campaign";
import { isTauri } from "../lib/tauri";
import { PixiVttApp, type VttSelection } from "./engine/PixiVttApp";
import { listScenes, saveScene, getScene, setActiveScene, deleteScene } from "./data/sceneRepo";
import { newScene, type VttScene } from "./types/scene";
import type { VttTool } from "./types/tool";
import { VttToolbar } from "./VttToolbar";
import { VttInspector } from "./VttInspector";
import { VttSceneBrowser } from "./VttSceneBrowser";
import { VttActorsPanel } from "./VttActorsPanel";
import { VttEncounterPanel } from "./VttEncounterPanel";
import { VttRollFeed } from "./VttRollFeed";
import { VttAssetPanel } from "./VttAssetPanel";
import { listCharacters, type CharacterRecord } from "../lib/characters";
import { characterToTokenSpec, creatureToTokenSpec, parseSpawnPayload } from "./data/actorSpawn";
import { listAssets, addAsset, deleteAsset, type AssetKind, type VttAsset } from "./data/assetRepo";
import { useVttSync } from "./sync/vttSync";

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

  useEffect(() => {
    void loadCharacters();
  }, [loadCharacters]);

  function spawnCharacter(rec: CharacterRecord) {
    engineRef.current?.spawnToken(characterToTokenSpec(rec));
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
        tool={tool}
        onTool={pickTool}
        sceneName={scene?.name ?? ""}
        onRename={renameScene}
        tokenCount={tokenCount}
        campaignReady={!!campaign}
        fogOn={fogOn}
        onToggleFog={() => engine?.toggleFog()}
        scenesOpen={leftPanel === "scenes"}
        actorsOpen={leftPanel === "actors"}
        encounterOpen={leftPanel === "encounter"}
        assetsOpen={leftPanel === "assets"}
        rollsOpen={rollsOpen}
        onToggleScenes={campaign ? () => setLeftPanel((p) => (p === "scenes" ? null : "scenes")) : undefined}
        onToggleActors={campaign ? () => setLeftPanel((p) => (p === "actors" ? null : "actors")) : undefined}
        onToggleEncounter={campaign ? () => setLeftPanel((p) => (p === "encounter" ? null : "encounter")) : undefined}
        onToggleAssets={campaign ? () => setLeftPanel((p) => (p === "assets" ? null : "assets")) : undefined}
        onToggleRolls={campaign ? () => setRollsOpen((v) => !v) : undefined}
        syncOn={sync.connected}
        syncPeers={sync.peerCount}
      />
      <div className="vtt2-stage" ref={hostRef} />
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
          onSpawn={spawnCharacter}
          onRefresh={() => void loadCharacters()}
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
          onRefresh={() => void loadAssets()}
          onClose={() => setLeftPanel(null)}
        />
      )}
      {campaign && rollsOpen && <VttRollFeed campaignId={campaign.id} onClose={() => setRollsOpen(false)} />}
      {!campaign && <div className="vtt2-sandbox-note">Sandbox table — pick a campaign on the Dashboard to persist scenes.</div>}
      {sel && engine && live && (
        <VttInspector
          sel={sel}
          scene={live}
          onToken={(patch) => engine.updateToken(sel.id, patch)}
          onWall={(patch) => engine.updateWall(sel.id, patch)}
          onLight={(patch) => engine.updateLight(sel.id, patch)}
          onDelete={() => engine.deleteSelected()}
          onClose={() => engine.select(null)}
        />
      )}
    </div>
  );
}
