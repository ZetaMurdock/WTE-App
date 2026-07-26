import { useCallback, useEffect, useRef, useState } from "react";
import { isTauri, getFirebaseConfigRaw, saveFirebaseConfig, firebasePublishConfigured, usingCustomFirebaseConfig } from "../lib/tauri";
import { discovered, myPeerName, setPeerName, type DiscoveredHost } from "../net/discovery";
import { deleteSavedRoom, listSavedRooms, newRoomCode, type SavedRoom } from "../net/savedRooms";
import { getNetConfig, setNetConfig, type NetConfig } from "../net/netconfig";
import { useNet } from "../net/NetContext";
import type { NetMessage } from "../net/protocol";
import { Collapsible } from "./ui/Collapsible";

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
  const [saved, setSaved] = useState<SavedRoom[]>(listSavedRooms());
  const scanTimer = useRef<number | undefined>(undefined);
  const [fbText, setFbText] = useState(getFirebaseConfigRaw());
  const [fbNote, setFbNote] = useState("");
  const [fbOk, setFbOk] = useState(firebasePublishConfigured());
  const [fbCustom, setFbCustom] = useState(usingCustomFirebaseConfig());
  const [copied, setCopied] = useState("");
  const fbTimer = useRef<number | undefined>(undefined);

  // The config saves as you type — there is no Save button to forget to press.
  // Debounced so a half-pasted object doesn't churn an error message.
  function onFbChange(text: string) {
    setFbText(text);
    window.clearTimeout(fbTimer.current);
    fbTimer.current = window.setTimeout(() => {
      const err = saveFirebaseConfig(text);
      setFbOk(firebasePublishConfigured());
      setFbCustom(usingCustomFirebaseConfig());
      setFbNote(err ?? (usingCustomFirebaseConfig() ? "Saved — reopen the app to connect to your project." : "Using the built-in community library."));
    }, 600);
  }

  async function copyCode(code: string) {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(code);
      window.setTimeout(() => setCopied(""), 1600);
    } catch {
      /* clipboard blocked — the code is on screen to read anyway */
    }
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

  // Refresh the saved-room cards whenever we land back on the idle screen —
  // the room just hosted/joined was upserted by NetContext and should lead.
  useEffect(() => {
    if (net.status === "idle") setSaved(listSavedRooms());
  }, [net.status]);

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
            <div className="dash-eyebrow">
              Netplay · {net.role === "host" ? "hosting" : "joined"}
              {net.locked ? " · locked" : ""}
            </div>
            <h1 className="dash-title">
              Room · {net.room}
              <button className="icon-btn xs room-copy" onClick={() => void copyCode(net.room)} title="Copy the room code">
                {copied === net.room ? "Copied" : "Copy"}
              </button>
            </h1>
            <div className="lobby-id">Saved automatically — it's in Saved rooms next time you open the lobby.</div>
          </div>
          <button className="ghost-btn" onClick={net.leave}>Leave</button>
        </div>
        <div className="lobby-grid">
          <div className="lobby-card">
            <div className="panel-title">This room</div>
            {net.role === "host" ? (
              <>
                <button
                  className={"chip" + (net.locked ? " active" : "")}
                  onClick={() => net.setLocked(!net.locked)}
                  title="A locked room refuses new joins — everyone already inside stays"
                >
                  {net.locked ? "Locked — no new joins" : "Open — anyone with the code can join"}
                </button>
                <label className="lobby-field mt">
                  <span>Next session (shown on everyone's room card)</span>
                  <input
                    className="bg-select full"
                    value={net.nextSession}
                    onChange={(e) => net.setNextSession(e.target.value)}
                    placeholder="e.g. Sat 8pm — the sunken vault"
                  />
                </label>
              </>
            ) : net.nextSession ? (
              <p className="vtt2-actor-hint" style={{ margin: 0 }}>Next session · {net.nextSession}</p>
            ) : (
              <p className="list-empty">The host can set the next session here.</p>
            )}
          </div>
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

      {/* CONNECT comes first — it is what the page is for. One code field, two
          verbs, and the Curator never has to invent a code. */}
      <div className="lobby-connect">
        <div className="lobby-connect-main">
          <label className="lobby-field">
            <span>Room code</span>
            <div className="lobby-code-row">
              <input
                className="bg-select lobby-code"
                value={room}
                onChange={(e) => setRoom(e.target.value.toUpperCase())}
                placeholder="e.g. VAULT7"
                spellCheck={false}
              />
              <button className="icon-btn" onClick={() => setRoom(newRoomCode())} title="Generate a fresh code">
                New code
              </button>
            </div>
          </label>
          <div className="lobby-connect-actions">
            <button className="primary-btn" onClick={() => net.host(room)} disabled={!room.trim() || net.status === "connecting"}>
              {net.status === "connecting" ? "Connecting…" : "Host"}
            </button>
            <button className="ghost-btn" onClick={() => net.join(room)} disabled={!room.trim() || net.status === "connecting"}>
              Join
            </button>
          </div>
        </div>
        <p className="lobby-connect-hint">
          Hosting saves the code the moment you press Host, so it lands in Saved rooms below even if the
          connection fails.
        </p>
      </div>

      {saved.length > 0 && (
        <div className="lobby-rooms">
          <div className="panel-title">Saved rooms</div>
          <div className="room-grid">
            {saved.map((r) => (
              <div className={"room-card" + (r.role === "host" ? " mine" : "")} key={r.code}>
                <button
                  className="room-open"
                  onClick={() => (r.role === "host" ? void net.host(r.code) : void net.join(r.code))}
                  disabled={net.status === "connecting"}
                  title={r.role === "host" ? "Host this room again" : "Rejoin this room"}
                >
                  <span className="room-code">{r.code}</span>
                  <span className="room-meta">
                    {r.role === "host" ? "Your room" : "Joined"}
                    {r.nextSession ? " · " + r.nextSession : ""}
                  </span>
                </button>
                <div className="room-tools">
                  <button className="icon-btn xs" onClick={() => void copyCode(r.code)} title="Copy the code">
                    Copy
                  </button>
                  <button className="icon-btn xs" onClick={() => setSaved(deleteSavedRoom(r.code))} title="Forget this room">
                    ×
                  </button>
                </div>
              </div>
            ))}
          </div>
          {copied && <p className="lobby-copied">Copied {copied}</p>}
        </div>
      )}

      <div className="lobby-rooms">
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
          <div className="room-grid">
            {others.map((h) => (
              <div className="room-card" key={h.fullname}>
                <button className="room-open" onClick={() => net.join(h.room)}>
                  <span className="room-code">{h.room || "Room"}</span>
                  <span className="room-meta">
                    {(h.peer || "peer").slice(0, 8)}
                    {h.addrs[0] ? " · " + h.addrs[0] : ""}
                  </span>
                </button>
                <div className="room-tools">
                  <button className="icon-btn xs" onClick={() => net.join(h.room)}>Join</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Settings sit BELOW the actions and stay folded — they are set once. */}
      <div className="lobby-settings">
        <Collapsible title={`You · ${name || "unnamed"}`}>
          <label className="lobby-field">
            <span>Display name</span>
            <input className="bg-select full" value={name} onChange={(e) => saveName(e.target.value)} placeholder="Player" />
          </label>
          <div className="lobby-id">Peer id · {net.selfId.slice(0, 8)}</div>
        </Collapsible>

        <Collapsible title={`Netplay settings${cfg.signalUrl.trim() ? "" : " · signaling not set"}`} defaultOpen={!cfg.signalUrl.trim()}>
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
        </Collapsible>

        <Collapsible title={`Shared library · ${fbCustom ? "your project" : "built-in"}${fbOk ? "" : " · unavailable"}`}>
          <p className="vtt2-actor-hint" style={{ margin: "0 0 6px" }}>
            W.T.E ships with a built-in community library, already configured — you can pull official pages
            with no setup. Anything <b>published</b> to it is <b>public</b> to everyone using the app, so keep
            private notes out of it.
          </p>
          <p className="vtt2-actor-hint" style={{ margin: "0 0 6px" }}>
            Want a library only your group can see? Paste your own Firebase config (free Spark plan → Realtime
            Database) below — it saves as you type. Clear the box to go back to the built-in one.
          </p>
          <textarea
            className="bg-select full"
            style={{ minHeight: 118, fontFamily: "Consolas, monospace", fontSize: 11 }}
            value={fbText}
            onChange={(e) => onFbChange(e.target.value)}
            spellCheck={false}
          />
          <p className="vtt2-actor-hint" style={{ marginTop: 6 }}>{fbNote || (fbCustom ? "Pointed at your own project." : "Using the built-in community library.")}</p>
        </Collapsible>
      </div>
    </div>
  );
}
