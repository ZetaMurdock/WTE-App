import { useEffect, useRef, useState } from "react";
import { isTauri } from "../lib/tauri";
import {
  advertise,
  unadvertise,
  discovered,
  myPeerId,
  myPeerName,
  setPeerName,
  type DiscoveredHost,
} from "../net/discovery";
import { getNetConfig, setNetConfig, buildIceServers, type NetConfig } from "../net/netconfig";
import { WebRtcTransport } from "../net/webrtc";
import { NetSession } from "../net/session";
import type { Peer } from "../net/protocol";

type Mode = "idle" | "connecting" | "connected";

// Phase 7b slice 2b: connect a room over WebRTC (LAN or internet) via the room-code
// signaling server, with a live roster + a test roll to prove the data channel.
export function LobbyView() {
  const peerId = myPeerId();
  const [name, setName] = useState(myPeerName());
  const [cfg, setCfg] = useState<NetConfig>(getNetConfig());
  const [room, setRoom] = useState("");
  const [mode, setMode] = useState<Mode>("idle");
  const [role, setRole] = useState<"host" | "player">("host");
  const [error, setError] = useState("");
  const [peers, setPeers] = useState<Peer[]>([]);
  const [feed, setFeed] = useState<string[]>([]);
  const [scanning, setScanning] = useState(false);
  const [hosts, setHosts] = useState<DiscoveredHost[]>([]);
  const sessionRef = useRef<NetSession | null>(null);
  const scanTimer = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (!scanning) return;
    let alive = true;
    const tick = async () => {
      const list = await discovered();
      if (alive) setHosts(list);
    };
    void tick();
    scanTimer.current = window.setInterval(tick, 2000);
    return () => {
      alive = false;
      window.clearInterval(scanTimer.current);
    };
  }, [scanning]);

  useEffect(() => () => sessionRef.current?.close(), []);

  if (!isTauri()) {
    return (
      <div className="dashboard">
        <p className="list-empty">The lobby needs the desktop app.</p>
      </div>
    );
  }

  function saveCfg(patch: Partial<NetConfig>) {
    const next = { ...cfg, ...patch };
    setCfg(next);
    setNetConfig(next);
  }
  function saveName(v: string) {
    setName(v);
    setPeerName(v);
  }
  const nameOf = (id: string) => peers.find((p) => p.id === id)?.name || id.slice(0, 6);
  const pushFeed = (line: string) => setFeed((f) => [line, ...f].slice(0, 40));

  async function connect(asRole: "host" | "player", roomCode: string) {
    const code = roomCode.trim();
    if (!code) return;
    if (!cfg.signalUrl.trim()) {
      setError("Set a signaling server URL first (Netplay settings).");
      return;
    }
    setError("");
    setRole(asRole);
    setMode("connecting");
    try {
      const iceServers = await buildIceServers(cfg);
      const transport = new WebRtcTransport({ signalUrl: cfg.signalUrl.trim(), room: code, peerId, role: asRole, name, iceServers });
      const session = new NetSession(transport, { name, role: asRole });
      session.onPeers(setPeers);
      session.on("roll", (m, from) => pushFeed(`${nameOf(from)} rolled ${m.label} = ${m.result}`));
      session.on("chat", (m, from) => pushFeed(`${nameOf(from)}: ${m.text}`));
      await session.start();
      sessionRef.current = session;
      setRoom(code);
      setMode("connected");
      if (asRole === "host") await advertise(code).catch(() => {});
    } catch (e) {
      setMode("idle");
      setError(e instanceof Error ? e.message : "Connection failed.");
    }
  }

  async function leave() {
    sessionRef.current?.close();
    sessionRef.current = null;
    if (role === "host") await unadvertise().catch(() => {});
    setMode("idle");
    setPeers([]);
    setFeed([]);
  }

  function sendTestRoll() {
    const result = 1 + Math.floor(Math.random() * 20);
    sessionRef.current?.publish({ t: "roll", label: "test d20", formula: "1d20", result });
    pushFeed(`You rolled test d20 = ${result}`);
  }

  if (mode === "connected") {
    return (
      <div className="dashboard">
        <div className="dash-header">
          <div>
            <div className="dash-eyebrow">Netplay · {role === "host" ? "hosting" : "joined"}</div>
            <h1 className="dash-title">Room · {room}</h1>
          </div>
          <button className="ghost-btn" onClick={leave}>Leave</button>
        </div>
        <div className="lobby-grid">
          <div className="lobby-card">
            <div className="panel-title">Players ({peers.length})</div>
            <div className="chip-list">
              {peers.map((p) => (
                <span key={p.id} className={"load-chip" + (p.role === "host" ? " cipher" : "")}>
                  {p.name}
                  {p.id === peerId ? " (you)" : ""}
                  {p.role === "host" ? " · host" : ""}
                </span>
              ))}
            </div>
            <button className="primary-btn full mt" onClick={sendTestRoll}>Send test roll</button>
          </div>
          <div className="lobby-card">
            <div className="panel-title">Live feed</div>
            {feed.length === 0 ? (
              <p className="list-empty">Rolls and messages from the room appear here.</p>
            ) : (
              <ul className="lobby-feed">
                {feed.map((line, i) => (
                  <li key={i}>{line}</li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    );
  }

  const others = hosts.filter((h) => h.peer !== peerId);

  return (
    <div className="dashboard">
      <div className="dash-header">
        <div>
          <div className="dash-eyebrow">Netplay · same Wi-Fi or across the internet</div>
          <h1 className="dash-title">Lobby</h1>
        </div>
      </div>

      {error && <div className="validation-list" style={{ marginBottom: 16 }}>{error}</div>}

      <div className="lobby-grid">
        <div className="lobby-card">
          <div className="panel-title">You</div>
          <label className="lobby-field">
            <span>Display name</span>
            <input className="bg-select full" value={name} onChange={(e) => saveName(e.target.value)} placeholder="Player" />
          </label>
          <div className="lobby-id">Peer id · {peerId.slice(0, 8)}</div>
        </div>

        <div className="lobby-card">
          <div className="panel-title">Netplay settings</div>
          <label className="lobby-field">
            <span>Signaling server</span>
            <input className="bg-select full" value={cfg.signalUrl} onChange={(e) => saveCfg({ signalUrl: e.target.value })} placeholder="wss://signal.example.com" />
          </label>
          <label className="lobby-field mt">
            <span>TURN urls (optional)</span>
            <input className="bg-select full" value={cfg.turnUrl} onChange={(e) => saveCfg({ turnUrl: e.target.value })} placeholder="turns:turn.example.com:5349" />
          </label>
          <label className="lobby-field mt">
            <span>TURN secret (optional)</span>
            <input className="bg-select full" type="password" value={cfg.turnSecret} onChange={(e) => saveCfg({ turnSecret: e.target.value })} placeholder="coturn static-auth-secret" />
          </label>
        </div>
      </div>

      <div className="lobby-grid">
        <div className="lobby-card">
          <div className="panel-title">Host a room</div>
          <input className="bg-select full" value={role === "host" ? room : ""} onChange={(e) => setRoom(e.target.value)} placeholder="Room code (share this)" />
          <button className="primary-btn full mt" onClick={() => connect("host", room)} disabled={mode === "connecting"}>
            {mode === "connecting" && role === "host" ? "Connecting…" : "Host room"}
          </button>
        </div>
        <div className="lobby-card">
          <div className="panel-title">Join a room</div>
          <input className="bg-select full" value={role === "player" ? room : ""} onChange={(e) => setRoom(e.target.value)} placeholder="Room code" />
          <button className="primary-btn full mt" onClick={() => connect("player", room)} disabled={mode === "connecting"}>
            {mode === "connecting" && role === "player" ? "Connecting…" : "Join room"}
          </button>
        </div>
      </div>

      <div className="lobby-scan">
        <div className="panel-title">
          Rooms on your Wi-Fi
          <button className={"chip" + (scanning ? " active" : "")} onClick={() => setScanning((s) => !s)} style={{ marginLeft: 10 }}>
            {scanning ? "Scanning…" : "Scan"}
          </button>
        </div>
        {!scanning ? (
          <p className="list-empty">Scan to auto-find local rooms (they still connect through your signaling server).</p>
        ) : others.length === 0 ? (
          <p className="list-empty">No local rooms found yet.</p>
        ) : (
          <div className="char-grid">
            {others.map((h) => (
              <div className="char-card" key={h.fullname}>
                <button className="char-open" onClick={() => connect("player", h.room)}>
                  <div className="char-name">{h.room || "Room"}</div>
                  <div className="char-meta">{(h.peer || "peer").slice(0, 8)}{h.addrs[0] ? " · " + h.addrs[0] : ""}</div>
                </button>
                <div className="char-actions">
                  <button className="icon-btn accent" onClick={() => connect("player", h.room)}>Join</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
