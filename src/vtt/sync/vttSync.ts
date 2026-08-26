// VTT v2 (slice 10): P2P scene sync over the NetProvider session (useNet — VTT2
// is a React child of <NetProvider>, same session the lobby/legacy VTT ride).
// Entity edits ride small `vtt-patch` ops; scene changes + late joiners ride a
// full `snapshot`. Remote ops apply via engine.applyRemote (which never re-emits),
// so there are no echo loops.
import { useCallback, useEffect, useRef, type MutableRefObject } from "react";
import { useNet } from "../../net/NetContext";
import type { NetMessage, VttMoveRequestMessage, VttMoveRejectMessage } from "../../net/protocol";
import type { PixiVttApp } from "../engine/PixiVttApp";
import type { VttScene } from "../types/scene";
import { foreignOpAllowed, isVttOp, type VttOp } from "./patches";
import { canAcceptSnapshot } from "./tokenPermissions";
import { validateMoveAuthority } from "./moveAuthority";
import { pushToast } from "../../lib/appToast";
import { MAX_VTT_SNAPSHOT_CHARS, vttSnapshotChars, vttSnapshotFits } from "./wireBudget";
import { MAX_CONDITION_CLOCKS } from "../engine/systems/ConditionClockSystem";
import { MAX_SCENE_COUNTER_TRACKS } from "../data/tokenCounters";
import { MAX_COUNTER_NAME, MAX_COUNTER_VALUE } from "../../game/counterTracks";

type PatchMsg = Extract<NetMessage, { t: "vtt-patch" }>;
type SnapMsg = Extract<NetMessage, { t: "snapshot" }>;
type MoveCommitMsg = Extract<NetMessage, { t: "vtt-move-commit" }>;

export interface ForeignMoveDecision {
  ok: boolean;
  x: number;
  y: number;
  reason?: VttMoveRejectMessage["reason"];
}

const isRecord = (value: unknown): value is Record<string, unknown> => value != null && typeof value === "object" && !Array.isArray(value);
const finiteNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const shortId = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 256;
const boundedArray = (value: unknown, max: number): value is unknown[] => Array.isArray(value) && value.length <= max;
const boundedString = (value: unknown, max: number): value is string => typeof value === "string" && value.length <= max;
const rendererCoordinate = (value: unknown): value is number => finiteNumber(value) && Math.abs(value) <= 10_000_000;
const linkEdges = new Set(["north", "south", "east", "west"]);

const validSnapshotEmitter = (value: unknown): boolean =>
  isRecord(value) && shortId(value.id) && rendererCoordinate(value.x) && rendererCoordinate(value.y) &&
  finiteNumber(value.radius) && value.radius >= 0 && value.radius <= 100_000 &&
  boundedString(value.name, 512) && boundedString(value.src, 8 * 1024 * 1024) &&
  finiteNumber(value.volume) && value.volume >= 0 && value.volume <= 1 && typeof value.loop === "boolean" &&
  (value.fx === undefined || boundedString(value.fx, 128)) &&
  (value.fxMax === undefined || (finiteNumber(value.fxMax) && value.fxMax >= 0 && value.fxMax <= 1));

const validSnapshotLink = (value: unknown): boolean =>
  isRecord(value) && shortId(value.id) && shortId(value.targetSceneId) && linkEdges.has(value.edge as string);

const validSnapshotDrawing = (value: unknown): boolean => {
  if (!isRecord(value) || !shortId(value.id) || !boundedArray(value.points, 4096)) return false;
  return value.points.length >= 4 && value.points.length % 2 === 0 && value.points.every(rendererCoordinate) &&
    boundedString(value.color, 32) && finiteNumber(value.width) && value.width >= 0.25 && value.width <= 100;
};

/** Condition clocks are a peer-supplied countdown against a peer-supplied tag.
 *  A bornRound of NaN or a negative duration would make `bornRound + rounds`
 *  meaningless and the clock either immortal or already expired, so a malformed
 *  entry costs the whole snapshot rather than poisoning the scene it lands in.
 *  `status` shares the 80-char ceiling the token status sanitizer enforces —
 *  a clock can only ever match a tag a token is allowed to carry. */
