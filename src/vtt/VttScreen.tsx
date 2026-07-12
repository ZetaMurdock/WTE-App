import { useCallback, useEffect, useRef, useState } from "react";
import type { Campaign } from "../models/campaign";
import { isTauri } from "../lib/tauri";
import { PixiVttApp } from "./engine/PixiVttApp";
import { listScenes, saveScene } from "./data/sceneRepo";
import { newScene, type VttScene, type VttToken } from "./types/scene";
import type { VttTool } from "./types/tool";
import { VttToolbar } from "./VttToolbar";
import { VttInspector } from "./VttInspector";

// VTT v2 (slice 1): Pixi renders the map; React owns the chrome. Beside the
// legacy VTT, not inside it — see the rework spec in docs/ / session notes.
export function VttScreen({ campaign }: { campaign: Campaign | null }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<PixiVttApp | null>(null);
  const saveTimer = useRef<number | undefined>(undefined);
  const [scene, setScene] = useState<VttScene | null>(null);
  const [tool, setTool] = useState<VttTool>("select");
  const [selected, setSelected] = useState<VttToken | null>(null);
  const [tick, setTick] = useState(0); // re-render after engine mutations

  const persist = useCallback((s: VttScene) => {
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => void saveScene(s).catch(() => {}), 500);
  }, []);

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
    engine.onSelect = (id) => {
      setSelected(id && engine.scene ? engine.scene.data.tokens.find((t) => t.id === id) ?? null : null);
    };
    void engine.init(host);
    return () => {
      engineRef.current = null;
      engine.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load (or create) the campaign's scene.
  useEffect(() => {
    let alive = true;
    async function load() {
      let s: VttScene | null = null;
      if (campaign && isTauri()) {
        const all = await listScenes(campaign.id).catch(() => [] as VttScene[]);
        s = all.find((x) => x.active) ?? all[0] ?? null;
      }
      if (!s) {
        // No campaign → an in-memory sandbox table; with a campaign, seed Scene 1.
        s = newScene(campaign?.id ?? "sandbox", campaign ? campaign.name + " · Scene 1" : "Sandbox");
        s.active = true;
        if (campaign) void saveScene(s).catch(() => {});
      }
      if (!alive) return;
      setScene(s);
      engineRef.current?.setScene(s);
    }
    void load();
    return () => {
      alive = false;
    };
  }, [campaign]);

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
  const tokenCount = engine?.scene?.data.tokens.length ?? scene?.data.tokens.length ?? 0;

  return (
    <div className="vtt2">
      <VttToolbar
        tool={tool}
        onTool={pickTool}
        sceneName={scene?.name ?? ""}
        onRename={renameScene}
        tokenCount={tokenCount}
        campaignReady={!!campaign}
        dataTick={tick}
      />
      <div className="vtt2-stage" ref={hostRef} />
      {!campaign && <div className="vtt2-sandbox-note">Sandbox table — pick a campaign on the Dashboard to persist scenes.</div>}
      {selected && engine && (
        <VttInspector
          token={selected}
          onUpdate={(patch) => engine.updateToken(selected.id, patch)}
          onDelete={() => engine.deleteToken(selected.id)}
          onClose={() => engine.select(null)}
        />
      )}
    </div>
  );
}
