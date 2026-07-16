import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { VttScene } from "./types/scene";

interface Props {
  scenes: VttScene[];
  activeId: string | null;
  onSwitch: (id: string) => void;
  /** Step to the previous (-1) / next (+1) scene — arrow buttons + scroll wheel. */
  onStep: (dir: 1 | -1) => void;
  /** Per-scene environment actions (right-click menu). Nothing transfers between scenes. */
  onSetBackground: (id: string) => void;
  onSetMusic: (id: string) => void;
  onClearMusic: (id: string) => void;
  /** Open the full scene settings panel (background / music / atmosphere / shaders). */
  onOpenSettings: () => void;
  /** Open the per-scene soundboard (upload + play sound effects). */
  onOpenSoundboard: () => void;
  /** Push this scene to every connected player as the active shared view. */
  onSetActiveForEveryone: (id: string) => void;
  /** Number of connected players (0 when solo) — shows/labels the broadcast action. */
  playerCount: number;
}

/** Short initials for a scene card — the significant part after any "·" separator. */
function initials(name: string): string {
  const last = (name.split("·").pop() || name).trim();
  const words = last.split(/\s+/).filter(Boolean);
  if (words.length >= 2) return (words[0][0] + words[words.length - 1][0]).toUpperCase();
  return last.slice(0, 2).toUpperCase();
}

// Monochrome line icons (currentColor) — the app convention is no emoji/pictographs.
const IconBroadcast = () => (
  <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
    <circle cx="8" cy="8" r="1.6" /><path d="M4.8 4.8a4.5 4.5 0 000 6.4M11.2 4.8a4.5 4.5 0 010 6.4M2.6 2.6a7.6 7.6 0 000 10.8M13.4 2.6a7.6 7.6 0 010 10.8" />
  </svg>
);
const IconOpen = () => (
  <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
    <path d="M1.5 8s2.5-4.5 6.5-4.5S14.5 8 14.5 8s-2.5 4.5-6.5 4.5S1.5 8 1.5 8z" /><circle cx="8" cy="8" r="1.8" />
  </svg>
);
const IconImage = () => (
  <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round">
    <rect x="2" y="3" width="12" height="10" rx="1.5" /><circle cx="5.5" cy="6.5" r="1.1" /><path d="M3 12l3.5-3.5 2.5 2.3L11 9l2 2" />
  </svg>
);
const IconNote = () => (
  <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
    <path d="M6 12V4.5l7-1.5V10.5" /><circle cx="4.4" cy="12" r="1.6" /><circle cx="11.4" cy="10.5" r="1.6" />
  </svg>
);
const IconBoard = () => (
  <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round">
    <rect x="2" y="2" width="5" height="5" rx="1" /><rect x="9" y="2" width="5" height="5" rx="1" /><rect x="2" y="9" width="5" height="5" rx="1" /><rect x="9" y="9" width="5" height="5" rx="1" />
  </svg>
);
const IconSliders = () => (
  <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
    <path d="M3 4h10M3 8h10M3 12h10" /><circle cx="6" cy="4" r="1.6" fill="currentColor" stroke="none" /><circle cx="10" cy="8" r="1.6" fill="currentColor" stroke="none" /><circle cx="5" cy="12" r="1.6" fill="currentColor" stroke="none" />
  </svg>
);
const IconX = () => (
  <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
    <path d="M4 4l8 8M12 4l-8 8" />
  </svg>
);

