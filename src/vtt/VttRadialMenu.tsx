import type { PixiVttApp } from "./engine/PixiVttApp";
import type { VttToken } from "./types/scene";

interface Props {
  engine: PixiVttApp;
  token: VttToken;
}

// Owlbear-style radial quick actions: a small ring of translucent buttons
// around the selected token, so common edits never need the sidebar. Positioned
// in screen space from the engine camera; re-rendered on every engine tick.
export function VttRadialMenu({ engine, token }: Props) {
  const cam = engine.camera;
  const sx = token.x * cam.zoom + cam.x;
  const sy = token.y * cam.zoom + cam.y;
  const r = (((token.size || 1) * (engine.scene?.data.grid.size ?? 70)) / 2) * cam.zoom + 30;

  const actions: { label: string; title: string; dx: number; dy: number; onClick: () => void }[] = [
    {
      label: "+",
      title: "Bigger (size +1)",
      dx: 0,
      dy: -r,
      onClick: () => engine.updateToken(token.id, { size: Math.min(6, (token.size || 1) + 1) }),
    },
    {
      label: "−",
      title: "Smaller (size −1)",
      dx: 0,
      dy: r,
      onClick: () => engine.updateToken(token.id, { size: Math.max(1, (token.size || 1) - 1) }),
    },
    {
      label: "Dup",
      title: "Duplicate this token",
      dx: -r,
      dy: 0,
      onClick: () => engine.spawnToken({ ...token }),
    },
    {
      label: "Del",
      title: "Delete this token",
      dx: r,
      dy: 0,
      onClick: () => engine.deleteSelected(),
    },
  ];

  return (
    <div className="vtt2-radial" style={{ left: sx, top: sy }}>
      {actions.map((a) => (
        <button
          key={a.label}
          className="vtt2-radial-btn"
          style={{ transform: `translate(calc(-50% + ${a.dx}px), calc(-50% + ${a.dy}px))` }}
          title={a.title}
          onClick={a.onClick}
        >
          {a.label}
        </button>
      ))}
    </div>
  );
}
