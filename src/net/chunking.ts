// Large-message chunking for data channels. SCTP kills messages past the
// negotiated maxMessageSize (~64KB is the safe cross-browser floor) — and in
// several browsers an oversized send KILLS THE WHOLE CHANNEL. A scene snapshot
// carrying a base64 map background is easily multi-MB, which is exactly how
// "players see nothing after the host loads a scene" happened.
//
// Frames: small payloads pass through untouched (raw JSON, backward
// compatible). Big ones are split into ordered frames:
//   @@c|<id>|<index>|<total>|<slice>
// and reassembled per sender. Data channels are ordered+reliable by default,
// so a simple accumulator suffices.

export const CHUNK_SIZE = 45_000; // chars — safely under the 64KB floor
const TAG = "@@c|";

export function frameChunks(payload: string, chunkSize = CHUNK_SIZE): string[] {
  if (payload.length <= chunkSize) return [payload];
  const id = Math.random().toString(36).slice(2, 10);
  const total = Math.ceil(payload.length / chunkSize);
  const frames: string[] = [];
  for (let i = 0; i < total; i++) {
    frames.push(TAG + id + "|" + i + "|" + total + "|" + payload.slice(i * chunkSize, (i + 1) * chunkSize));
  }
  return frames;
}

interface Pending {
  total: number;
  got: number;
  parts: string[];
  at: number;
}

/** Per-connection reassembler. Feed every incoming frame; returns the complete
 *  payload when one finishes, else null. Stale partials are dropped after 30s
 *  (a peer that died mid-send must not leak buffers forever). */
export class ChunkAssembler {
  private pending = new Map<string, Pending>();

  feed(raw: string, now = Date.now()): string | null {
    if (!raw.startsWith(TAG)) return raw; // small message — passes straight through
    const p1 = raw.indexOf("|", TAG.length);
    const p2 = raw.indexOf("|", p1 + 1);
    const p3 = raw.indexOf("|", p2 + 1);
    if (p1 < 0 || p2 < 0 || p3 < 0) return null; // malformed frame
    const id = raw.slice(TAG.length, p1);
    const idx = parseInt(raw.slice(p1 + 1, p2), 10);
    const total = parseInt(raw.slice(p2 + 1, p3), 10);
    if (!Number.isFinite(idx) || !Number.isFinite(total) || total <= 0 || idx < 0 || idx >= total) return null;

    // opportunistic stale cleanup
    for (const [k, v] of this.pending) if (now - v.at > 30_000) this.pending.delete(k);

    let entry = this.pending.get(id);
    if (!entry) {
      entry = { total, got: 0, parts: new Array<string>(total), at: now };
      this.pending.set(id, entry);
    }
    if (entry.parts[idx] === undefined) {
      entry.parts[idx] = raw.slice(p3 + 1);
      entry.got++;
      entry.at = now;
    }
    if (entry.got === entry.total) {
      this.pending.delete(id);
      return entry.parts.join("");
    }
    return null;
  }
}