// The Scene Rail (right edge, Curator-only): each scene is a BOX on a vertical
// wheel — click to open it, right-click for that scene's tools, step with the
// up/down buttons or the scroll wheel. Replaces the old tiny dots, whose hover
// tooltip overlapped neighbouring dots and ate their clicks. The menu is
// PORTALED to <body> so no transform/overflow ancestor can clip it.
export function VttSceneWheel({ scenes, activeId, onSwitch, onStep, onSetBackground, onSetMusic, onClearMusic, onOpenSettings, onOpenSoundboard, onSetActiveForEveryone, playerCount }: Props) {
  const [open, setOpen] = useState(true);
  const [menu, setMenu] = useState<{ id: string; y: number } | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const onStepRef = useRef(onStep);
  onStepRef.current = onStep;
  const wheelAcc = useRef(0);
  const wheelLock = useRef(0);

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

  // Scroll wheel steps through scenes. Native non-passive listener because React
  // registers `onWheel` passively (preventDefault would be ignored), and we must
  // stop the page/list from scrolling while stepping. One flick = one step.
  useEffect(() => {
    const el = listRef.current;
    if (!el || !open) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const now = Date.now();
      if (now < wheelLock.current) return;
      wheelAcc.current += e.deltaY;
      if (Math.abs(wheelAcc.current) >= 60) {
        onStepRef.current(wheelAcc.current > 0 ? 1 : -1);
        wheelAcc.current = 0;
        wheelLock.current = now + 280;
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [open]);

  // Keep the active card visible as switches happen (long campaigns scroll).
  useEffect(() => {
    if (!open) return;
    listRef.current?.querySelector(".vtt2-rail-card.active")?.scrollIntoView({ block: "nearest" });
  }, [activeId, open]);

  if (scenes.length === 0) return null;
  const menuScene = menu ? scenes.find((s) => s.id === menu.id) : null;

  const menuEl =
    menu && menuScene ? (
      <div
        className="vtt2-scene-menu"
        style={{ top: Math.max(60, Math.min(menu.y - 40, window.innerHeight - 340)) }}
        onMouseDown={(e) => e.stopPropagation()}
        onContextMenu={(e) => e.preventDefault()}
      >
        <div className="vtt2-scene-menu-head">{menuScene.name}</div>
        <button
          className="profile-row strong"
          onClick={() => { onSetActiveForEveryone(menu.id); setMenu(null); }}
          title="Make this the active scene for the whole table — every connected player jumps to it"
        >
          <IconBroadcast />
          <span>
            {menu.id === activeId ? "Re-sync everyone to this scene" : "Set active for everyone"}
            {playerCount > 0 ? ` · ${playerCount} player${playerCount === 1 ? "" : "s"}` : ""}
          </span>
        </button>
        {menu.id !== activeId && (
          <button className="profile-row" onClick={() => { onSwitch(menu.id); setMenu(null); }}>
            <IconOpen />
            <span>Open scene</span>
          </button>
        )}
        <button className="profile-row" onClick={() => { onSetBackground(menu.id); setMenu(null); }}>
          <IconImage />
          <span>Set background…</span>
        </button>
        <button className="profile-row" onClick={() => { onSetMusic(menu.id); setMenu(null); }}>
          <IconNote />
          <span>{menuScene.data.audio ? "Replace ambient music…" : "Add ambient music…"}</span>
        </button>
        {menuScene.data.audio && (
          <button className="profile-row sub" onClick={() => { onClearMusic(menu.id); setMenu(null); }}>
            <IconX />
            <span>Remove music</span>
          </button>
        )}
        <button className="profile-row" onClick={() => { if (menu.id !== activeId) onSwitch(menu.id); onOpenSoundboard(); setMenu(null); }}>
          <IconBoard />
          <span>Soundboard…</span>
        </button>
        <button
          className="profile-row"
          onClick={() => {
            if (menu.id !== activeId) onSwitch(menu.id);
            onOpenSettings();
            setMenu(null);
          }}
        >
          <IconSliders />
          <span>Scene settings · atmosphere &amp; shaders…</span>
        </button>
        <div className="vtt2-scene-menu-foot">settings stay with this scene</div>
      </div>
    ) : null;

  return (
    <div className={"vtt2-scenerail" + (open ? " open" : "")}>
      <button className="vtt2-rail-toggle" onClick={() => setOpen((o) => !o)} title={open ? "Collapse the scene rail" : "Scenes"}>
        {open ? "›" : `Scenes · ${scenes.length}`}
      </button>
      {open && (
        <div className="vtt2-rail-panel">
          <button className="vtt2-rail-step" onClick={() => onStep(-1)} title="Previous scene">
            ▲
          </button>
          <div className="vtt2-rail-list" ref={listRef}>
            {scenes.map((s) => (
              <button
                key={s.id}
                className={"vtt2-rail-card" + (s.id === activeId ? " active" : "") + (s.data.audio ? " has-audio" : "")}
                onClick={() => s.id !== activeId && onSwitch(s.id)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setMenu({ id: s.id, y: e.clientY });
                }}
                title={`${s.name} — right-click for scene tools`}
              >
                <span className="vtt2-rail-init">{initials(s.name)}</span>
                <span className="vtt2-rail-name">{s.name}</span>
              </button>
            ))}
          </div>
          <button className="vtt2-rail-step" onClick={() => onStep(1)} title="Next scene">
            ▼
          </button>
        </div>
      )}
      {menuEl && createPortal(menuEl, document.body)}
    </div>
  );
}
