import { useEffect, type ReactNode } from "react";

interface Props {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
}

// A smooth right-side drawer. Kept mounted and toggled via a CSS class so both
// open and close animate (backdrop fade + panel slide). Closes on Esc / backdrop.
export function SidePanel({ open, title, onClose, children }: Props) {
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  return (
    <div className={"sidepanel-root" + (open ? " open" : "")} aria-hidden={!open}>
      <div className="sidepanel-backdrop" onClick={onClose} />
      <aside className="sidepanel" role="dialog" aria-label={title}>
        <div className="sidepanel-head">
          <div className="sidepanel-title">{title}</div>
          <button className="sidepanel-close" onClick={onClose} title="Close (Esc)">
            ✕
          </button>
        </div>
        <div className="sidepanel-body">{children}</div>
      </aside>
    </div>
  );
}
