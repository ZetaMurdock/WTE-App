import { useEffect, useState } from "react";

// First-launch welcome. The app assumes you already know W.T.E — a stranger
// downloading it does not. Four cards: what this is, the two roles, how to make
// a character, how to play together. Shown once; reopenable from Profile → Help.
const KEY = "wte-seen-intro";

export function hasSeenIntro(): boolean {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return true; // no storage → don't nag
  }
}
export function markIntroSeen(): void {
  try {
    localStorage.setItem(KEY, "1");
  } catch {
    /* ignore */
  }
}
/** Let the user pull the guide back up (Profile menu). */
export function replayIntro(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new CustomEvent("wte-show-intro"));
}

const STEPS: { title: string; body: string; hint: string }[] = [
  {
    title: "Welcome to W.T.E",
    body: "Wonderland of the Enigma is a tabletop RPG toolkit: a character vault, a rules Codex, and a virtual tabletop with fog of war, lighting, spatial sound and cinematic effects. Everything is stored on your own computer.",
    hint: "You can play solo at your desk, or together over the internet — no server or subscription needed.",
  },
  {
    title: "Curator or player",
    body: "One person is the Curator (the game master). They build scenes, place walls and lights, spawn creatures, and direct what everyone sees. Everyone else is a player: they control one token and roll dice.",
    hint: "You're the Curator by default. You only become a player by joining someone else's room in the Lobby.",
  },
  {
    title: "Start with a campaign and a character",
    body: "On the Dashboard, create a campaign — it holds your characters, scenes and encounters. Then open Sheet → New Character and walk the builder: species, background, paradigm, attributes.",
    hint: "In a hurry? The New Character menu can randomize a whole Inquisitor for you.",
  },
  {
    title: "Play together",
    body: "Open the VTT tab to build a scene and drop tokens. To play online, go to Lobby, set a signaling server once, then host a room and share the code. Players join with that code and see your map live.",
    hint: "Assign each player's token to them (click the token → Owner) so fog and movement work per-person.",
  },
];

export function FirstRun() {
  const [open, setOpen] = useState(() => !hasSeenIntro());
  const [step, setStep] = useState(0);

  // allow re-opening from elsewhere in the app (Profile → How to play)
  useEffect(() => {
    const on = () => {
      setStep(0);
      setOpen(true);
    };
    window.addEventListener("wte-show-intro", on);
    return () => window.removeEventListener("wte-show-intro", on);
  }, []);

  if (!open) return null;
  const s = STEPS[step];
  const last = step === STEPS.length - 1;

  function close() {
    markIntroSeen();
    setOpen(false);
  }

  return (
    <div className="intro-overlay" onMouseDown={close}>
      <div className="intro-card" onMouseDown={(e) => e.stopPropagation()}>
        <div className="intro-dots">
          {STEPS.map((_, i) => (
            <span key={i} className={"intro-dot" + (i === step ? " on" : "")} />
          ))}
        </div>
        <h2 className="intro-title">{s.title}</h2>
        <p className="intro-body">{s.body}</p>
        <p className="intro-hint">{s.hint}</p>
        <div className="intro-actions">
          <button className="ghost-btn" onClick={close}>
            Skip
          </button>
          <div style={{ display: "flex", gap: 8 }}>
            {step > 0 && (
              <button className="ghost-btn" onClick={() => setStep((v) => v - 1)}>
                Back
              </button>
            )}
            <button className="primary-btn" onClick={() => (last ? close() : setStep((v) => v + 1))}>
              {last ? "Start playing" : "Next"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
