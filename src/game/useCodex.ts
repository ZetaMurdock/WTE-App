// Re-render when the Codex changes.
//
// The registry is a singleton that swaps its contents when pages load or the
// campaign changes. React has no way to know that happened, so a sheet mounted
// before the page pass finished kept showing official mechanics after a campaign
// override arrived — the rules on screen were whatever had loaded when the panel
// first rendered.
import { useEffect, useState } from "react";
import { codexRevision, codexStatus, onCodexChanged } from "./codexService";
import type { RegistryStatus } from "./codexRegistry";

/** The Codex's current revision and state. `revision` is the dependency to key
 *  work on: `status` can stay "ready" across a reload that changed every answer. */
export function useCodex(): { tick: number; revision: number; status: RegistryStatus } {
  const [tick, setTick] = useState(0);
  useEffect(() => onCodexChanged(() => setTick((t) => t + 1)), []);
  return { tick, revision: codexRevision(), status: codexStatus() };
}