const validSnapshotConditionClock = (value: unknown): boolean =>
  isRecord(value) && shortId(value.tokenId) && boundedString(value.status, 80) && (value.status as string).length > 0 &&
  Number.isSafeInteger(value.bornRound) && Number(value.bornRound) >= 0 &&
  Number.isSafeInteger(value.rounds) && Number(value.rounds) >= 1 && Number(value.rounds) <= 100_000 &&
  (value.potency === undefined || finiteNumber(value.potency));

/** A track is a name and a positive integer against a body. Zero is rejected
 *  rather than tolerated: a zeroed track is DROPPED by the applier, so a peer
 *  sending one is either malformed or trying to plant a pip that never comes
 *  off. */
const validSnapshotCounterTrack = (value: unknown): boolean =>
  isRecord(value) && shortId(value.tokenId) &&
  boundedString(value.name, MAX_COUNTER_NAME) && (value.name as string).trim().length > 0 &&
  Number.isSafeInteger(value.value) && Number(value.value) > 0 && Number(value.value) <= MAX_COUNTER_VALUE &&
  (value.cap === undefined ||
    (Number.isSafeInteger(value.cap) && Number(value.cap) >= 0 && Number(value.cap) <= MAX_COUNTER_VALUE));

/** Reject malformed snapshots before they reach persistence or the renderer. */
export function isVttSceneSnapshot(value: unknown): value is VttScene {
  if (!isRecord(value) || !shortId(value.id) || !shortId(value.campaignId) || typeof value.name !== "string" || value.name.length > 512) return false;
  if (!isRecord(value.data)) return false;
  const data = value.data;
  const grid = data.grid;
  if (
    !isRecord(grid) || grid.type !== "square" || !finiteNumber(grid.size) || grid.size <= 0 || grid.size > 10_000 ||
    !Number.isSafeInteger(grid.cols) || !Number.isSafeInteger(grid.rows) || Number(grid.cols) <= 0 || Number(grid.rows) <= 0 ||
    Number(grid.cols) > 10_000 || Number(grid.rows) > 10_000 || Number(grid.cols) * Number(grid.rows) > 4_000_000 ||
    typeof grid.color !== "string" || typeof grid.visible !== "boolean"
  ) return false;
  if (!isRecord(data.camera) || !finiteNumber(data.camera.x) || !finiteNumber(data.camera.y) || !finiteNumber(data.camera.zoom) || data.camera.zoom <= 0) return false;
  if (!isRecord(data.background) || !isRecord(data.layers) || !isRecord(data.timeline)) return false;
  if (!isRecord(data.fog) || typeof data.fog.enabled !== "boolean" || !boundedArray(data.fog.revealed, Number(grid.cols) * Number(grid.rows))) return false;
  if (!data.fog.revealed.every((cell) => typeof cell === "string" && cell.length <= 64)) return false;
  if (!boundedArray(data.tokens, 10_000) || !data.tokens.every((entry) =>
    isRecord(entry) && shortId(entry.id) && typeof entry.name === "string" && entry.name.length <= 512 &&
    finiteNumber(entry.x) && finiteNumber(entry.y) && finiteNumber(entry.size) && entry.size > 0 && entry.size <= 100 &&
    typeof entry.color === "string" && typeof entry.visible === "boolean"
  )) return false;
  if (!boundedArray(data.walls, 50_000) || !data.walls.every((entry) =>
    isRecord(entry) && shortId(entry.id) && finiteNumber(entry.x1) && finiteNumber(entry.y1) &&
    finiteNumber(entry.x2) && finiteNumber(entry.y2) && typeof entry.blocksLight === "boolean"
  )) return false;
  if (!boundedArray(data.lights, 10_000) || !data.lights.every((entry) =>
    isRecord(entry) && shortId(entry.id) && finiteNumber(entry.x) && finiteNumber(entry.y) &&
    finiteNumber(entry.radius) && entry.radius >= 0 && finiteNumber(entry.intensity) && typeof entry.color === "string"
  )) return false;
  if (!boundedArray(data.effects, 10_000) || !data.effects.every((entry) =>
    isRecord(entry) && shortId(entry.id) && typeof entry.kind === "string" &&
    finiteNumber(entry.x) && finiteNumber(entry.y) && isRecord(entry.data)
  )) return false;
  if (data.emitters !== undefined && (!boundedArray(data.emitters, 2_000) || !data.emitters.every(validSnapshotEmitter))) return false;
  if (data.links !== undefined && (!boundedArray(data.links, 10_000) || !data.links.every(validSnapshotLink))) return false;
  if (data.drawings !== undefined && (!boundedArray(data.drawings, 500) || !data.drawings.every(validSnapshotDrawing))) return false;
  if (data.conditionClocks !== undefined && (!boundedArray(data.conditionClocks, MAX_CONDITION_CLOCKS) || !data.conditionClocks.every(validSnapshotConditionClock))) return false;
  if (data.counterTracks !== undefined && (!boundedArray(data.counterTracks, MAX_SCENE_COUNTER_TRACKS) || !data.counterTracks.every(validSnapshotCounterTrack))) return false;
  if (data.terrain !== undefined && data.terrain !== null) {
    if (!isRecord(data.terrain) || !boundedArray(data.terrain.heights, Number(grid.cols) * Number(grid.rows))) return false;
    if (!data.terrain.heights.every(finiteNumber) || !finiteNumber(data.terrain.maxCells)) return false;
  }
  return true;
}

