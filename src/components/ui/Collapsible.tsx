import { useState, type ReactNode } from "react";

interface Props {
  title: ReactNode;
  defaultOpen?: boolean;
  /** Optional content pinned to the right of the header (e.g. a Select button). */
  right?: ReactNode;
  children: ReactNode;
}

// Smooth accordion. Height animates via the grid-template-rows 0fr→1fr trick
// (no JS measuring), giving a fluid open/close plus a rotating chevron.
export function Collapsible({ title, defaultOpen = false, right, children }: Props) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={"collapsible" + (open ? " open" : "")}>
      <div className="collapsible-head">
        <button className="collapsible-toggle" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          <span className="collapsible-chevron">▸</span>
          <span className="collapsible-title">{title}</span>
        </button>
        {right ? <div className="collapsible-right">{right}</div> : null}
      </div>
      <div className="collapsible-content">
        <div className="collapsible-inner">{children}</div>
      </div>
    </div>
  );
}
