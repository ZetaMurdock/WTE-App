import { useEffect, useRef } from "react";
import type { PixiVttApp } from "./engine/PixiVttApp";
import type { ThreeVttView } from "./engine3d/ThreeVttView";

interface Props {
  engine: PixiVttApp;
  /** The 3D view, when the VTT is in 3D mode (radial projects from its camera). */
  three: ThreeVttView | null;
  view3d: boolean;
  tokenId: string;
}

// Owlbear-style radial quick actions: a ring of translucent glass buttons around
// the selected token. A per-frame loop re-anchors it to the LIVE token position
// (2D camera or 3D projection), so it glues to the token through drags, camera
// pans/momentum, piloting, and 3D orbit. Works in both 2D and 3D.
export function VttRadialMenu({ engine, three, view3d, tokenId }: Props) {
  const ringRef = useRef<HTMLDivElement>(null);
  const btnRefs = useRef<(HTMLButtonElement | null)[]>([]);

  useEffect(() => {
    let raf = 0;
    const frame = () => {
      raf = requestAnimationFrame(frame);
      const ring = ringRef.current;
      if (!ring) return;
      const tok = engine.scene?.data.tokens.find((t) => t.id === tokenId);
      if (!tok) {
        ring.style.display = "none";
        return;
      }
      let sx: number, sy: number, r: number;
      if (view3d && three) {
        const p = three.projectToken(tokenId);
        if (!p) {
          ring.style.display = "none";
          return;
        }
        sx = p.x;
        sy = p.y;
        r = Math.max(34, Math.min(120, p.r));
      } else {
        const cam = engine.camera;
        sx = tok.x * cam.zoom + cam.x;
        sy = tok.y * cam.zoom + cam.y;
        r = (((tok.size || 1) * (engine.scene?.data.grid.size ?? 70)) / 2) * cam.zoom + 30;
      }
      ring.style.display = "block";
      ring.style.left = `${sx}px`;
      ring.style.top = `${sy}px`;
      const offs = [
        [0, -r],
        [0, r],
        [-r, 0],
        [r, 0],
      ];
      for (let i = 0; i < btnRefs.current.length; i++) {
        const b = btnRefs.current[i];
        if (b) b.style.transform = `translate(calc(-50% + ${offs[i][0]}px), calc(-50% + ${offs[i][1]}px))`;
      }
    };
    frame();
    return () => cancelAnimationFrame(raf);
  }, [engine, three, view3d, tokenId]);

  // Actions read the LIVE token at click time (size may have changed since mount).
  const live = () => engine.scene?.data.tokens.find((t) => t.id === tokenId);
  const actions: { label: string; title: string; onClick: () => void }[] = [
    { label: "+", title: "Bigger (size +1)", onClick: () => { const t = live(); if (t) engine.updateToken(tokenId, { size: Math.min(6, (t.size || 1) + 1) }); } },
    { label: "−", title: "Smaller (size −1)", onClick: () => { const t = live(); if (t) engine.updateToken(tokenId, { size: Math.max(1, (t.size || 1) - 1) }); } },
    { label: "Dup", title: "Duplicate this token", onClick: () => { const t = live(); if (t) engine.spawnToken({ ...t }); } },
    { label: "Del", title: "Delete this token", onClick: () => engine.deleteSelected() },
  ];

  return (
    <div className="vtt2-radial" ref={ringRef}>
      {actions.map((a, i) => (
        <button
          key={a.label}
          ref={(el) => (btnRefs.current[i] = el)}
          className="vtt2-radial-btn"
          title={a.title}
          onClick={a.onClick}
        >
          {a.label}
        </button>
      ))}
    </div>
  );
}
