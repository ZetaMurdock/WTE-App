import { useCallback, useEffect, useRef } from "react";
import type { Campaign } from "../models/campaign";
import { pushToast } from "../lib/appToast";
import {
  activeRoomCodex,
  buildCampaignCodexSnapshot,
  clearRoomCodex,
  installRoomCodex,
  markRoomCodexError,
  markRoomCodexSyncing,
  parseCampaignCodexSnapshot,
} from "../lib/campaignCodex";
import type { NetMessage } from "./protocol";
import { useNet } from "./NetContext";

/**
 * Bridges App's selected local campaign to the live room. The host compiles and
 * publishes the campaign Codex; players install only host-authored snapshots in
 * memory and ask the normal game-data loader to rebuild every shared catalog.
 */
const MAX_CODEX_RETRIES = 3;
const CODEX_RETRY_MS = 2_000;

export function CampaignCodexSync({ campaign, curator }: { campaign: Campaign | null; curator: boolean }) {
  const { status, role, room, peers, table, publish, subscribe } = useNet();
  const campaignId = campaign?.id ?? "";
  const campaignName = campaign?.name ?? "";
  const tableCampaignId = table?.campaignId ?? "";
  const hostId = peers.find((peer) => peer.role === "host")?.id ?? "";

  // Scope async work to one specific room/campaign. NetContext intentionally
  // returns a fresh API object as its state changes, so depending on that whole
  // object would restart these effects for unrelated state (BP, notes, etc.).
  const hostScope = curator && status === "connected" && role === "host" && campaignId
    ? `${room}\u001f${campaignId}\u001f${campaignName}`
    : "";
  const playerScope = status === "connected" && role === "player" && tableCampaignId && hostId
    ? `${room}\u001f${hostId}\u001f${tableCampaignId}`
    : "";
  const hostScopeRef = useRef(hostScope);
  hostScopeRef.current = hostScope;
  const broadcastBuildToken = useRef(0);
  const snapshotGeneration = useRef(0);
  const snapshotBuild = useRef<{
    scope: string;
    generation: number;
    promise: ReturnType<typeof buildCampaignCodexSnapshot>;
  } | null>(null);
  const lastPublished = useRef<{ scope: string; revision: string }>({ scope: "", revision: "" });
  const lastTargetRequest = useRef(new Map<string, number>());
  const requestInFlight = useRef("");
  // Bounded on purpose: a client that re-asked forever would turn one bad answer
  // into a request storm against the Curator's machine.
  const retries = useRef(0);
  // Read at RETRY time, not when the failure arrived — the id that failed is the
  // stale one `room-info` is in the middle of correcting.
  const tableCampaignRef = useRef("");
  tableCampaignRef.current = tableCampaignId;
  const previousPlayerScope = useRef("");

  const getSnapshot = useCallback((scope: string, generation: number) => {
    const cached = snapshotBuild.current;
    if (cached?.scope === scope && cached.generation === generation) return cached.promise;
    const promise = buildCampaignCodexSnapshot(campaignId, campaignName, { playerOnly: true });
    snapshotBuild.current = { scope, generation, promise };
    return promise;
  }, [campaignId, campaignName]);

  const publishSnapshot = useCallback(async (to?: string, requestedGeneration?: number) => {
    if (!hostScope || !campaignId) return;
    const scope = hostScope;
    const generation = requestedGeneration ?? snapshotGeneration.current;
    // Only competing broadcasts supersede each other. A targeted late-join
    // response must not cancel another player's response (or be cancelled by a
    // page-change broadcast).
    const token = to ? 0 : ++broadcastBuildToken.current;
    try {
      const snapshot = await getSnapshot(scope, generation);
      if (hostScopeRef.current !== scope) return;
      // A save that landed while this build was running owns a newer generation.
      // Its broadcast will answer every peer, including a late joiner whose
      // targeted request happened to race that save.
      if (generation !== snapshotGeneration.current) return;
      if (!to && token !== broadcastBuildToken.current) return;
      // An explicit request always gets an answer. Broadcast updates only when
      // the effective revision changed, avoiding another 5 MiB transfer when an
      // unrelated React render changes the peer list.
      if (!to && lastPublished.current.scope === scope && lastPublished.current.revision === snapshot.revision) return;
      if (!to) lastPublished.current = { scope, revision: snapshot.revision };
      publish({ t: "codex-snapshot", snapshot }, to);
    } catch (error) {
      if (hostScopeRef.current !== scope) return;
      if (!to && token !== broadcastBuildToken.current) return;
      const message = error instanceof Error ? error.message : String(error);
      publish({ t: "codex-error", campaignId, reason: "unavailable", message }, to);
    }
  }, [campaignId, getSnapshot, hostScope, publish]);

  // Host: answer a player's explicit late-join/recovery request. NetSession has
  // already authenticated `from` as a room player before this callback can fire.
  useEffect(() => subscribe("codex-request", (raw, from) => {
    if (!curator || role !== "host") return;
    const request = raw as Extract<NetMessage, { t: "codex-request" }>;
    // One reliable data channel does not need a burst of identical recovery
    // replies. Besides the network cost, rebuilding the full official corpus for
    // each packet lets one peer monopolize the Curator's UI thread.
    // Keyed by the campaign ASKED FOR, not by the asker alone, and recorded only
    // when the host actually SERVES one. A player arrives holding the campaign id
    // their last session in this room left behind, is told it is not the one
    // hosted here, and re-asks the instant `room-info` corrects them — inside the
    // window. Keyed by peer, that corrected request was silently swallowed, and
    // with nothing retrying on either side the player sat on "that is not the
    // campaign currently hosted at this table" until they gave up.
    const requestKey = `${hostScope}\u001f${from}\u001f${request.campaignId}`;
    const now = Date.now();
    const last = lastTargetRequest.current.get(requestKey) ?? 0;
    if (now - last < 2_000) return;
    if (!campaignId || request.campaignId !== campaignId) {
      publish({
        t: "codex-error",
        campaignId: request.campaignId,
        reason: "unavailable",
        message: "That is not the campaign currently hosted at this table.",
      }, from);
      return;
    }
    // Recorded here and not above: a refusal is not a service, and spending the
    // window on a question this host was never going to answer is what made the
    // corrected request unanswerable.
    lastTargetRequest.current.set(requestKey, now);
    void publishSnapshot(from, snapshotGeneration.current);
  }), [campaignId, curator, hostScope, publish, publishSnapshot, role, subscribe]);

  // Host: publish the first snapshot and rebuild it after any page, visibility,
  // campaign-rule or rule-layer change. Saves announce through this same event.
  useEffect(() => {
    if (!hostScope) return;
    hostScopeRef.current = hostScope;
    lastPublished.current = { scope: hostScope, revision: "" };
    lastTargetRequest.current.clear();
    const changed = () => {
      const generation = ++snapshotGeneration.current;
      snapshotBuild.current = null;
      void publishSnapshot(undefined, generation);
    };
    changed();
    window.addEventListener("wte-pages-changed", changed);
    return () => {
      window.removeEventListener("wte-pages-changed", changed);
      broadcastBuildToken.current += 1;
      snapshotGeneration.current += 1;
      snapshotBuild.current = null;
      lastTargetRequest.current.clear();
      // A render for a new scope assigns the new value before this old cleanup;
      // only clear when this is a genuine leave/unmount of the same scope.
      if (hostScopeRef.current === hostScope) hostScopeRef.current = "";
    };
  }, [hostScope, publishSnapshot]);

  // Entering, leaving, or switching a player room invalidates both the request
  // guard and the prior room's in-memory authority, even if two rooms happen to
  // announce the same campaign id.
  useEffect(() => {
    if (previousPlayerScope.current === playerScope) return;
    previousPlayerScope.current = playerScope;
    requestInFlight.current = "";
    if (clearRoomCodex()) window.dispatchEvent(new Event("wte-pages-changed"));
  }, [playerScope]);

  /** Ask again, a few times, then stop. One unreadable answer used to end the
   *  session: nothing re-requested and the gate stayed up until the app was
   *  restarted. */
  const retryCodex = useCallback((forCampaign: string) => {
    if (retries.current >= MAX_CODEX_RETRIES) return;
    retries.current += 1;
    const attempt = retries.current;
    window.setTimeout(() => {
      const want = tableCampaignRef.current || forCampaign;
      if (requestInFlight.current || !hostId || !want) return;
      markRoomCodexSyncing(want);
      publish({ t: "codex-request", campaignId: want, haveRevision: activeRoomCodex()?.revision }, hostId);
    }, attempt * CODEX_RETRY_MS);
  }, [hostId, publish]);

  // Player: request the authority document after room-info names the campaign.
  useEffect(() => {
    if (!playerScope || !tableCampaignId || !hostId) return;
    const have = activeRoomCodex();
    if (have?.campaignId === tableCampaignId) {
      requestInFlight.current = "";
      return;
    }
    if (requestInFlight.current === playerScope) return;
    requestInFlight.current = playerScope;
    markRoomCodexSyncing(tableCampaignId);
    publish({ t: "codex-request", campaignId: tableCampaignId, haveRevision: have?.revision }, hostId);
  }, [hostId, playerScope, publish, tableCampaignId]);

  useEffect(() => subscribe("codex-snapshot", (raw, from) => {
    if (role !== "player" || !hostId || from !== hostId) return;
    const message = raw as Extract<NetMessage, { t: "codex-snapshot" }>;
    const expected = tableCampaignId || message.snapshot?.campaignId;
    requestInFlight.current = "";
    // The reason is the point of asking. "Did not pass validation" is thirty
    // possibilities wearing one sentence, and a table stuck on a join had
    // nothing to act on.
    let why = "";
    const snapshot = parseCampaignCodexSnapshot(message.snapshot, expected, (reason) => {
      why = reason;
    });
    if (!snapshot) {
      markRoomCodexError(
        expected || "",
        `The Curator's Codex snapshot did not pass validation — ${why || "no reason was recorded"}.`
      );
      retryCodex(expected || "");
      return;
    }
    retries.current = 0;
    const changed = installRoomCodex(snapshot);
    if (changed) {
      window.dispatchEvent(new Event("wte-pages-changed"));
      pushToast(`Campaign Codex synced · ${snapshot.pages.length} pages`, "info", 5000);
    }
  }), [hostId, publish, role, subscribe, tableCampaignId]);

  useEffect(() => subscribe("codex-error", (raw, from) => {
    if (role !== "player" || !hostId || from !== hostId) return;
    const message = raw as Extract<NetMessage, { t: "codex-error" }>;
    if (tableCampaignId && message.campaignId !== tableCampaignId) return;
    requestInFlight.current = "";
    markRoomCodexError(message.campaignId, message.message || "The Curator could not provide this campaign's Codex.");
    retryCodex(message.campaignId);
  }), [hostId, role, subscribe, tableCampaignId]);

  // Unmounting the bridge must not leave a room's rules installed in singleton
  // game-data repositories.
  useEffect(() => () => {
    requestInFlight.current = "";
    if (clearRoomCodex()) window.dispatchEvent(new Event("wte-pages-changed"));
  }, []);

  return null;
}
