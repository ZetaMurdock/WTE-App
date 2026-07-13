import { useEffect, useState } from "react";

interface Props {
  onConfirm: () => void;
  /** Resting-state label. */
  label: string;
  /** Armed-state label (defaults to "Confirm"). */
  confirmLabel?: string;
  className?: string;
  title?: string;
}

// A two-step confirm button: first click arms it (revealing Confirm / Cancel),
// so destructive actions need a deliberate second click — no native confirm()
// dialog. Auto-disarms after a few seconds.
export function ConfirmButton({ onConfirm, label, confirmLabel = "Confirm", className = "icon-btn", title }: Props) {
  const [armed, setArmed] = useState(false);

  useEffect(() => {
    if (!armed) return;
    const t = window.setTimeout(() => setArmed(false), 4000);
    return () => window.clearTimeout(t);
  }, [armed]);

  if (armed) {
    return (
      <span className="confirm-wrap">
        <button className="icon-btn danger" onClick={onConfirm}>
          {confirmLabel}
        </button>
        <button className="icon-btn" onClick={() => setArmed(false)}>
          Cancel
        </button>
      </span>
    );
  }
  return (
    <button className={className} title={title} onClick={() => setArmed(true)}>
      {label}
    </button>
  );
}
