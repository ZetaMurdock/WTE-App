import { useEffect, useState, type ReactNode } from "react";
import { useNet } from "../../net/NetContext";
import type { RollResult } from "../../game/wte";

interface Props {
  /** Produce the roll when invoked (called at delivery time so each destination re-rolls fresh). */
  make: () => RollResult;
  /** Always called — the roller sees + logs their own roll regardless of who it's sent to. */
  onLocal: (roll: RollResult) => void;
  className?: string;
  title?: string;
  children: ReactNode;
}

// A roll control with a right-click menu: roll privately, send to the whole party,
// or whisper the result to one player. Left-click rolls to the party when connected
// (else just locally). Solo play behaves exactly like a plain roll button.
export function RollButton({ make, onLocal, className = "roll-btn", title, children }: Props) {
  const net = useNet();
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);

  function deliver(mode: "self" | "party" | string) {
    const roll = make();
    onLocal(roll);
    if (net.status === "connected" && mode !== "self") {
      const msg = { t: "roll" as const, label: roll.detail.label, formula: roll.formula, result: roll.result };
      net.publish(msg, mode === "party" ? undefined : mode);
    }
    setMenu(null);
  }

  const connected = net.status === "connected";
  return (
    <>
      <button
        className={className}
        title={title ? title : connected ? "Click: roll to party · Right-click: choose who" : undefined}
        onClick={() => deliver(connected ? "party" : "self")}
        onContextMenu={(e) => {
          if (!connected) return;
          e.preventDefault();
          setMenu({ x: e.clientX, y: e.clientY });
        }}
      >
        {children}
      </button>
      {menu && (
        <RollMenu
          pos={menu}
          peers={net.peers.filter((p) => p.id !== net.selfId).map((p) => ({ id: p.id, name: p.name }))}
          onPick={deliver}
          onClose={() => setMenu(null)}
        />
      )}
    </>
  );
}

function RollMenu({
  pos,
  peers,
  onPick,
  onClose,
}: {
  pos: { x: number; y: number };
  peers: { id: string; name: string }[];
  onPick: (mode: string) => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onEsc);
    return () => window.removeEventListener("keydown", onEsc);
  }, [onClose]);

  return (
    <div
      className="rollmenu-backdrop"
      onClick={onClose}
      onContextMenu={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <div className="rollmenu" style={{ left: pos.x, top: pos.y }} onClick={(e) => e.stopPropagation()}>
        <button className="rollmenu-item" onClick={() => onPick("self")}>Roll privately (just me)</button>
        <button className="rollmenu-item" onClick={() => onPick("party")}>Send to whole party</button>
        {peers.length > 0 && <div className="rollmenu-sep" />}
        {peers.map((p) => (
          <button key={p.id} className="rollmenu-item" onClick={() => onPick(p.id)}>
            Send to {p.name}
          </button>
        ))}
      </div>
    </div>
  );
}
