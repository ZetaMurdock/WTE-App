// App-level netplay session. Owns the NetSession lifecycle (host/join/leave) and
// re-dispatches wire events to React subscribers, so any part of the app — the
// character sheet, the lobby, later the VTT — can broadcast and listen without
// touching the transport. See docs/NETPLAY.md.
import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
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
}

const Ctx = createContext<NetApi | null>(null);
export function useNet(): NetApi {
  const c = useContext(Ctx);
  if (!c) throw new Error("useNet must be used inside <NetProvider>");
  return c;
}

// Wire event types re-dispatched to React subscribers.
const FANOUT: NetMessageType[] = ["roll", "chat", "party", "presence", "sheet-patch", "vtt-patch", "snapshot"];

export function NetProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>("idle");
  const [role, setRole] = useState<Role>("host");
  const [room, setRoom] = useState("");
  const [peers, setPeers] = useState<Peer[]>([]);
  const [error, setError] = useState("");
  const sessionRef = useRef<NetSession | null>(null);
  const listeners = useRef(new Map<string, Set<Sub>>());
  const selfId = myPeerId();

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
  };
  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}
