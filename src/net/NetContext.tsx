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
import { getTableLink, saveTableLink, type TableLink } from "./activeTable";
import { clampShrives } from "../game/money";
import { parseInventory, type InvItem } from "../game/tableInventory";
import type { NetMessage, NetMessageType, NetRollMode, Peer, RollModeDecisionMessage, RollModeRequestMessage } from "./protocol";
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
  /** Players require Curator approval before advantage/disadvantage dice exist. */
  authorizeRollMode(mode: Exclude<NetRollMode, "normal">, label: string, actorName?: string): Promise<boolean>;
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
  /** The table this client is linked to — the Curator's campaign, and which of
   *  my characters is in use here. Null until a host announces one. */
  table: TableLink | null;
  /** Everyone's personal purse (Shrives), by peer id — so the Curator can see
   *  what the party is carrying. Includes my own entry. */
  purses: Record<string, { shrives: number; charName?: string }>;
  /** The shared party purse, in Shrives. */
  unitPurse: number;
  /** Set MY purse: persists locally and announces it to the room. */
  setMyPurse(shrives: number, charName?: string): void;
  /** Set the shared party purse. */
  setUnitPurse(shrives: number): void;
  /** Curator only: hand money to a player (or take it back with a negative). */
  grantPurse(peerId: string, delta: number): void;
  /** Everyone's personal carried items, by peer id — the Curator can look. */
  invs: Record<string, { items: InvItem[]; charName?: string }>;
  /** The shared party stash. */
  unitInv: InvItem[];
  setMyInv(items: InvItem[], charName?: string): void;
  setUnitInv(items: InvItem[]): void;
  /** Host only: tell the room which campaign this table is. */
  announceCampaign(id: string, name: string): void;
  /** The scene the Curator currently has up, for the players' Table view. */
  sceneName: string;
  /** Host only: tell the room which scene is up. */
  announceScene(name: string): void;
  /** Set the character I am playing at this table. */
  setInUseCharacter(charId: string | null): void;
  /** The dialogue box currently on every screen at the table (null = none). */
  dialogue: { speaker?: string; portrait?: string; text?: string; kind?: "speech" | "beacon" } | null;
  /** Host only: put a line on the table, or pass null to clear it. */
  setDialogue(d: { speaker?: string; portrait?: string; text?: string; kind?: "speech" | "beacon" } | null): void;
}

const Ctx = createContext<NetApi | null>(null);
export function useNet(): NetApi {
  const c = useContext(Ctx);
  if (!c) throw new Error("useNet must be used inside <NetProvider>");
  return c;
}

