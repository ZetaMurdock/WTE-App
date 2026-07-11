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

// Phase 7b slice 2a: LAN lobby. Host advertises an mDNS room; others scan and see
// it appear with no server. WebRTC connect ("Join") lands in the next slice.
export function LobbyView() {
  const peer = myPeerId();
  const [name, setName] = useState(myPeerName());
  const [room, setRoom] = useState("");
  const [hosting, setHosting] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [hosts, setHosts] = useState<DiscoveredHost[]>([]);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (!scanning) return;
    let alive = true;
    const tick = async () => {
      const list = await discovered();
      if (alive) setHosts(list);
    };
    void tick();
    timer.current = window.setInterval(tick, 2000);
    return () => {
      alive = false;
      window.clearInterval(timer.current);
    };
  }, [scanning]);

  if (!isTauri()) {
    return (
      <div className="dashboard">
        <p className="list-empty">The lobby needs the desktop app (LAN discovery).</p>
      </div>
    );
  }

  async function host() {
    if (!room.trim()) return;
    await advertise(room.trim());
    setHosting(true);
    setScanning(true);
  }
  async function stopHosting() {
    await unadvertise();
    setHosting(false);
  }
  function saveName(v: string) {
    setName(v);
    setPeerName(v);
  }

  const others = hosts.filter((h) => h.peer !== peer);

  return (
    <div className="dashboard">
      <div className="dash-header">
        <div>
          <div className="dash-eyebrow">Netplay · same Wi-Fi</div>
          <h1 className="dash-title">Lobby</h1>
        </div>
      </div>

      <div className="lobby-grid">
        <div className="lobby-card">
          <div className="panel-title">You</div>
          <label className="lobby-field">
            <span>Display name</span>
            <input className="bg-select full" value={name} onChange={(e) => saveName(e.target.value)} placeholder="Player" />
          </label>
          <div className="lobby-id">Peer id · {peer.slice(0, 8)}</div>
        </div>

        <div className="lobby-card">
          <div className="panel-title">Host a room</div>
          {hosting ? (
            <>
              <p className="lobby-note">Advertising “{room}” on your Wi-Fi. Others on this network will see it below.</p>
              <button className="ghost-btn" onClick={stopHosting}>Stop hosting</button>
            </>
          ) : (
            <>
              <input className="bg-select full" value={room} onChange={(e) => setRoom(e.target.value)} placeholder="Room name" />
              <button className="primary-btn full mt" onClick={host} disabled={!room.trim()}>Host room</button>
            </>
          )}
        </div>
      </div>

      <div className="lobby-scan">
        <div className="panel-title">
          Rooms on your network
          <button className={"chip" + (scanning ? " active" : "")} onClick={() => setScanning((s) => !s)} style={{ marginLeft: 10 }}>
            {scanning ? "Scanning…" : "Scan"}
          </button>
        </div>
        {!scanning ? (
          <p className="list-empty">Press Scan to look for rooms on your Wi-Fi.</p>
        ) : others.length === 0 ? (
          <p className="list-empty">No rooms found yet. Have someone else Host a room on the same Wi-Fi.</p>
        ) : (
          <div className="char-grid">
            {others.map((h) => (
              <div className="char-card" key={h.fullname}>
                <div className="char-open" style={{ cursor: "default" }}>
                  <div className="char-name">{h.room || "Room"}</div>
                  <div className="char-meta">
                    {(h.peer || "peer").slice(0, 8)}
                    {h.addrs[0] ? " · " + h.addrs[0] : ""}
                  </div>
                </div>
                <div className="char-actions">
                  <button className="icon-btn" disabled title="WebRTC connect arrives in the next update">
                    Join (soon)
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
