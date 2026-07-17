// App-level netplay session. Owns the NetSession lifecycle (host/join/leave) and
// re-dispatches wire events to React subscribers, so any part of the app — the
// character sheet, the lobby, later the VTT — can broadcast and listen without
// touching the transport. See docs/NETPLAY.md.
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { WebRtcTransport } from "./webrtc";
import { NetSession } from "./session";
import { getNetConfig, buildIceServers } from "./netconfig";
import { advertise, unadvertise, myPeerId, myPeerName } from "./discovery";
import { listSavedRooms, upsertSavedRoom } from "./savedRooms";
import type { NetMessage, NetMessageType, Peer } from "./protocol";
import type { DeskNote } from "../lib/campaignDesk";

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
  /** Shared party ("Unit") notes, synced across the room. */
  unitNotes: DeskNote[];
  upsertUnitNote(note: DeskNote): void;
  deleteUnitNote(id: string): void;
  /** Replace the whole shared set (host seeds it from its local notes). */
  syncUnitNotes(notes: DeskNote[]): void;
  /** Room lock (host only): a locked room refuses NEW joins. */
  locked: boolean;
  setLocked(v: boolean): void;
  /** Table info shown on saved-room cards (host sets; syncs to the room). */
  nextSession: string;
  setNextSession(v: string): void;
}

const Ctx = createContext<NetApi | null>(null);
export function useNet(): NetApi {
  const c = useContext(Ctx);
  if (!c) throw new Error("useNet must be used inside <NetProvider>");
  return c;
}

// Wire event types re-dispatched to React subscribers.
const FANOUT: NetMessageType[] = ["roll", "chat", "party", "presence", "sheet-patch", "vtt-patch", "snapshot", "bp", "unit-note", "sfx", "room-locked", "room-info"];

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

  // Shared party ("Unit") notes: applied by per-note op or a full sync.
  const [unitNotes, setUnitNotes] = useState<DeskNote[]>([]);
  useEffect(() => {
    return subscribe("unit-note", (raw) => {
      const m = raw as Extract<NetMessage, { t: "unit-note" }>;
      if (m.op === "sync") setUnitNotes(m.notes ?? []);
      else if (m.op === "delete") setUnitNotes((cur) => cur.filter((n) => n.id !== m.id));
      else if (m.op === "upsert" && m.note) {
        setUnitNotes((cur) => {
          const i = cur.findIndex((n) => n.id === m.note!.id);
          if (i >= 0) {
            const next = cur.slice();
            next[i] = m.note!;
            return next;
          }
          return [m.note!, ...cur];
        });
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const upsertUnitNote = useCallback((note: DeskNote) => {
    setUnitNotes((cur) => {
      const i = cur.findIndex((n) => n.id === note.id);
      if (i >= 0) {
        const next = cur.slice();
        next[i] = note;
        return next;
      }
      return [note, ...cur];
    });
    sessionRef.current?.publish({ t: "unit-note", op: "upsert", note });
  }, []);
  const deleteUnitNote = useCallback((id: string) => {
    setUnitNotes((cur) => cur.filter((n) => n.id !== id));
    sessionRef.current?.publish({ t: "unit-note", op: "delete", id });
  }, []);
  const syncUnitNotes = useCallback((notes: DeskNote[]) => {
    setUnitNotes(notes);
    sessionRef.current?.publish({ t: "unit-note", op: "sync", notes });
  }, []);

  // Room lock + shared table info (next session), persisted per saved room.
  const [locked, setLockedState] = useState(false);
  const [nextSession, setNextSessionState] = useState("");
  const roomRef = useRef(room);
  roomRef.current = room;
  const roleRef = useRef(role);
  roleRef.current = role;
  const nextSessionRef = useRef(nextSession);
  nextSessionRef.current = nextSession;
  const setLocked = useCallback((v: boolean) => {
    setLockedState(v);
    if (sessionRef.current) sessionRef.current.locked = v;
  }, []);
  const setNextSession = useCallback((v: string) => {
    setNextSessionState(v);
    if (roomRef.current) upsertSavedRoom({ code: roomRef.current, nextSession: v });
    if (roleRef.current === "host") sessionRef.current?.publish({ t: "room-info", nextSession: v });
  }, []);
  useEffect(() => {
    // The host said no: surface it and drop the half-open transport.
    return subscribe("room-locked", () => {
      setError("That room is locked by its host.");
      leave();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    // Host-pushed table info lands on OUR saved card for this room.
    return subscribe("room-info", (m) => {
      const info = m as Extract<NetMessage, { t: "room-info" }>;
      setNextSessionState(info.nextSession ?? "");
      if (roomRef.current) upsertSavedRoom({ code: roomRef.current, nextSession: info.nextSession ?? "" });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
        // Remember the room (one-click next time) and restore its table info.
        upsertSavedRoom({ code: c, role: asRole });
        const saved = listSavedRooms().find((r) => r.code === c);
        setNextSessionState(saved?.nextSession ?? "");
        setLockedState(false);
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
    setLockedState(false);
    setNextSessionState("");
  }, []);

  // Bridge for the legacy tool iframes (same-origin): the VTT reads
  // window.parent.wteNet to ride the P2P room for map/token sync.
  const liveRef = useRef({ status, role, room, selfId });
  liveRef.current = { status, role, room, selfId };

  // When a peer joins, the host resyncs the shared Base Pressure to the room so
  // late joiners land on the current value instead of the default.
  const bpRef = useRef(bp);
  bpRef.current = bp;
  const unitNotesRef = useRef(unitNotes);
  unitNotesRef.current = unitNotes;
  const prevPeerCount = useRef(0);
  useEffect(() => {
    const grew = peers.length > prevPeerCount.current;
    prevPeerCount.current = peers.length;
    if (grew && liveRef.current.role === "host" && liveRef.current.status === "connected") {
      sessionRef.current?.publish({ t: "bp", value: bpRef.current });
      sessionRef.current?.publish({ t: "unit-note", op: "sync", notes: unitNotesRef.current });
      if (nextSessionRef.current) sessionRef.current?.publish({ t: "room-info", nextSession: nextSessionRef.current });
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
    unitNotes,
    upsertUnitNote,
    deleteUnitNote,
    syncUnitNotes,
    locked,
    setLocked,
    nextSession,
    setNextSession,
  };
  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}