interface Opts {
  engineRef: MutableRefObject<PixiVttApp | null>;
  /** Campaign currently selected/announced for this table. */
  expectedCampaignId?: string | null;
  /** The live scene id, for op scoping. */
  sceneId: string | null;
  /** Returns the current full scene to snapshot to peers. */
  getScene: () => VttScene | null;
  /** Adopt a full scene pushed by a peer (host switch / late-join catch-up). */
  onSnapshot: (scene: VttScene) => void;
  /** HOST + scene pinning: an op for a scene we are NOT currently viewing
   *  (players still playing on the pinned scene while the Curator roams).
   *  The handler applies it to the stored scene so nothing is lost. */
  onForeignOp?: (sceneId: string, op: VttOp, from: string) => boolean | Promise<boolean>;
  /** The scene to hand a late joiner (the players' PINNED scene when the
   *  Curator is off browsing another one). Null/undefined = current scene. */
  getLateJoinScene?: () => Promise<VttScene | null>;
  /** Host scene-pinning path: validate/apply a request against a stored scene. */
  onForeignMoveRequest?: (request: VttMoveRequestMessage, from: string) => Promise<ForeignMoveDecision>;
}

export interface VttSyncApi {
  connected: boolean;
  peerCount: number;
  /** Broadcast a local op (used to wire engine.onOp). */
  broadcastOp: (op: VttOp) => void;
  /** Broadcast the current scene as a snapshot (all peers, or one target). */
  broadcastSnapshot: (to?: string) => void;
  /** Preview has already ended; request an authoritative snapped destination. */
  requestMove: (id: string, fromX: number, fromY: number, toX: number, toY: number) => void;
}

