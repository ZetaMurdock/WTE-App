import type { VttScene } from "./types/scene";

interface Props {
  scenes: VttScene[];
  activeId: string | null;
  onSwitch: (id: string) => void;
}

/** Short initials for a scene dot — the significant part after any "·" separator. */
function initials(name: string): string {
  const last = (name.split("·").pop() || name).trim();
  const words = last.split(/\s+/).filter(Boolean);
  if (words.length >= 2) return (words[0][0] + words[words.length - 1][0]).toUpperCase();
  return last.slice(0, 2).toUpperCase();
}

// The Scene Wheel (right edge, Curator-only): one dot per scene in the campaign;
// click a dot to traverse to that scene. The full name flies out on hover.
export function VttSceneWheel({ scenes, activeId, onSwitch }: Props) {
  if (scenes.length === 0) return null;
  return (
    <div className="vtt2-scenewheel">
      {scenes.map((s) => (
        <button
          key={s.id}
          className={"vtt2-wheel-dot" + (s.id === activeId ? " active" : "")}
          data-name={s.name}
          title={s.name}
          onClick={() => s.id !== activeId && onSwitch(s.id)}
        >
          {initials(s.name)}
        </button>
      ))}
    </div>
  );
}
