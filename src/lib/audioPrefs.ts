// Master volume — ONE slider scaling everything the app plays: scene music,
// table soundboard sfx, and spatial emitters. Per-device (localStorage), with
// live subscribers so moving the slider retunes audio that's already playing.

const KEY = "wte-master-volume";

function load(): number {
  try {
    const v = parseFloat(localStorage.getItem(KEY) ?? "");
    return Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 1;
  } catch {
    return 1;
  }
}

let vol = load();
const subs = new Set<(v: number) => void>();

export function getMasterVolume(): number {
  return vol;
}

export function setMasterVolume(v: number): void {
  vol = Math.max(0, Math.min(1, Number.isFinite(v) ? v : 1));
  try {
    localStorage.setItem(KEY, String(vol));
  } catch {
    /* not persisted — still applies for this session */
  }
  for (const cb of subs) cb(vol);
}

export function subscribeMasterVolume(cb: (v: number) => void): () => void {
  subs.add(cb);
  return () => {
    subs.delete(cb);
  };
}
