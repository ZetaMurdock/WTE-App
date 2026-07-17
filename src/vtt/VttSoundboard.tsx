import { useCallback, useEffect, useRef, useState } from "react";
import { addAsset, deleteAsset, listAssets, type VttAsset } from "./data/assetRepo";
import { groupSounds, soundDisplayName, soundNameFromFile } from "./data/soundLib";
import { useNet } from "../net/NetContext";

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

// Clip ids whose BYTES have already been broadcast this app session — repeats
// send a tiny {action, id} message and play from the players' caches.
const sentSfx = new Set<string>();

// The Soundboard: a campaign sound library you trigger while running a scene —
// and the whole TABLE hears it (clips broadcast over the chunked transport).
// Upload single clips or a WHOLE FOLDER (it auto-organizes into groups).
export function VttSoundboard({ campaignId, sceneName, onClose }: Props) {
  const net = useNet();
  const [sounds, setSounds] = useState<VttAsset[]>([]);
  const [loading, setLoading] = useState(true);
  const [volume, setVolume] = useState(0.8);
  const [loopId, setLoopId] = useState<string | null>(null);
  const [playing, setPlaying] = useState<Set<string>>(new Set());
  const fileRef = useRef<HTMLInputElement>(null);
  const folderRef = useRef<HTMLInputElement>(null);
  // Every Audio element we've started, so "Stop all" can halt them.
  const active = useRef<Map<string, HTMLAudioElement>>(new Map());

  // React's typings don't know webkitdirectory — set it on the raw element.
  useEffect(() => {
    folderRef.current?.setAttribute("webkitdirectory", "");
  }, []);

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

  const broadcast = useCallback(
    (action: "play" | "loop" | "stop" | "stopall", s?: VttAsset, vol?: number) => {
      if (net.status !== "connected") return;
      const id = s?.id ?? "";
      const first = s ? !sentSfx.has(id) : false;
      if (s) sentSfx.add(id);
      net.publish({ t: "sfx", action, id, name: s?.name, uri: first ? s?.uri : undefined, volume: vol });
    },
    [net]
  );

  function stopOne(id: string, sync = true) {
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
    if (sync) broadcast("stop", sounds.find((s) => s.id === id));
  }

  function play(s: VttAsset, loop: boolean) {
    stopOne(s.id, false);
    if (loop && loopId === s.id) return;
    const audio = new Audio(s.uri);
    audio.volume = volume;
    audio.loop = loop;
    audio.onended = () => {
      if (!loop) stopOne(s.id, false);
    };
    void audio.play().catch(() => {});
    active.current.set(s.id, audio);
    setPlaying((p) => new Set(p).add(s.id));
    if (loop) setLoopId(s.id);
    broadcast(loop ? "loop" : "play", s, volume);
  }

  function stopAll() {
    for (const a of active.current.values()) {
      a.pause();
      a.currentTime = 0;
    }
    active.current.clear();
    setPlaying(new Set());
    setLoopId(null);
    broadcast("stopall");
  }

  function changeVolume(v: number) {
    setVolume(v);
    for (const a of active.current.values()) a.volume = v;
  }

  async function addFiles(files: File[], useRelativePath: boolean) {
    for (const f of files) {
      if (!f.type.startsWith("audio/") && !/\.(mp3|ogg|wav|m4a|flac|webm)$/i.test(f.name)) continue;
      const uri = await fileToDataUrl(f).catch(() => null);
      const rel = useRelativePath ? ((f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name) : f.name;
      if (uri) await addAsset(campaignId, "sound", soundNameFromFile(rel), uri).catch(() => {});
    }
    await reload();
  }

  async function remove(id: string) {
    stopOne(id);
    await deleteAsset(id).catch(() => {});
    await reload();
  }

  function pad(s: VttAsset) {
    return (
      <div key={s.id} className={"vtt2-sb-pad" + (playing.has(s.id) ? " on" : "")}>
        <button className="vtt2-sb-play" onClick={() => play(s, false)} title="Play once — the whole table hears it">
          <span className="vtt2-sb-name">{soundDisplayName(s.name)}</span>
        </button>
        <div className="vtt2-sb-pad-row">
          <button className={"vtt2-sb-mini" + (loopId === s.id ? " on" : "")} onClick={() => play(s, true)} title="Loop as ambience">
            Loop
          </button>
          {playing.has(s.id) && (
            <button className="vtt2-sb-mini" onClick={() => stopOne(s.id)} title="Stop">Stop</button>
          )}
          <button className="vtt2-sb-mini danger" onClick={() => void remove(s.id)} title="Delete sound">Del</button>
        </div>
      </div>
    );
  }

  const groups = groupSounds(sounds);

  return (
    <div className="vtt2-soundboard">
      <div className="vtt2-insp-head">
        <span className="panel-title" style={{ margin: 0 }}>Soundboard</span>
        <div style={{ display: "flex", gap: 4 }}>
          <button className="icon-btn sm" onClick={() => void reload()} title="Reload sounds">⟳</button>
          <button className="cdx-tab-x" onClick={onClose} title="Close">×</button>
        </div>
      </div>
      <div className="vtt2-sb-sub">{sceneName}{net.status === "connected" ? " · heard by the table" : ""}</div>

      <div className="vtt2-sb-controls">
        <input ref={fileRef} type="file" accept="audio/*" multiple hidden onChange={(e) => { const f = Array.from(e.target.files ?? []); e.target.value = ""; void addFiles(f, false); }} />
        <input ref={folderRef} type="file" multiple hidden onChange={(e) => { const f = Array.from(e.target.files ?? []); e.target.value = ""; void addFiles(f, true); }} />
        <button className="chip" onClick={() => fileRef.current?.click()}>Upload…</button>
        <button className="chip" onClick={() => folderRef.current?.click()} title="Pick a folder — its audio files import organized by folder name">
          Upload folder…
        </button>
        <button className="chip" onClick={stopAll} disabled={playing.size === 0}>Stop all</button>
        <label className="vtt2-sb-vol" title="Master volume">
          Vol
          <input type="range" min={0} max={1} step={0.02} value={volume} onChange={(e) => changeVolume(parseFloat(e.target.value))} />
        </label>
      </div>

      {loading ? (
        <p className="list-empty" style={{ margin: "6px 0" }}>Loading sounds…</p>
      ) : sounds.length === 0 ? (
        <p className="list-empty" style={{ margin: "6px 0" }}>No sounds yet — upload clips (or a whole folder) to build this campaign's board.</p>
      ) : (
        groups.map((g) => (
          <div key={g.folder || "~"}>
            {g.folder && <div className="vtt2-actor-group">{g.folder}</div>}
            <div className="vtt2-sb-grid">{g.sounds.map(pad)}</div>
          </div>
        ))
      )}
    </div>
  );
}
