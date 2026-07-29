// Re-render when the Codex changes.
//
// The registry is a singleton that swaps its contents when pages load or the
// campaign changes. React has no way to know that happened, so a sheet mounted
// before the page pass finished kept showing official mechanics after a campaign
// override arrived — the rules on screen were whatever had loaded when the panel
// first rendered.
import { useEffect, useState } from "react";
import { codexStatus, onCodexChanged } from "./codexService";
import type { RegistryStatus } from "./codexRegistry";

/** A counter that changes whenever the Codex does, plus its current state. */
export function useCodex(): { tick: number; status: RegistryStatus } {
  const [tick, setTick] = useState(0);
  useEffect(() => onCodexChanged(() => setTick((t) => t + 1)), []);
  return { tick, status: codexStatus() };
}
