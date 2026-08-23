import { useEffect, useState } from "react";
import { onRoomCodexChanged, roomCodexState, type RoomCodexState } from "../lib/campaignCodex";

/** Reactive state for the authoritative Codex received from a Curator's room. */
export function useCampaignCodex(): RoomCodexState {
  const [, setTick] = useState(0);
  useEffect(() => onRoomCodexChanged(() => setTick((tick) => tick + 1)), []);
  return roomCodexState();
}
