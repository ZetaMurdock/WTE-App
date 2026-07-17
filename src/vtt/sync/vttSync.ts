// VTT v2 (slice 10): P2P scene sync over the NetProvider session (useNet — VTT2
// is a React child of <NetProvider>, same session the lobby/legacy VTT ride).
// Entity edits ride small `vtt-patch` ops; scene changes + late joiners ride a
// full `snapshot`. Remote ops apply via engine.applyRemote (which never re-emits),
// so there are no echo loops.
import { useCallback, useEffect, useRef, type MutableRefObject } from "react";
import { useNet } from "../../net/NetContext";
import type { NetMessage } from "../../net/protocol";
import type { PixiVttApp } from "../engine/PixiVttApp";
import type { VttScene } from "../types/scene";
import type { VttOp } from "./patches";

type PatchMsg = Extract<NetMessage, { t: "vtt-patch" }>;
type SnapMsg = Extract<NetMessage, { t: "snapshot" }>;

interface Opts {
  engineRef: MutableRefObject<PixiVttApp | null>;
  /** The live scene id, for op scoping. */
  sceneId: string | null;
  /** Returns the current full scene to snapshot to peers. */
  getScene: () => VttScene | null;
  /** Adopt a full scene pushed by a peer (host switch / late-join catch-up). */
  onSnapshot: (scene: VttScene) => void;
}

export interface VttSyncApi {
  connected: boolean;
  peerCount: number;
  /** Broadcast a local op (used to wire engine.onOp). */
  broadcastOp: (op: VttOp) => void;
  /** Broadcast the current scene as a snapshot (all peers, or one target). */
  broadcastSnapshot: (to?: string) => void;
}

export function useVttSync({ engineRef, sceneId, getScene, onSnapshot }: Opts): VttSyncApi {
  const net = useNet();
  const rev = useRef(0);
  const sceneIdRef = useRef(sceneId);
  sceneIdRef.current = sceneId;
  const getSceneRef = useRef(getScene);
  getSceneRef.current = getScene;
  const onSnapRef = useRef(onSnapshot);
  onSnapRef.current = onSnapshot;
  const statusRef = useRef(net.status);
  statusRef.current = net.status;

  const broadcastOp = useCallback(
    (op: VttOp) => {
      if (statusRef.current !== "connected") return;
      net.publish({ t: "vtt-patch", scope: sceneIdRef.current ?? "", patch: op, rev: ++rev.current });
    },
    [net]
  );

  const broadcastSnapshot = useCallback(
    (to?: string) => {
      if (statusRef.current !== "connected") return;
      const scene = getSceneRef.current();
      if (scene) net.publish({ t: "snapshot", state: scene, rev: ++rev.current }, to);
    },
    [net]
  );

  // Latest peers/role for authorization checks without resubscribing per change.
  const peersRef = useRef(net.peers);
  peersRef.current = net.peers;
  const roleRef = useRef(net.role);
  roleRef.current = net.role;

  // Receive: apply remote ops (same scene only) and adopt remote snapshots.
  useEffect(() => {
    const offPatch = net.subscribe("vtt-patch", (m, from) => {
      const pm = m as PatchMsg;
      const op = pm.patch as VttOp;
      if (!op || typeof op.op !== "string" || op.op === "scene.switch") return; // scene changes come via snapshot
      if (pm.scope && pm.scope !== sceneIdRef.current) return; // op is for a different scene
      // OWNED-token authorization: when a token declares an owner, only that
      // owner (or the host/Curator, or ourselves) may move/update/remove it.
      // Unowned tokens stay free-for-all, preserving table norms for NPC props.
      if (op.op === "token.move" || op.op === "token.update" || op.op === "token.remove") {
        const tok = engineRef.current?.scene?.data.tokens.find((t) => t.id === op.id);
        const hostId = roleRef.current === "host" ? net.selfId : peersRef.current.find((p) => p.role === "host")?.id ?? null;
        const fromIsHost = hostId != null && from === hostId;
        if (tok?.owner && tok.owner !== from && from !== net.selfId && !fromIsHost) return; // unauthorized — drop the op
        // COLLISION defense-in-depth: a player's move whose path crosses a wall is
        // dropped here too (their client already reverts; this stops wall-hacks).
        if (op.op === "token.move" && tok && !fromIsHost && from !== net.selfId) {
          if (engineRef.current?.moveBlocked(tok.x, tok.y, op.x, op.y)) return;
        }
      }
      // Spatial-sound emitters are Curator scene-building: host-only, like walls.
      if (op.op === "emitter.add" || op.op === "emitter.update" || op.op === "emitter.remove") {
        const hostId = roleRef.current === "host" ? net.selfId : peersRef.current.find((p) => p.role === "host")?.id ?? null;
        if (!((hostId != null && from === hostId) || from === net.selfId)) return;
      }
      // Drawing rules: only the host flips the switch or wipes the board, and a
      // player's stroke is dropped while the Curator has drawing disabled.
      if (op.op === "draw.allow" || op.op === "draw.clear" || op.op === "draw.add") {
        const hostId = roleRef.current === "host" ? net.selfId : peersRef.current.find((p) => p.role === "host")?.id ?? null;
        const fromIsHost = (hostId != null && from === hostId) || from === net.selfId;
        if ((op.op === "draw.allow" || op.op === "draw.clear") && !fromIsHost) return;
        if (op.op === "draw.add" && !fromIsHost && engineRef.current?.scene?.data.allowPlayerDraw === false) return;
      }
      engineRef.current?.applyRemote(op);
    });
    const offSnap = net.subscribe("snapshot", (m, from) => {
      // Never adopt our own snapshot: if a transport ever loops broadcasts back,
      // a stale echo could revert the host's just-switched scene.
      if (from === net.selfId) return;
      const scene = (m as SnapMsg).state as VttScene;
      if (scene && scene.id && scene.data) onSnapRef.current(scene);
    });
    return () => {
      offPatch();
      offSnap();
    };
  }, [net.subscribe, engineRef]);

  // Late joiner: the host pushes a snapshot to each newly-seen peer.
  const knownPeers = useRef<Set<string>>(new Set());
  useEffect(() => {
    const ids = net.peers.map((p) => p.id);
    const fresh = ids.filter((id) => !knownPeers.current.has(id));
    knownPeers.current = new Set(ids);
    if (net.status === "connected" && net.role === "host") {
      for (const id of fresh) broadcastSnapshot(id);
    }
  }, [net.peers, net.role, net.status, broadcastSnapshot]);

  return { connected: net.status === "connected", peerCount: net.peers.length, broadcastOp, broadcastSnapshot };
}
