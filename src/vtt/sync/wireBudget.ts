import { MAX_CHUNKED_PAYLOAD } from "../../net/chunking";
import type { VttScene } from "../types/scene";

/** Leave room for the protocol envelope and chunk headers. */
export const MAX_VTT_SNAPSHOT_CHARS = MAX_CHUNKED_PAYLOAD - 64 * 1024;

export function vttSnapshotChars(scene: VttScene): number {
  try {
    return JSON.stringify({ t: "snapshot", state: scene, rev: Number.MAX_SAFE_INTEGER }).length;
  } catch {
    return Infinity;
  }
}

export function vttSnapshotFits(scene: VttScene): boolean {
  return vttSnapshotChars(scene) <= MAX_VTT_SNAPSHOT_CHARS;
}
