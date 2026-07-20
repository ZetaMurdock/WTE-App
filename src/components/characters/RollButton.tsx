import { useEffect, useState, type ReactNode } from "react";
import { useNet } from "../../net/NetContext";
import type { RollMode, RollResult } from "../../game/wte";

interface Props {
  /** Produce the roll when invoked (called at delivery time so each destination re-rolls fresh). */
  make: (mode: RollMode) => RollResult;
  /** Always called — the roller sees + logs their own roll regardless of who it's sent to. */
  onLocal: (roll: RollResult) => void;
  className?: string;
  title?: string;
  children: ReactNode;
}

/** Roll posture from a plain click's modifier keys: shift = advantage, ctrl/alt = disadvantage. */
function modeFromClick(e: React.MouseEvent): RollMode {
  if (e.shiftKey) return "adv";
  if (e.ctrlKey || e.altKey) return "dis";
  return "normal";
}

// A roll control. Left-click rolls to the party when connected (else just
// locally); shift-click = Advantage, ctrl/alt-click = Disadvantage. Right-click
// opens a menu with the postures spelled out plus (when connected) who to send
// the roll to. The roll message always names the posture.
export function RollButton({ make, onLocal, className = "roll-btn", title, children }: Props) {
  const net = useNet();
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);

  function deliver(dest: "self" | "party" | string, mode: RollMode = "normal") {
    const roll = make(mode);
    onLocal(roll);
    if (net.status === "connected" && dest !== "self") {
      const msg = { t: "roll" as const, label: roll.detail.label, formula: roll.formula, result: roll.result };
      net.publish(msg, dest === "party" ? undefined : dest);
    }
    setMenu(null);
  }

  const connected = net.status === "connected";
  const defaultDest = connected ? "party" : "self";
  return (
    <>
      <button
        className={className}
        title={(title ? title + " — " : "") + "Shift-click: Advantage · Ctrl-click: Disadvantage · Right-click: more"}
        onClick={(e) => deliver(defaultDest, modeFromClick(e))}
        onContextMenu={(e) => {
          e.preventDefault();
          setMenu({ x: e.clientX, y: e.clientY });
        }}
      >
        {children}
      </button>
      {menu && (
        <RollMenu
          pos={menu}
          connected={connected}
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
  connected,
  peers,
  onPick,
  onClose,
}: {
  pos: { x: number; y: number };
  connected: boolean;
  peers: { id: string; name: string }[];
  onPick: (dest: string, mode?: RollMode) => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onEsc);
    return () => window.removeEventListener("keydown", onEsc);
  }, [onClose]);

  const dest = connected ? "party" : "self";
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
        <button className="rollmenu-item" onClick={() => onPick(dest, "adv")}>Roll with Advantage</button>
        <button className="rollmenu-item" onClick={() => onPick(dest, "dis")}>Roll with Disadvantage</button>
        {connected && (
          <>
            <div className="rollmenu-sep" />
            <button className="rollmenu-item" onClick={() => onPick("self")}>Roll privately (just me)</button>
            <button className="rollmenu-item" onClick={() => onPick("party")}>Send to whole party</button>
            {peers.length > 0 && <div className="rollmenu-sep" />}
            {peers.map((p) => (
              <button key={p.id} className="rollmenu-item" onClick={() => onPick(p.id)}>
                Send to {p.name}
              </button>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
