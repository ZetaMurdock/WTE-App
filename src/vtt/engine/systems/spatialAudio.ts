// Spatial sound: an emitter pinned to the world is heard by RANGE from the
// listener (a player's own token; the Curator's camera centre), and every wall
// crossed between them muffles it — quieter AND low-passed, like sound through
// stone. The mix math here is pure and unit-tested; the WebAudio graph that
// applies it (SpatialAudioEngine) is the thin wrapper below.
import type { VttEmitter, VttWall } from "../../types/scene";

/** "No filter": a lowpass parked above hearing range. */
export const OPEN_CUTOFF = 20000;

function segsCross(ax: number, ay: number, bx: number, by: number, cx: number, cy: number, dx: number, dy: number): boolean {
  const d1 = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  const d2 = (bx - ax) * (dy - ay) - (by - ay) * (dx - ax);
  const d3 = (dx - cx) * (ay - cy) - (dy - cy) * (ax - cx);
  const d4 = (dx - cx) * (by - cy) - (dy - cy) * (bx - cx);
  return d1 * d2 < 0 && d3 * d4 < 0;
}

/** How many walls the straight line source→listener crosses. */
export function wallsBetween(walls: VttWall[], ax: number, ay: number, bx: number, by: number): number {
  let n = 0;
  for (const w of walls) {
    if (w.blocksLight === false) continue; // see-through walls don't muffle either
    if (segsCross(ax, ay, bx, by, w.x1, w.y1, w.x2, w.y2)) n++;
  }
  return n;
}

export interface SpatialMix {
  /** 0..1 target gain. */
  gain: number;
  /** Lowpass cutoff in Hz (OPEN_CUTOFF = unmuffled). */
  cutoff: number;
}

/** The heard mix of one emitter at a listener position (world px). */
export function spatialMix(e: VttEmitter, lx: number, ly: number, walls: VttWall[], cellPx: number): SpatialMix {
  const r = Math.max(0.5, e.radius);
  const d = Math.hypot(e.x - lx, e.y - ly) / Math.max(1, cellPx);
  if (d >= r) return { gain: 0, cutoff: OPEN_CUTOFF };
  // Natural-feeling falloff: full at the source, gone at the edge, curved so
  // the last few cells fade fast (proximity^1.5 ≈ inverse-square-ish).
  let gain = Math.max(0, Math.min(1, e.volume)) * Math.pow(1 - d / r, 1.5);
  const n = wallsBetween(walls, e.x, e.y, lx, ly);
  gain *= Math.pow(0.5, n); // each wall halves what gets through
  const cutoff = n === 0 ? OPEN_CUTOFF : Math.max(240, 1100 / n); // and darkens it
  return { gain, cutoff };
}

// ── WebAudio wrapper ─────────────────────────────────────────────────────────

interface LiveEmitter {
  el: HTMLAudioElement;
  gain: GainNode;
  filter: BiquadFilterNode;
  src: string;
}

/** Owns one looping audio graph per emitter (element → lowpass → gain → out)
 *  and glides each toward its spatialMix on every sync. Autoplay-policy safe:
 *  a paused loop retries play() each sync, so audio starts on the first tick
 *  after the user has interacted with the page. */
export class SpatialAudioEngine {
  private ctx: AudioContext | null = null;
  private live = new Map<string, LiveEmitter>();

  sync(emitters: VttEmitter[], listener: { x: number; y: number } | null, walls: VttWall[], cellPx: number): void {
    // Tear down emitters that were removed or whose clip changed.
    for (const [id, n] of this.live) {
      const e = emitters.find((x) => x.id === id);
      if (e && e.src === n.src) continue;
      n.el.pause();
      n.el.src = "";
      try {
        n.gain.disconnect();
      } catch {
        /* already gone */
      }
      this.live.delete(id);
    }
    if (emitters.length === 0) return;
    const ctx = (this.ctx ??= new AudioContext());
    if (ctx.state === "suspended") void ctx.resume().catch(() => {});
    for (const e of emitters) {
      let n = this.live.get(e.id);
      if (!n) {
        const el = new Audio(e.src);
        el.loop = e.loop;
        const source = ctx.createMediaElementSource(el);
        const filter = ctx.createBiquadFilter();
        filter.type = "lowpass";
        filter.frequency.value = OPEN_CUTOFF;
        const gain = ctx.createGain();
        gain.gain.value = 0; // fade in from silence — no pop on placement
        source.connect(filter);
        filter.connect(gain);
        gain.connect(ctx.destination);
        n = { el, gain, filter, src: e.src };
        this.live.set(e.id, n);
      }
      n.el.loop = e.loop;
      if (n.el.paused && e.loop) void n.el.play().catch(() => {});
      const mix = listener ? spatialMix(e, listener.x, listener.y, walls, cellPx) : { gain: 0, cutoff: OPEN_CUTOFF };
      const t = ctx.currentTime;
      n.gain.gain.setTargetAtTime(mix.gain, t, 0.15);
      n.filter.frequency.setTargetAtTime(mix.cutoff, t, 0.15);
    }
  }

  destroy(): void {
    for (const n of this.live.values()) {
      n.el.pause();
      n.el.src = "";
      try {
        n.gain.disconnect();
      } catch {
        /* already gone */
      }
    }
    this.live.clear();
    void this.ctx?.close().catch(() => {});
    this.ctx = null;
  }
}
