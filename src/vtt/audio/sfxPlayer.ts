// Receives the Curator's soundboard over netplay. Clip BYTES (data URLs) ride
// the chunked transport the FIRST time a clip plays this session and are cached
// by id — repeats are a tiny {action, id} message. The audio factory is
// injectable so the cache/lifecycle logic is unit-testable without DOM Audio.

export interface SfxAudio {
  play(): unknown;
  pause(): void;
  loop: boolean;
  volume: number;
  onended: (() => void) | null;
}

export interface SfxMsg {
  action: "play" | "loop" | "stop" | "stopall";
  id: string;
  uri?: string;
  volume?: number;
}

export class SfxPlayer {
  private cache = new Map<string, string>();
  private live = new Map<string, SfxAudio>();

  constructor(private make: (uri: string) => SfxAudio = (uri) => new Audio(uri) as unknown as SfxAudio) {}

  apply(msg: SfxMsg): void {
    if (msg.uri) this.cache.set(msg.id, msg.uri);
    if (msg.action === "stopall") {
      for (const a of this.live.values()) a.pause();
      this.live.clear();
      return;
    }
    if (msg.action === "stop") {
      const a = this.live.get(msg.id);
      if (a) {
        a.pause();
        this.live.delete(msg.id);
      }
      return;
    }
    const uri = this.cache.get(msg.id);
    if (!uri) return; // bytes never arrived — nothing to play
    this.live.get(msg.id)?.pause(); // re-trigger restarts the clip
    const a = this.make(uri);
    a.loop = msg.action === "loop";
    a.volume = Math.max(0, Math.min(1, msg.volume ?? 0.8));
    a.onended = () => {
      if (!a.loop) this.live.delete(msg.id);
    };
    void a.play();
    this.live.set(msg.id, a);
  }

  stopAll(): void {
    this.apply({ action: "stopall", id: "" });
  }
  has(id: string): boolean {
    return this.cache.has(id);
  }
  get playing(): number {
    return this.live.size;
  }
}