export function useVttSync({ engineRef, expectedCampaignId, sceneId, getScene, onSnapshot, onForeignOp, getLateJoinScene, onForeignMoveRequest }: Opts): VttSyncApi {
  const net = useNet();
  const rev = useRef(0);
  const sceneIdRef = useRef(sceneId);
  sceneIdRef.current = sceneId;
  const expectedCampaignRef = useRef(expectedCampaignId ?? null);
  expectedCampaignRef.current = expectedCampaignId ?? null;
  const getSceneRef = useRef(getScene);
  getSceneRef.current = getScene;
  const onSnapRef = useRef(onSnapshot);
  onSnapRef.current = onSnapshot;
  const onForeignRef = useRef(onForeignOp);
  onForeignRef.current = onForeignOp;
  const lateJoinRef = useRef(getLateJoinScene);
  lateJoinRef.current = getLateJoinScene;
  const foreignMoveRef = useRef(onForeignMoveRequest);
  foreignMoveRef.current = onForeignMoveRequest;
  const statusRef = useRef(net.status);
  statusRef.current = net.status;
  const peersRef = useRef(net.peers);
  peersRef.current = net.peers;
  const roleRef = useRef(net.role);
  roleRef.current = net.role;
  const seenRevs = useRef(new Map<string, number>());
  const sessionEpoch = useRef(0);
  const patchQueue = useRef<Promise<void>>(Promise.resolve());
  const snapshotRequestAt = useRef(new Map<string, number>());
  const pendingSnapshotPeers = useRef(new Map<string, string | null>());
  const snapshotInFlight = useRef(new Set<string>());
  const adoptedSnapshotFor = useRef("");
  const snapshotErrorShownFor = useRef("");
  const pendingMoves = useRef(new Map<string, {
    scope: string;
    tokenId: string;
    fromX: number;
    fromY: number;
    toX: number;
    toY: number;
    createdAt: number;
  }>());
  useEffect(() => {
    sessionEpoch.current += 1;
    seenRevs.current.clear();
    pendingSnapshotPeers.current.clear();
    snapshotInFlight.current.clear();
    snapshotRequestAt.current.clear();
    pendingMoves.current.clear();
    adoptedSnapshotFor.current = "";
    snapshotErrorShownFor.current = "";
  }, [expectedCampaignId, net.room, net.status]);
  useEffect(() => {
    const live = new Set(net.peers.map((peer) => peer.id));
    for (const key of seenRevs.current.keys()) {
      const sender = key.slice(0, key.indexOf(":"));
      if (sender && sender !== net.selfId && !live.has(sender)) seenRevs.current.delete(key);
    }
  }, [net.peers, net.selfId]);

  const hostId = (): string | null =>
    roleRef.current === "host" ? net.selfId : peersRef.current.find((peer) => peer.role === "host")?.id ?? null;

  const revisionIsFresh = (from: string, scope: string, value: number): boolean => {
    if (!Number.isSafeInteger(value) || value < 0) return false;
    const key = `${from}:${scope}`;
    const seen = seenRevs.current.get(key) ?? -1;
    return value > seen;
  };

  const acceptRevision = (from: string, scope: string, value: number): void => {
    seenRevs.current.set(`${from}:${scope}`, value);
  };

  // A peer may reconnect with the same durable id and a fresh revision counter.
  // Forget its old watermark as soon as it leaves (and all watermarks offline).
  useEffect(() => {
    if (net.status !== "connected") {
      seenRevs.current.clear();
      return;
    }
    const active = new Set([net.selfId, ...net.peers.map((peer) => peer.id)]);
    for (const key of seenRevs.current.keys()) {
      const sender = key.slice(0, key.indexOf(":"));
      if (!active.has(sender)) seenRevs.current.delete(key);
    }
  }, [net.status, net.selfId, net.peers]);

  const broadcastOp = useCallback(
    (op: VttOp) => {
      if (statusRef.current !== "connected") return;
      if (roleRef.current === "player") {
        // Engine callbacks run after the local mutation. Stateful checks here
        // would therefore lose token.remove (the token is already absent) and
        // can misread other post-mutation intents. Keep this to a narrow shape
        // allowlist; the host validates ownership/current scene state.
        if (!["token.update", "token.remove", "light.ignite", "draw.add"].includes(op.op)) return;
        const scope = sceneIdRef.current ?? "";
        if (!scope) return;
        const targetHost = hostId();
        if (!targetHost) return;
        net.publish({ t: "vtt-patch", scope, patch: op, rev: ++rev.current }, targetHost);
        return;
      }
      net.publish({ t: "vtt-patch", scope: sceneIdRef.current ?? "", patch: op, rev: ++rev.current });
    },
    [net.publish]
  );

  const broadcastSnapshot = useCallback(
    (to?: string) => {
      if (statusRef.current !== "connected" || roleRef.current !== "host") return;
      const scene = getSceneRef.current();
      if (scene && (!expectedCampaignRef.current || scene.campaignId === expectedCampaignRef.current)) {
        const size = vttSnapshotChars(scene);
        if (size <= MAX_VTT_SNAPSHOT_CHARS) net.publish({ t: "snapshot", state: scene, rev: ++rev.current }, to);
        else net.publish({ t: "vtt-snapshot-error", reason: "too-large", size, limit: MAX_VTT_SNAPSHOT_CHARS }, to);
      }
    },
    [net.publish]
  );

  /** Resolve the correct table scene before responding. A rejected patch uses
   * its scope so an off-screen pinned scene can never be "rolled back" with the
   * Curator's unrelated browsing scene. */
  const sendBestSnapshot = useCallback(async (to: string, preferredScope: string | null = null): Promise<boolean> => {
    if (statusRef.current !== "connected" || roleRef.current !== "host") return false;
    const epoch = sessionEpoch.current;
    let scene: VttScene | null = null;
    const current = getSceneRef.current();
    if (preferredScope && current?.id === preferredScope) scene = current;
    if (!scene && lateJoinRef.current) {
      scene = await lateJoinRef.current().catch(() => null);
      if (preferredScope && scene?.id !== preferredScope) scene = null;
    }
    if (!scene && !preferredScope) scene = getSceneRef.current();
    if (sessionEpoch.current !== epoch) return false;
    if (scene && expectedCampaignRef.current && scene.campaignId !== expectedCampaignRef.current) return false;
    if (!scene || !isVttSceneSnapshot(scene)) return false;
    if (!peersRef.current.some((peer) => peer.id === to)) return false;
    if (!vttSnapshotFits(scene)) {
      net.publish({
        t: "vtt-snapshot-error",
        reason: "too-large",
        size: vttSnapshotChars(scene),
        limit: MAX_VTT_SNAPSHOT_CHARS,
      }, to);
      return true;
    }
    net.publish({ t: "snapshot", state: scene, rev: ++rev.current }, to);
    return true;
  }, [net.publish]);

  const queueSnapshot = useCallback((to: string, preferredScope: string | null = null): void => {
    const epoch = sessionEpoch.current;
    const previous = pendingSnapshotPeers.current.get(to);
    // A scoped rollback is stronger than a general late-join response.
    pendingSnapshotPeers.current.set(to, preferredScope ?? previous ?? null);
    if (snapshotInFlight.current.has(to)) return;
    snapshotInFlight.current.add(to);
    const requestedScope = pendingSnapshotPeers.current.get(to) ?? null;
    void sendBestSnapshot(to, requestedScope).then((sent) => {
      if (sessionEpoch.current !== epoch) return;
      if (sent && pendingSnapshotPeers.current.get(to) === requestedScope) pendingSnapshotPeers.current.delete(to);
    }).finally(() => {
      if (sessionEpoch.current !== epoch) return;
      snapshotInFlight.current.delete(to);
      if (pendingSnapshotPeers.current.has(to) && pendingSnapshotPeers.current.get(to) !== requestedScope) {
        queueSnapshot(to, pendingSnapshotPeers.current.get(to) ?? null);
      }
    });
  }, [sendBestSnapshot]);

  const requestMove = useCallback(
    (id: string, fromX: number, fromY: number, toX: number, toY: number) => {
      const engine = engineRef.current;
      const scope = sceneIdRef.current ?? "";
      if (!engine?.scene || engine.scene.id !== scope) return;
      const requestId = `mv-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;

      if (statusRef.current !== "connected") {
        engine.commitTokenMove(id, toX, toY, false);
        return;
      }
      if (roleRef.current === "host") {
        if (engine.commitTokenMove(id, toX, toY, false)) {
          net.publish({ t: "vtt-move-commit", requestId, scope, tokenId: id, x: toX, y: toY });
        }
        return;
      }
      const targetHost = hostId();
      if (!targetHost) {
        engine.rejectTokenMove(id, toX, toY);
        return;
      }
      const now = Date.now();
      for (const [pendingId, pending] of pendingMoves.current) {
        if (now - pending.createdAt > 30_000) pendingMoves.current.delete(pendingId);
      }
      pendingMoves.current.set(requestId, { scope, tokenId: id, fromX, fromY, toX, toY, createdAt: now });
      net.publish({ t: "vtt-move-request", requestId, scope, tokenId: id, fromX, fromY, toX, toY }, targetHost);
    },
    [engineRef, net.publish]
  );

  // Receive: apply remote ops (same scene only) and adopt remote snapshots.
  useEffect(() => {
    const offPatch = net.subscribe("vtt-patch", (m, from) => {
      const pm = m as PatchMsg;
      if (from === net.selfId || !isVttOp(pm.patch) || pm.patch.op === "scene.switch") return;
      const op = pm.patch;
      const epoch = sessionEpoch.current;
      patchQueue.current = patchQueue.current.catch(() => {}).then(async () => {
        if (sessionEpoch.current !== epoch) return;
        const scope = pm.scope || "";
        if (!scope || !revisionIsFresh(from, scope, pm.rev)) return;
        const knownHost = hostId();

        if (roleRef.current === "player") {
          // Players never form a write mesh. Only a patch re-authored by the
          // known host is authoritative, including the player's own echo.
          if (!knownHost || from !== knownHost || scope !== sceneIdRef.current) return;
          const engine = engineRef.current;
          if (!engine?.scene || engine.scene.id !== scope) return;
          engine.applyRemote(op); // false is valid for an optimistic own echo
          acceptRevision(from, scope, pm.rev);
          return;
        }

        const sender = peersRef.current.find((peer) => peer.id === from);
        if (roleRef.current !== "host" || sender?.role !== "player" || op.op === "token.move") return;

        let accepted = false;
        if (scope !== sceneIdRef.current) {
          const handle = onForeignRef.current;
          if (handle) accepted = await Promise.resolve(handle(scope, op, from)).catch(() => false);
        } else {
          const engine = engineRef.current;
          const data = engine?.scene?.id === scope ? engine.scene.data : null;
          if (engine && data && foreignOpAllowed(data, op, from)) accepted = engine.applyRemote(op);
        }

        if (sessionEpoch.current !== epoch) return;
        if (!accepted) {
          // The player already applied this edit optimistically. Return the
          // exact authoritative scene so a denied resize/customization reverts.
          queueSnapshot(from, scope);
          return;
        }
        acceptRevision(from, scope, pm.rev);
        // vtt-patch is not transport-relayed. The host re-authors only the
        // operation it accepted, giving every client one trusted source.
        net.publish({ t: "vtt-patch", scope, patch: op, rev: ++rev.current });
      });
    });
    const offSnap = net.subscribe("snapshot", (m, from) => {
      if (!canAcceptSnapshot(roleRef.current, from, hostId(), net.selfId)) return;
      const sm = m as SnapMsg;
      if (!isVttSceneSnapshot(sm.state) || !revisionIsFresh(from, sm.state.id, sm.rev)) return;
      if (expectedCampaignRef.current && sm.state.campaignId !== expectedCampaignRef.current) return;
      onSnapRef.current(sm.state);
      acceptRevision(from, sm.state.id, sm.rev);
      adoptedSnapshotFor.current = `${net.room}:${from}:${expectedCampaignRef.current ?? "*"}`;
    });
    const offSnapshotRequest = net.subscribe("vtt-snapshot-request", (_m, from) => {
      if (roleRef.current !== "host" || from === net.selfId || !peersRef.current.some((peer) => peer.id === from)) return;
      const now = Date.now();
      if (now - (snapshotRequestAt.current.get(from) ?? 0) < 1000) return;
      snapshotRequestAt.current.set(from, now);
      queueSnapshot(from);
    });
    const offSnapshotError = net.subscribe("vtt-snapshot-error", (raw, from) => {
      if (roleRef.current !== "player" || from !== hostId()) return;
      const message = raw as Extract<NetMessage, { t: "vtt-snapshot-error" }>;
      if (message.reason !== "too-large" || !Number.isFinite(message.size) || !Number.isFinite(message.limit)) return;
      const key = `${net.room}:${from}:${expectedCampaignRef.current ?? "*"}`;
      if (snapshotErrorShownFor.current === key) return;
      snapshotErrorShownFor.current = key;
      pushToast(
        `The Curator's scene is too large for netplay (${Math.ceil(message.size / 1024 / 1024)} MB). Ask them to remove or reduce a map, sound, prop, or token image.`,
        "error",
        0
      );
    });
    return () => {
      offPatch();
      offSnap();
      offSnapshotRequest();
      offSnapshotError();
    };
  }, [engineRef, net.publish, net.room, net.selfId, net.subscribe, queueSnapshot]);

  // The host's eager late-join snapshot can race a player's listener or precede
  // the host loading its scene. Retry with bounded backoff until this room has
  // actually adopted a valid host snapshot.
  useEffect(() => {
    if (net.status !== "connected" || net.role !== "player") return;
    const targetHost = hostId();
    if (!targetHost) return;
    const key = `${net.room}:${targetHost}:${expectedCampaignRef.current ?? "*"}`;
    let stopped = false;
    let timer: number | undefined;
    let delay = 1_200;
    const request = () => {
      if (stopped || adoptedSnapshotFor.current === key || statusRef.current !== "connected") return;
      net.publish({ t: "vtt-snapshot-request" }, targetHost);
      timer = window.setTimeout(request, delay);
      delay = Math.min(5_000, Math.ceil(delay * 1.6));
    };
    request();
    return () => {
      stopped = true;
      window.clearTimeout(timer);
    };
  }, [expectedCampaignId, net.status, net.role, net.room, net.peers, net.publish]);

  // A request received before the host's scene exists remains pending. Scene
  // adoption/switching rerenders this hook and services it as soon as possible.
  useEffect(() => {
    if (net.status !== "connected" || net.role !== "host") return;
    for (const [peerId, scope] of pendingSnapshotPeers.current) queueSnapshot(peerId, scope);
  }, [expectedCampaignId, net.role, net.status, queueSnapshot, sceneId]);

  // Movement is a request/commit protocol, deliberately separate from generic
  // relayed patches so the host can arbitrate simultaneous occupied-cell moves.
  useEffect(() => {
    const reject = (request: VttMoveRequestMessage, to: string, x: number, y: number, reason: VttMoveRejectMessage["reason"]) => {
      net.publish(
        {
          t: "vtt-move-reject",
          requestId: request.requestId,
          scope: request.scope,
          tokenId: request.tokenId,
          x,
          y,
          attemptedX: request.toX,
          attemptedY: request.toY,
          reason,
        },
        to
      );
    };
    const commit = (request: VttMoveRequestMessage, x: number, y: number) => {
      net.publish({ t: "vtt-move-commit", requestId: request.requestId, scope: request.scope, tokenId: request.tokenId, x, y });
    };

    const offRequest = net.subscribe("vtt-move-request", (raw, from) => {
      if (
        roleRef.current !== "host" || from === net.selfId ||
        peersRef.current.find((peer) => peer.id === from)?.role !== "player"
      ) return;
      const request = raw as VttMoveRequestMessage;
      if (
        !request.requestId || !request.scope || !request.tokenId ||
        ![request.fromX, request.fromY, request.toX, request.toY].every(Number.isFinite)
      ) return;

      if (request.scope !== sceneIdRef.current) {
        const handle = foreignMoveRef.current;
        if (!handle) {
          reject(request, from, request.fromX, request.fromY, "wrong-scene");
          return;
        }
        const epoch = sessionEpoch.current;
        void handle(request, from)
          .then((decision) => {
            if (sessionEpoch.current !== epoch) return;
            if (decision.ok) commit(request, decision.x, decision.y);
            else reject(request, from, decision.x, decision.y, decision.reason ?? "invalid");
          })
          .catch(() => {
            if (sessionEpoch.current === epoch) reject(request, from, request.fromX, request.fromY, "invalid");
          });
        return;
      }

      const engine = engineRef.current;
      if (!engine?.scene) {
        reject(request, from, request.fromX, request.fromY, "invalid");
        return;
      }
      const authority = validateMoveAuthority(
        {
          grid: engine.scene.data.grid,
          tokens: engine.scene.data.tokens,
          walls: engine.scene.data.walls,
          revision: 0,
        },
        { peerId: from, role: "player" },
        {
          tokenId: request.tokenId,
          fromX: request.fromX,
          fromY: request.fromY,
          toX: request.toX,
          toY: request.toY,
        }
      );
      if (!authority.ok) {
        reject(request, from, authority.x, authority.y, authority.reason);
        return;
      }
      if (engine.commitTokenMove(authority.tokenId, authority.x, authority.y, false, true)) commit(request, authority.x, authority.y);
      else reject(request, from, authority.previousX, authority.previousY, "invalid");
    });

    const offCommit = net.subscribe("vtt-move-commit", (raw, from) => {
      if (from !== hostId()) return;
      const message = raw as MoveCommitMsg;
      if (
        !message.requestId || message.scope !== sceneIdRef.current || !message.tokenId ||
        !Number.isFinite(message.x) || !Number.isFinite(message.y)
      ) return;
      const pending = pendingMoves.current.get(message.requestId);
      if (pending && (pending.scope !== message.scope || pending.tokenId !== message.tokenId)) return;
      if (pending) pendingMoves.current.delete(message.requestId);
      engineRef.current?.commitTokenMove(message.tokenId, message.x, message.y, false, true);
    });

    const offReject = net.subscribe("vtt-move-reject", (raw, from) => {
      if (from !== hostId()) return;
      const message = raw as Extract<NetMessage, { t: "vtt-move-reject" }>;
      const pending = pendingMoves.current.get(message.requestId);
      if (
        !pending || pending.scope !== message.scope || pending.tokenId !== message.tokenId ||
        message.scope !== sceneIdRef.current || !Number.isFinite(message.x) || !Number.isFinite(message.y) ||
        !Number.isFinite(message.attemptedX) || !Number.isFinite(message.attemptedY) ||
        message.attemptedX !== pending.toX || message.attemptedY !== pending.toY
      ) return;
      pendingMoves.current.delete(message.requestId);
      const engine = engineRef.current;
      // Restore the host's authoritative location first; the bounce is purely
      // visual and must originate from the position the host actually owns.
      engine?.commitTokenMove(message.tokenId, message.x, message.y, false, true);
      engine?.rejectTokenMove(message.tokenId, pending.toX, pending.toY);
    });

    return () => {
      offRequest();
      offCommit();
      offReject();
    };
  }, [engineRef, net.publish, net.selfId, net.subscribe]);

  // Late joiner: the host pushes a snapshot to each newly-seen peer.
  const knownPeers = useRef<Set<string>>(new Set());
  const knownPeerRoom = useRef("");
  useEffect(() => {
    if (net.status !== "connected" || net.role !== "host") {
      knownPeers.current.clear();
      knownPeerRoom.current = "";
      return;
    }
    if (knownPeerRoom.current !== net.room) {
      knownPeers.current.clear();
      knownPeerRoom.current = net.room;
    }
    const ids = net.peers.map((p) => p.id);
    const fresh = ids.filter((id) => !knownPeers.current.has(id));
    knownPeers.current = new Set(ids);
    for (const id of fresh) queueSnapshot(id);
  }, [net.peers, net.role, net.room, net.status, queueSnapshot]);

  return { connected: net.status === "connected", peerCount: net.peers.length, broadcastOp, broadcastSnapshot, requestMove };
}
