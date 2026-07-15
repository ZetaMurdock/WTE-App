import { useCallback, useEffect, useRef, useState } from "react";
import { isTauri, getFirebaseConfigRaw, saveFirebaseConfig, firebasePublishConfigured } from "../lib/tauri";
import { discovered, myPeerName, setPeerName, type DiscoveredHost } from "../net/discovery";
import { getNetConfig, setNetConfig, type NetConfig } from "../net/netconfig";
import { useNet } from "../net/NetContext";
import type { NetMessage } from "../net/protocol";

type RollMsg = Extract<NetMessage, { t: "roll" }>;
type ChatMsg = Extract<NetMessage, { t: "chat" }>;
type PartyMsg = Extract<NetMessage, { t: "party" }>;

// Phase 7b slice 4: the lobby drives the app-level session and shows live room state —
// roster, a shared roll/chat feed, and the party's shared character summaries.
export function LobbyView() {
  const net = useNet();
  const [name, setName] = useState(myPeerName());
  const [cfg, setCfg] = useState<NetConfig>(getNetConfig());
  const [room, setRoom] = useState("");
  const [feed, setFeed] = useState<{ from: string; body: string }[]>([]);
  const [party, setParty] = useState<Record<string, { name: string; summary: Record<string, unknown> }>>({});
  const [scanning, setScanning] = useState(false);
  const [hosts, setHosts] = useState<DiscoveredHost[]>([]);
  const scanTimer = useRef<number | undefined>(undefined);
  const [fbText, setFbText] = useState(getFirebaseConfigRaw());
  const [fbNote, setFbNote] = useState("");
  const [fbOk, setFbOk] = useState(firebasePublishConfigured());
  function saveFb() {
    const err = saveFirebaseConfig(fbText);
    setFbNote(err ?? "Saved — published Codex pages are now shared. Reopen the app to connect.");
    setFbOk(firebasePublishConfigured());
  }

  const peersRef = useRef(net.peers);
  peersRef.current = net.peers;
  const nameOf = useCallback((id: string) => peersRef.current.find((p) => p.id === id)?.name || id.slice(0, 6), []);

  useEffect(() => {
    const offRoll = net.subscribe("roll", (m, from) => {
      const r = m as RollMsg;
      setFeed((f) => [{ from, body: `rolled ${r.label} = ${r.result}` }, ...f].slice(0, 40));
    });
    const offChat = net.subscribe("chat", (m, from) => setFeed((f) => [{ from, body: `— ${(m as ChatMsg).text}` }, ...f].slice(0, 40)));
    const offParty = net.subscribe("party", (m, from) => {
      const p = m as PartyMsg;
      setParty((cur) => ({ ...cur, [from]: { name: p.name, summary: p.summary } }));
    });
    return () => {
      offRoll();
      offChat();
      offParty();
    };
  }, [net.subscribe, nameOf]);

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
  function sendTestRoll() {
    const result = 1 + Math.floor(Math.random() * 20);
    net.publish({ t: "roll", label: "test d20", formula: "1d20", result });
    setFeed((f) => [{ from: net.selfId, body: `rolled test d20 = ${result}` }, ...f].slice(0, 40));
  }

  if (net.status === "connected") {
    return (
      <div className="dashboard">
        <div className="dash-header">
          <div>
            <div className="dash-eyebrow">Netplay · {net.role === "host" ? "hosting" : "joined"}</div>
            <h1 className="dash-title">Room · {net.room}</h1>
          </div>
          <button className="ghost-btn" onClick={net.leave}>Leave</button>
        </div>
        <div className="lobby-grid">
          <div className="lobby-card">
            <div className="panel-title">Players ({net.peers.length})</div>
            <div className="chip-list">
              {net.peers.map((p) => (
                <span key={p.id} className={"load-chip" + (p.role === "host" ? " cipher" : "")}>
                  {p.name}
                  {p.id === net.selfId ? " (you)" : ""}
                  {p.role === "host" ? " · host" : ""}
                </span>
              ))}
            </div>
            <button className="primary-btn full mt" onClick={sendTestRoll}>Send test roll</button>
          </div>
          <div className="lobby-card">
            <div className="panel-title">Party sheets</div>
            {Object.keys(party).length === 0 ? (
              <p className="list-empty">Open a character and press “Share to party”.</p>
            ) : (
              <div className="party-list">
                {Object.entries(party).map(([from, c]) => (
                  <div className="party-row" key={from}>
                    <span className="party-name">{c.name}</span>
                    <span className="party-meta">
                      {[c.summary.species, c.summary.paradigm].filter(Boolean).join(" · ")}
                      {c.summary.hp != null ? ` · HP ${String(c.summary.hp)}` : ""}
                      {c.summary.ss != null ? ` · SS ${String(c.summary.ss)}` : ""}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
        <div className="lobby-scan">
          <div className="panel-title">Live feed</div>
          {feed.length === 0 ? (
            <p className="list-empty">Rolls from the whole room show up here.</p>
          ) : (
            <ul className="lobby-feed">
              {feed.map((line, i) => (
                <li key={i}>
                  <b>{nameOf(line.from)}</b> {line.body}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    );
  }

  const others = hosts.filter((h) => h.peer !== net.selfId);

  return (
    <div className="dashboard">
      <div className="dash-header">
        <div>
          <div className="dash-eyebrow">Netplay · same Wi-Fi or across the internet</div>
          <h1 className="dash-title">Lobby</h1>
        </div>
      </div>

      {net.error && <div className="validation-list" style={{ marginBottom: 16 }}>{net.error}</div>}

      <div className="lobby-grid">
        <div className="lobby-card">
          <div className="panel-title">You</div>
          <label className="lobby-field">
            <span>Display name</span>
            <input className="bg-select full" value={name} onChange={(e) => saveName(e.target.value)} placeholder="Player" />
          </label>
          <div className="lobby-id">Peer id · {net.selfId.slice(0, 8)}</div>
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

        <div className="lobby-card">
          <div className="panel-title">Shared library {fbOk ? "· connected" : "· not set"}</div>
          <p className="vtt2-actor-hint" style={{ margin: "0 0 6px" }}>
            Paste your Firebase config (free Spark plan → Realtime Database) so Codex pages you publish are visible to everyone. See docs/PUBLISH-SETUP.md.
          </p>
          <textarea
            className="bg-select full"
            style={{ minHeight: 96, fontFamily: "Consolas, monospace", fontSize: 11 }}
            value={fbText}
            onChange={(e) => setFbText(e.target.value)}
            placeholder={'{ "apiKey": "…", "projectId": "…", "databaseURL": "https://…firebasedatabase.app" }'}
          />
          <button className="primary-btn full mt" onClick={saveFb}>Save shared-library config</button>
          {fbNote && <p className="vtt2-actor-hint" style={{ marginTop: 6 }}>{fbNote}</p>}
        </div>
      </div>

      <div className="lobby-grid">
        <div className="lobby-card">
          <div className="panel-title">Host a room</div>
          <input className="bg-select full" value={room} onChange={(e) => setRoom(e.target.value)} placeholder="Room code (share this)" />
          <button className="primary-btn full mt" onClick={() => net.host(room)} disabled={net.status === "connecting"}>
            {net.status === "connecting" ? "Connecting…" : "Host room"}
          </button>
        </div>
        <div className="lobby-card">
          <div className="panel-title">Join a room</div>
          <input className="bg-select full" value={room} onChange={(e) => setRoom(e.target.value)} placeholder="Room code" />
          <button className="primary-btn full mt" onClick={() => net.join(room)} disabled={net.status === "connecting"}>
            {net.status === "connecting" ? "Connecting…" : "Join room"}
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
                <button className="char-open" onClick={() => net.join(h.room)}>
                  <div className="char-name">{h.room || "Room"}</div>
                  <div className="char-meta">{(h.peer || "peer").slice(0, 8)}{h.addrs[0] ? " · " + h.addrs[0] : ""}</div>
                </button>
                <div className="char-actions">
                  <button className="icon-btn accent" onClick={() => net.join(h.room)}>Join</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