// Wire event types re-dispatched to React subscribers.
const FANOUT: NetMessageType[] = [
  "roll", "roll-request", "roll-result", "roll-mode-request", "roll-mode-decision", "chat", "party", "presence",
  "sheet-patch", "sheet-request", "vtt-patch", "snapshot", "vtt-snapshot-request", "vtt-snapshot-error",
  "vtt-move-request", "vtt-move-commit", "vtt-move-reject",
  "bp", "unit-note", "purse", "inv", "dialogue", "sfx", "room-locked",
  "room-info", "vtt-ping", "play-mode", "cine",
  "atlas", "atlas-request", "atlas-focus",
];

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
  const [table, setTable] = useState<TableLink | null>(null);
  const campaignRef = useRef<{ id: string; name: string } | null>(null);
  const [sceneName, setSceneName] = useState("");
  const [dialogue, setDialogueState] = useState<{ speaker?: string; portrait?: string; text?: string; kind?: "speech" | "beacon" } | null>(null);
  const sceneRef = useRef(sceneName);
  sceneRef.current = sceneName;
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
    if (roleRef.current === "host")
      sessionRef.current?.publish({ t: "room-info", nextSession: v, campaignId: campaignRef.current?.id, campaignName: campaignRef.current?.name, sceneName: sceneRef.current });
  }, []);
  // ── Money ──────────────────────────────────────────────────────────────────
  // Personal purses are announced by their owner and collected by everyone, so
  // the Curator can see what the party carries. The shared Unit purse is a single
  // value anyone may change. Persistence stays local (activeTable), because the
  // purse belongs to the player's device; the wire only carries the current value.
  const [purses, setPurses] = useState<Record<string, { shrives: number; charName?: string }>>({});
  const [unitPurse, setUnitPurseState] = useState(0);
  const tableRef = useRef<TableLink | null>(table);
  tableRef.current = table;

  const setMyPurse = useCallback((shrives: number, charName?: string) => {
    const v = clampShrives(shrives);
    const room = roomRef.current;
    if (room) setTable(saveTableLink({ room, purse: v }));
    setPurses((cur) => ({ ...cur, [selfId]: { shrives: v, charName: charName ?? cur[selfId]?.charName } }));
    sessionRef.current?.publish({ t: "purse", op: "mine", shrives: v, charName });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selfId]);

  const setUnitPurse = useCallback((shrives: number) => {
    const v = clampShrives(shrives);
    setUnitPurseState(v);
    sessionRef.current?.publish({ t: "purse", op: "unit", shrives: v });
  }, []);

  const grantPurse = useCallback((peerId: string, delta: number) => {
    if (roleRef.current !== "host" || !peerId) return;
    sessionRef.current?.publish({ t: "purse", op: "grant", peerId, shrives: Math.round(delta) || 0 });
  }, []);

  useEffect(() => {
    return subscribe("purse", (raw, from) => {
      const m = raw as Extract<NetMessage, { t: "purse" }>;
      if (m.op === "mine") {
        setPurses((cur) => ({ ...cur, [from]: { shrives: clampShrives(m.shrives ?? 0), charName: m.charName } }));
        return;
      }
      if (m.op === "unit") {
        setUnitPurseState(clampShrives(m.shrives ?? 0));
        return;
      }
      if (m.op === "request") {
        // A late joiner (or the Curator) asked; re-announce what I hold.
        const mine = tableRef.current?.purse ?? 0;
        sessionRef.current?.publish({ t: "purse", op: "mine", shrives: mine });
        return;
      }
      if (m.op === "grant" && m.peerId === selfId) {
        // The Curator paid me. Apply it to MY purse and announce the new total,
        // so the grant round-trips instead of the Curator guessing at my balance.
        const room = roomRef.current;
        const next = clampShrives((tableRef.current?.purse ?? 0) + (m.shrives ?? 0));
        if (room) setTable(saveTableLink({ room, purse: next }));
        setPurses((cur) => ({ ...cur, [selfId]: { shrives: next, charName: cur[selfId]?.charName } }));
        sessionRef.current?.publish({ t: "purse", op: "mine", shrives: next });
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selfId]);

  const [invs, setInvs] = useState<Record<string, { items: InvItem[]; charName?: string }>>({});
  const [unitInv, setUnitInvState] = useState<InvItem[]>([]);

  const setMyInv = useCallback((items: InvItem[], charName?: string) => {
    const clean = parseInventory(items);
    const room = roomRef.current;
    if (room) setTable(saveTableLink({ room, inventory: clean }));
    setInvs((cur) => ({ ...cur, [selfId]: { items: clean, charName: charName ?? cur[selfId]?.charName } }));
    sessionRef.current?.publish({ t: "inv", op: "mine", items: clean, charName });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selfId]);

  const setUnitInv = useCallback((items: InvItem[]) => {
    const clean = parseInventory(items);
    setUnitInvState(clean);
    sessionRef.current?.publish({ t: "inv", op: "unit", items: clean });
  }, []);

  useEffect(() => {
    return subscribe("inv", (raw, from) => {
      const m = raw as Extract<NetMessage, { t: "inv" }>;
      if (m.op === "mine") setInvs((cur) => ({ ...cur, [from]: { items: parseInventory(m.items), charName: m.charName } }));
      else if (m.op === "unit") setUnitInvState(parseInventory(m.items));
      else if (m.op === "request") sessionRef.current?.publish({ t: "inv", op: "mine", items: tableRef.current?.inventory ?? [] });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Host: name this table's campaign, and tell the room. Also stored locally so
   *  the Curator's own Player-view reads the same link everyone else sees. */
  const announceCampaign = useCallback((id: string, name: string) => {
    if (!id) return;
    campaignRef.current = { id, name };
    if (roomRef.current) setTable(saveTableLink({ room: roomRef.current, campaignId: id, campaignName: name }));
    if (roleRef.current === "host") {
      sessionRef.current?.publish({ t: "room-info", nextSession: nextSessionRef.current, campaignId: id, campaignName: name, sceneName: sceneRef.current });
    }
  }, []);

  /** Host: put a dialogue line on every screen, or clear it with null. Local state
   *  updates too, so the Curator sees exactly what the table sees. */
  const setDialogue = useCallback((d: { speaker?: string; portrait?: string; text?: string; kind?: "speech" | "beacon" } | null) => {
    setDialogueState(d);
    sessionRef.current?.publish({ t: "dialogue", on: !!d, speaker: d?.speaker, portrait: d?.portrait, text: d?.text, kind: d?.kind });
  }, []);

  useEffect(() => {
    return subscribe("dialogue", (raw) => {
      const m = raw as Extract<NetMessage, { t: "dialogue" }>;
      setDialogueState(m.on ? { speaker: m.speaker, portrait: m.portrait, text: m.text, kind: m.kind } : null);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Host: the scene now on the table. Players see it on their Table tab without
   *  needing the VTT open. */
  const announceScene = useCallback((name: string) => {
    setSceneName(name);
    if (roleRef.current !== "host") return;
    sessionRef.current?.publish({
      t: "room-info",
      nextSession: nextSessionRef.current,
      campaignId: campaignRef.current?.id,
      campaignName: campaignRef.current?.name,
      sceneName: name,
    });
  }, []);

  /** Which of MY characters I am playing at this table. Local only — the Curator
   *  learns it from the party summary the sheet already publishes. */
  const setInUseCharacter = useCallback((charId: string | null) => {
    if (!roomRef.current) return;
    setTable(saveTableLink({ room: roomRef.current, inUseCharacterId: charId ?? "" }));
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
      // The Curator named their campaign — point this client at it and remember
      // the link, so rejoining restores the character I was playing.
      if (info.sceneName !== undefined) setSceneName(info.sceneName);
      if (roomRef.current && info.campaignId) {
        setTable(saveTableLink({ room: roomRef.current, campaignId: info.campaignId, campaignName: info.campaignName ?? "" }));
      }
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

  const modeApprovals = useRef(new Map<string, (accepted: boolean) => void>());
  useEffect(() => subscribe("roll-mode-decision", (raw, from) => {
    if (role !== "player") return;
    const hostId = peers.find((peer) => peer.role === "host")?.id;
    if (!hostId || from !== hostId) return;
    const decision = raw as RollModeDecisionMessage;
    const resolve = modeApprovals.current.get(decision.requestId);
    if (!resolve) return;
    modeApprovals.current.delete(decision.requestId);
    resolve(decision.accepted === true);
  }), [peers, role, subscribe]);

  useEffect(() => subscribe("roll-mode-request", (raw, from) => {
    if (role !== "host") return;
    const peer = peers.find((candidate) => candidate.id === from && candidate.role === "player");
    if (!peer) return;
    const request = raw as RollModeRequestMessage;
    if (
      typeof request.requestId !== "string" || !request.requestId || request.requestId.length > 128 ||
      typeof request.label !== "string" || !request.label || request.label.length > 160 ||
      !["adv", "dis", "double-adv", "double-dis"].includes(request.mode)
    ) return;
    const posture = request.mode.startsWith("double-")
      ? `Double ${request.mode.endsWith("adv") ? "Advantage" : "Disadvantage"}`
      : request.mode === "adv" ? "Advantage" : "Disadvantage";
    const accepted = window.confirm(`${request.actorName || peer.name} wants to roll ${request.label} with ${posture}. Accept?`);
    publish({ t: "roll-mode-decision", requestId: request.requestId, accepted }, from);
  }), [peers, publish, role, subscribe]);

  const authorizeRollMode = useCallback((mode: Exclude<NetRollMode, "normal">, label: string, actorName?: string): Promise<boolean> => {
    if (status !== "connected" || role === "host") return Promise.resolve(true);
    const hostId = peers.find((peer) => peer.role === "host")?.id;
    if (!hostId) return Promise.resolve(false);
    const requestId = `rm-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    return new Promise<boolean>((resolve) => {
      modeApprovals.current.set(requestId, resolve);
      publish({ t: "roll-mode-request", requestId, mode, label, actorName }, hostId);
      window.setTimeout(() => {
        const pending = modeApprovals.current.get(requestId);
        if (!pending) return;
        modeApprovals.current.delete(requestId);
        pending(false);
      }, 60_000);
    });
  }, [peers, publish, role, status]);

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
      // Save the code BEFORE dialling. A Curator who hosts and fails to connect
      // (signaling down, bad URL, closed the app) used to lose the code entirely,
      // because this only ran after a successful start.
      upsertSavedRoom({ code: c, role: asRole });
      let session: NetSession | null = null;
      try {
        const name = myPeerName();
        const iceServers = await buildIceServers(cfg);
        const transport = new WebRtcTransport({ signalUrl: cfg.signalUrl.trim(), room: c, peerId: selfId, role: asRole, name, iceServers });
        session = new NetSession(transport, { name, role: asRole });
        // Install the in-flight session before awaiting transport/signaling so
        // Leave (or a second connect) can actually cancel it.
        sessionRef.current?.close();
        sessionRef.current = session;
        session.onPeers(setPeers);
        for (const t of FANOUT) session.on(t, (m, from) => emit(t, m, from));
        session.onFatal((fatal) => {
          if (sessionRef.current !== session) return;
          sessionRef.current = null;
          void unadvertise().catch(() => {});
          setStatus("idle");
          setPeers([]);
          setRoom("");
          setLockedState(false);
          setNextSessionState("");
          setTable(null);
          setSceneName("");
          setDialogueState(null);
          setPurses({});
          setUnitPurseState(0);
          setInvs({});
          setUnitInvState([]);
          setError(fatal.message);
        });
        // Bound the whole path: signaling admission, ICE/data-channel setup,
        // and the application welcome. A dead TURN route must not leave the UI
        // saying "Connecting" forever.
        let handshakeTimer: number | undefined;
        try {
          await Promise.race([
            (async () => {
              await session!.start();
              await session!.whenReady();
            })(),
            new Promise<void>((_resolve, reject) => {
              handshakeTimer = window.setTimeout(
                () => reject(new Error("The table connection timed out before the Curator handshake completed.")),
                20_000
              );
            }),
          ]);
        } finally {
          window.clearTimeout(handshakeTimer);
        }
        if (sessionRef.current !== session) return;
        setRoom(c);
        setStatus("connected");
        // Touch it again so a room that actually connected sorts above one that
        // only got as far as being dialled, and restore its table info.
        upsertSavedRoom({ code: c, role: asRole });
        const saved = listSavedRooms().find((r) => r.code === c);
        setNextSessionState(saved?.nextSession ?? "");
        const link = getTableLink(c);
        setTable(link);
        // Seed my own entry, then ask everyone to announce theirs so a late joiner
        // and the Curator both end up with a full picture.
        setPurses({ [selfId]: { shrives: link?.purse ?? 0 } });
        setUnitPurseState(0);
        session.publish({ t: "purse", op: "mine", shrives: link?.purse ?? 0 });
        session.publish({ t: "purse", op: "request" });
        setInvs({ [selfId]: { items: link?.inventory ?? [] } });
        setUnitInvState([]);
        session.publish({ t: "inv", op: "mine", items: link?.inventory ?? [] });
        session.publish({ t: "inv", op: "request" });
        setLockedState(false);
        if (asRole === "host") await advertise(c).catch(() => {});
      } catch (e) {
        if (sessionRef.current === session) {
          session?.close();
          sessionRef.current = null;
          setStatus("idle");
          setError(e instanceof Error ? e.message : "Connection failed.");
        }
      }
    },
    [selfId]
  );

  const leave = useCallback(() => {
    modeApprovals.current.forEach((resolve) => resolve(false));
    modeApprovals.current.clear();
    sessionRef.current?.close();
    sessionRef.current = null;
    void unadvertise().catch(() => {});
    setStatus("idle");
    setPeers([]);
    setRoom("");
    setLockedState(false);
    setNextSessionState("");
    setTable(null);
    setSceneName("");
    setDialogueState(null);
    setPurses({});
    setUnitPurseState(0);
    setInvs({});
    setUnitInvState([]);
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
      sessionRef.current?.publish({ t: "purse", op: "request" });
      sessionRef.current?.publish({ t: "inv", op: "request" });
      if (nextSessionRef.current || campaignRef.current)
        sessionRef.current?.publish({ t: "room-info", nextSession: nextSessionRef.current, campaignId: campaignRef.current?.id, campaignName: campaignRef.current?.name, sceneName: sceneRef.current });
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
    authorizeRollMode,
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
    table,
    announceCampaign,
    sceneName,
    announceScene,
    dialogue,
    setDialogue,
    setInUseCharacter,
    purses,
    unitPurse,
    setMyPurse,
    setUnitPurse,
    grantPurse,
    invs,
    unitInv,
    setMyInv,
    setUnitInv,
  };
  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}
