import { useEffect } from "react";
import { useNet } from "./NetContext";
import type { Campaign } from "../models/campaign";

/** Announces the Curator's active campaign to the room, so a joining player's app
 *  points itself at the right table. App holds `activeCampaign` but sits OUTSIDE
 *  NetProvider and cannot call useNet(), so this one-line bridge lives inside it.
 *  Re-announces whenever the campaign or the peer list changes, which is how a
 *  late joiner learns the campaign without the host touching anything. */
export function CampaignAnnouncer({ campaign, curator }: { campaign: Campaign | null; curator: boolean }) {
  const net = useNet();
  const peerCount = net.peers.length;
  useEffect(() => {
    if (!curator || net.status !== "connected" || net.role !== "host" || !campaign) return;
    net.announceCampaign(campaign.id, campaign.name);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [curator, net.status, net.role, campaign?.id, campaign?.name, peerCount]);
  return null;
}
