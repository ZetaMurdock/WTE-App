// App-level netplay session. Owns the NetSession lifecycle (host/join/leave) and
// re-dispatches wire events to React subscribers, so any part of the app — the
// character sheet, the lobby, later the VTT — can broadcast and listen without
// touching the transport. See docs/NETPLAY.md.
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { WebRtcTransport } from "./webrtc";
import { NetSession } from "./session";
import { getNetConfig, buildIceServers } from "./netconfig";
import { advertise, unadvertise, myPeerId, myPeerName } from "./discovery";
import type { NetMessage, NetMessageType, Peer } from "./protocol";

type Status = "idle" | "connecting" | "connected";
type Sub = (msg: NetMessage, from: string) => void;
type Role = "host" | "player";

interface NetApi {
  status: Status;
  role: Role;
  room: string;
  peers: Peer[];
  selfId: string;
  error: string;
  host(code: string): Promise<void>;
  join(code: string): Promise<void>;
  leave(): void;
  publish(msg: NetMessage, to?: string): void;
  subscribe(type: NetMessageType, cb: Sub): () => void;
  /** Shared Base Pressure for the table (synced while in a room). */
  bp: number;
  setSharedBp(value: number): void;
}

const Ctx = createContext<NetApi | null>(null);
export function useNet(): NetApi {
  const c = useContext(Ctx);
  if (!c) throw new Error("useNet must be used inside <NetProvider>");
  return c;
}

// Wire event types re-dispatched to React subscribers.
const FANOUT: NetMessageType[] = ["roll", "chat", "party", "presence", "sheet-patch", "vtt-patch", "snapshot", "bp"];

export function NetProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>("idle");
  const [role, setRole] = useState<Role>("host");
  const [room, setRoom] = useState("");
  const [peers, setPeers] = useState<Peer[]>([]);
  const [error, setError] = useState("");
  const [bp, setBp] = useState(50);
  const sessionRef = useRef<NetSession | null>(null);
  const listeners = useRef(new Map<string, Set<Sub>>());
  const selfId = myPeerId();

  // Keep the shared Base Pressure in sync with the room (host relays it to all).
  useEffect(() => {
    return subscribe("bp", (m) => setBp((m as Extract<NetMessage, { t: "bp" }>).value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const setSharedBp = useCallback((value: number) => {
    setBp(value);
    sessionRef.current?.publish({ t: "bp", value });
  }, []);

  const emit = (type: string, msg: NetMessage, from: string) => listeners.current.get(type)?.forEach((cb) => cb(msg, from));

  const subscribe = useCallback((type: NetMessageType, cb: Sub) => {
    let set = listeners.current.get(type);
    if (!set) listeners.current.set(type, (set = new Set()));
    set.add(cb);
    return () => {
      listeners.current.get(type)?.delete(cb);
    };
  }, []);

  const publish = useCallback((msg: NetMessage, to?: string) => {
    sessionRef.current?.publish(msg, to);
  }, []);

  const connect = useCallback(
    async (asRole: Role, code: string) => {
      const c = code.trim();
      if (!c) return;
      const cfg = getNetConfig();
      if (!cfg.signalUrl.trim()) {
        setError("Set a signaling server URL first (Netplay settings).");
        return;
      }
      setError("");
      setRole(asRole);
      setStatus("connecting");
      try {
        const name = myPeerName();
        const iceServers = await buildIceServers(cfg);
        const transport = new WebRtcTransport({ signalUrl: cfg.signalUrl.trim(), room: c, peerId: selfId, role: asRole, name, iceServers });
        const session = new NetSession(transport, { name, role: asRole });
        session.onPeers(setPeers);
        for (const t of FANOUT) session.on(t, (m, from) => emit(t, m, from));
        await session.start();
        sessionRef.current = session;
        setRoom(c);
        setStatus("connected");
        if (asRole === "host") await advertise(c).catch(() => {});
      } catch (e) {
        setStatus("idle");
        setError(e instanceof Error ? e.message : "Connection failed.");
      }
    },
    [selfId]
  );

  const leave = useCallback(() => {
    sessionRef.current?.close();
    sessionRef.current = null;
    void unadvertise().catch(() => {});
    setStatus("idle");
    setPeers([]);
    setRoom("");
  }, []);

  // Bridge for the legacy tool iframes (same-origin): the VTT reads
  // window.parent.wteNet to ride the P2P room for map/token sync.
  const liveRef = useRef({ status, role, room, selfId });
  liveRef.current = { status, role, room, selfId };

  // When a peer joins, the host resyncs the shared Base Pressure to the room so
  // late joiners land on the current value instead of the default.
  const bpRef = useRef(bp);
  bpRef.current = bp;
  const prevPeerCount = useRef(0);
  useEffect(() => {
    const grew = peers.length > prevPeerCount.current;
    prevPeerCount.current = peers.length;
    if (grew && liveRef.current.role === "host" && liveRef.current.status === "connected") {
      sessionRef.current?.publish({ t: "bp", value: bpRef.current });
    }
  }, [peers]);
  useEffect(() => {
    const w = window as unknown as { wteNet?: unknown };
    w.wteNet = {
      get status() {
        return liveRef.current.status;
      },
      get role() {
        return liveRef.current.role;
      },
      get room() {
        return liveRef.current.room;
      },
      get selfId() {
        return liveRef.current.selfId;
      },
      publish,
      subscribe,
    };
    return () => {
      delete w.wteNet;
    };
  }, [publish, subscribe]);

  const api: NetApi = {
    status,
    role,
    room,
    peers,
    selfId,
    error,
    host: (c) => connect("host", c),
    join: (c) => connect("player", c),
    leave,
    publish,
    subscribe,
    bp,
    setSharedBp,
  };
  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}
