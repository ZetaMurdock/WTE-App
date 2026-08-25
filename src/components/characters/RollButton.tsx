import { useEffect, useState, type ReactNode } from "react";
import { useNet } from "../../net/NetContext";
import type { RollMode, RollResult } from "../../game/wte";
import { createRollId } from "../../lib/rolls";
import type { RollMessage } from "../../net/protocol";

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
  const [awaiting, setAwaiting] = useState(false);

  async function deliver(dest: "self" | "party" | string, mode: RollMode = "normal") {
    if (awaiting) return;
    if (mode !== "normal" && net.status === "connected" && net.role === "player") {
      setAwaiting(true);
      const accepted = await net.authorizeRollMode(mode, title || String(children));
      setAwaiting(false);
      if (!accepted) {
        setMenu(null);
        return;
      }
    }
    const roll = make(mode);
    onLocal(roll);
    if (net.status === "connected" && dest !== "self") {
      const modifier = roll.detail.modifier;
      // The roll's own canonical expression when it has one; the single-die
      // reconstruction is only right for profile rolls that never carry it.
      const baseExpr =
        roll.baseExpr ?? `1d${roll.detail.die}${modifier > 0 ? `+${modifier}` : modifier < 0 ? String(modifier) : ""}`;
      const msg: RollMessage = {
        t: "roll",
        id: createRollId(),
        label: roll.detail.label,
        formula: roll.formula,
        baseExpr,
        result: roll.result,
        detail: roll.detail,
        mode: roll.detail.mode ?? mode,
        at: Date.now(),
        actor: { peerId: net.selfId },
      };
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
        disabled={awaiting}
        title={(title ? title + " — " : "") + "Shift-click: Advantage · Ctrl-click: Disadvantage · Right-click: more"}
        onClick={(e) => void deliver(defaultDest, modeFromClick(e))}
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
          onPick={(dest, mode) => void deliver(dest, mode)}
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
        <button className="rollmenu-item" onClick={() => onPick(dest, "double-adv")}>Roll with Double Advantage</button>
        <button className="rollmenu-item" onClick={() => onPick(dest, "double-dis")}>Roll with Double Disadvantage</button>
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
