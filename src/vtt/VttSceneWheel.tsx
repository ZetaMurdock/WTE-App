import { useEffect, useState } from "react";
import type { VttScene } from "./types/scene";

interface Props {
  scenes: VttScene[];
  activeId: string | null;
  onSwitch: (id: string) => void;
  /** Per-scene environment actions (right-click menu). Nothing transfers between scenes. */
  onSetBackground: (id: string) => void;
  onSetMusic: (id: string) => void;
  onClearMusic: (id: string) => void;
}

/** Short initials for a scene dot — the significant part after any "·" separator. */
function initials(name: string): string {
  const last = (name.split("·").pop() || name).trim();
  const words = last.split(/\s+/).filter(Boolean);
  if (words.length >= 2) return (words[0][0] + words[words.length - 1][0]).toUpperCase();
  return last.slice(0, 2).toUpperCase();
}

// The Scene Wheel (right edge, Curator-only): one dot per scene; click to
// traverse, RIGHT-CLICK for that scene's environment menu — background, ambient
// music — each setting stored on that scene alone.
export function VttSceneWheel({ scenes, activeId, onSwitch, onSetBackground, onSetMusic, onClearMusic }: Props) {
  const [menu, setMenu] = useState<{ id: string; y: number } | null>(null);

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const onEsc = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", onEsc);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", onEsc);
    };
  }, [menu]);

  if (scenes.length === 0) return null;
  const menuScene = menu ? scenes.find((s) => s.id === menu.id) : null;
  return (
    <div className="vtt2-scenewheel">
      {scenes.map((s) => (
        <button
          key={s.id}
          className={"vtt2-wheel-dot" + (s.id === activeId ? " active" : "") + (s.data.audio ? " has-audio" : "")}
          data-name={s.name}
          title={`${s.name} — right-click for scene options`}
          onClick={() => s.id !== activeId && onSwitch(s.id)}
          onContextMenu={(e) => {
            e.preventDefault();
            setMenu({ id: s.id, y: (e.target as HTMLElement).getBoundingClientRect().top });
          }}
        >
          {initials(s.name)}
        </button>
      ))}
      {menu && menuScene && (
        <div className="vtt2-scene-menu" style={{ top: Math.max(60, menu.y - 40) }} onMouseDown={(e) => e.stopPropagation()}>
          <div className="vtt2-scene-menu-head">{menuScene.name}</div>
          {menu.id !== activeId && (
            <button className="profile-row" onClick={() => { onSwitch(menu.id); setMenu(null); }}>
              <span>Open scene</span>
            </button>
          )}
          <button className="profile-row" onClick={() => { onSetBackground(menu.id); setMenu(null); }}>
            <span>Set background…</span>
          </button>
          <button className="profile-row" onClick={() => { onSetMusic(menu.id); setMenu(null); }}>
            <span>{menuScene.data.audio ? "Replace ambient music…" : "Add ambient music…"}</span>
          </button>
          {menuScene.data.audio && (
            <button className="profile-row sub" onClick={() => { onClearMusic(menu.id); setMenu(null); }}>
              <span>Remove music</span>
            </button>
          )}
          <div className="vtt2-scene-menu-foot">settings stay with this scene</div>
        </div>
      )}
    </div>
  );
}
