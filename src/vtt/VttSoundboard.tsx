import { useCallback, useEffect, useRef, useState } from "react";
import { addAsset, deleteAsset, listAssets, type VttAsset } from "./data/assetRepo";

interface Props {
  campaignId: string;
  sceneName: string;
  onClose: () => void;
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error("read failed"));
    r.readAsDataURL(file);
  });
}

// The Soundboard: a campaign sound library you can trigger while running a scene.
// Upload your own clips (stored as separate asset rows so they never bloat the
// scene JSON), tap a pad to play a one-shot SFX, loop ambience, or stop all.
export function VttSoundboard({ campaignId, sceneName, onClose }: Props) {
  const [sounds, setSounds] = useState<VttAsset[]>([]);
  const [loading, setLoading] = useState(true);
  const [volume, setVolume] = useState(0.8);
  const [loopId, setLoopId] = useState<string | null>(null);
  const [playing, setPlaying] = useState<Set<string>>(new Set());
  const fileRef = useRef<HTMLInputElement>(null);
  // Every Audio element we've started, so "Stop all" can halt them.
  const active = useRef<Map<string, HTMLAudioElement>>(new Map());

  const reload = useCallback(async () => {
    setLoading(true);
    const all = await listAssets(campaignId).catch(() => [] as VttAsset[]);
    setSounds(all.filter((a) => a.kind === "sound"));
    setLoading(false);
  }, [campaignId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  // Stop everything when the board unmounts so audio doesn't leak between scenes.
  useEffect(() => {
    const pool = active.current;
    return () => {
      for (const a of pool.values()) {
        a.pause();
        a.currentTime = 0;
      }
      pool.clear();
    };
  }, []);

  function stopOne(id: string) {
    const a = active.current.get(id);
    if (a) {
      a.pause();
      a.currentTime = 0;
      active.current.delete(id);
    }
    setPlaying((p) => {
      const n = new Set(p);
      n.delete(id);
      return n;
    });
    setLoopId((l) => (l === id ? null : l));
  }

  function play(s: VttAsset, loop: boolean) {
    // Re-tapping a pad restarts it; toggling loop off stops it.
    stopOne(s.id);
    if (loop && loopId === s.id) return;
    const audio = new Audio(s.uri);
    audio.volume = volume;
    audio.loop = loop;
    audio.onended = () => {
      if (!loop) stopOne(s.id);
    };
    void audio.play().catch(() => {});
    active.current.set(s.id, audio);
    setPlaying((p) => new Set(p).add(s.id));
    if (loop) setLoopId(s.id);
  }

  function stopAll() {
    for (const a of active.current.values()) {
      a.pause();
      a.currentTime = 0;
    }
    active.current.clear();
    setPlaying(new Set());
    setLoopId(null);
  }

  function changeVolume(v: number) {
    setVolume(v);
    for (const a of active.current.values()) a.volume = v;
  }

  async function onUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    for (const f of files) {
      const uri = await fileToDataUrl(f).catch(() => null);
      if (uri) await addAsset(campaignId, "sound", f.name.replace(/\.[^.]+$/, ""), uri).catch(() => {});
    }
    await reload();
  }

  async function remove(id: string) {
    stopOne(id);
    await deleteAsset(id).catch(() => {});
    await reload();
  }

  return (
    <div className="vtt2-soundboard">
      <div className="vtt2-insp-head">
        <span className="panel-title" style={{ margin: 0 }}>Soundboard</span>
        <div style={{ display: "flex", gap: 4 }}>
          <button className="icon-btn sm" onClick={() => void reload()} title="Reload sounds">⟳</button>
          <button className="cdx-tab-x" onClick={onClose} title="Close">×</button>
        </div>
      </div>
      <div className="vtt2-sb-sub">{sceneName}</div>

      <div className="vtt2-sb-controls">
        <input ref={fileRef} type="file" accept="audio/*" multiple hidden onChange={(e) => void onUpload(e)} />
        <button className="chip" onClick={() => fileRef.current?.click()}>Upload sounds…</button>
        <button className="chip" onClick={stopAll} disabled={playing.size === 0}>Stop all</button>
        <label className="vtt2-sb-vol" title="Master volume">
          Vol
          <input type="range" min={0} max={1} step={0.02} value={volume} onChange={(e) => changeVolume(parseFloat(e.target.value))} />
        </label>
      </div>

      {loading ? (
        <p className="list-empty" style={{ margin: "6px 0" }}>Loading sounds…</p>
      ) : sounds.length === 0 ? (
        <p className="list-empty" style={{ margin: "6px 0" }}>No sounds yet — upload clips to build this campaign's board.</p>
      ) : (
        <div className="vtt2-sb-grid">
          {sounds.map((s) => (
            <div key={s.id} className={"vtt2-sb-pad" + (playing.has(s.id) ? " on" : "")}>
              <button className="vtt2-sb-play" onClick={() => play(s, false)} title="Play once">
                <span className="vtt2-sb-name">{s.name}</span>
              </button>
              <div className="vtt2-sb-pad-row">
                <button
                  className={"vtt2-sb-mini" + (loopId === s.id ? " on" : "")}
                  onClick={() => play(s, true)}
                  title="Loop as ambience"
                >
                  Loop
                </button>
                {playing.has(s.id) && (
                  <button className="vtt2-sb-mini" onClick={() => stopOne(s.id)} title="Stop">Stop</button>
                )}
                <button className="vtt2-sb-mini danger" onClick={() => void remove(s.id)} title="Delete sound">Del</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
