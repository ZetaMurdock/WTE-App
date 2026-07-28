import { useEffect, useState } from "react";
import {
  flushAll,
  pendingLabels,
  saveErrorMessage,
  saveState,
  subscribeSaveState,
  type SaveState,
} from "../../lib/saveQueue";

const TEXT: Record<SaveState, string> = {
  idle: "Saved",
  pending: "Unsaved changes",
  saving: "Saving",
  failed: "Not saved",
};

// The app had no save indicator at all, so a state-first UI showed every edit as
// applied while the write might have failed silently — the loss only surfaced on
// the next launch. This is deliberately quiet when idle and only asserts itself
// when something is outstanding or has failed.
export function SaveStatus() {
  const [, bump] = useState(0);
  useEffect(() => subscribeSaveState(() => bump((n) => n + 1)), []);

  const state = saveState();
  const err = saveErrorMessage();
  const labels = pendingLabels();

  const title =
    state === "failed"
      ? err ?? "The last save did not complete."
      : state === "pending"
        ? `Not written yet: ${labels.join(", ")}. Saves automatically, or click to save now.`
        : state === "saving"
          ? "Writing to disk."
          : "Everything is written to disk.";

  return (
    <button
      className={"save-status " + state}
      title={title}
      onClick={() => {
        if (state === "pending" || state === "failed") void flushAll();
      }}
      aria-live="polite"
    >
      <span className="save-dot" aria-hidden />
      <span className="save-text">{TEXT[state]}</span>
    </button>
  );
}
