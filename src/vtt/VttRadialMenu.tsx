import { useEffect, useRef } from "react";
import type { PixiVttApp } from "./engine/PixiVttApp";

interface Props {
  engine: PixiVttApp;
  tokenId: string;
}

// Owlbear-style radial quick actions: a ring of translucent glass buttons around
// the selected token. A per-frame loop re-anchors it to the LIVE token position,
// so it glues to the token through drags, camera pans/momentum and piloting.
export function VttRadialMenu({ engine, tokenId }: Props) {
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
      const cam = engine.camera;
      const sx = tok.x * cam.zoom + cam.x;
      const sy = tok.y * cam.zoom + cam.y;
      const r = (((tok.size || 1) * (engine.scene?.data.grid.size ?? 70)) / 2) * cam.zoom + 30;
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
  }, [engine, tokenId]);

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
