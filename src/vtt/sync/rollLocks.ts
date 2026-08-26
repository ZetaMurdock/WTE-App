// Straight from where the type now lives. Going through `VttRollFeed`'s
// re-export made this pure store module name a React component as its
// dependency — erased at build, but a needless edge in the module graph.
import type { RollLock } from "../rollCommit";

/** Curator requests take priority and ordinary choices replace stale ordinary
 * locks instead of becoming invisible entries behind them. */
export function enqueueRollLock(current: RollLock[], lock: RollLock): RollLock[] {
  if (lock.requestId) {
    if (current.some((item) => item.requestId === lock.requestId)) return current;
    return [lock, ...current];
  }
  const requests = current.filter((item) => item.requestId);
  return requests.length ? [...requests, lock] : [lock];
}

/** Answering, discarding or expiring a request removes THAT request — never
 * whatever happens to be at the head. The roll prompt shows every outstanding
 * request at once, so a player can legitimately answer the second of three;
 * slicing the head would have settled the wrong one and left the answered
 * request armed forever. */
export function dequeueRollLock(current: RollLock[], lock: RollLock): RollLock[] {
  if (lock.requestId) return current.filter((item) => item.requestId !== lock.requestId);
  const index = current.indexOf(lock);
  if (index < 0) return current;
  return [...current.slice(0, index), ...current.slice(index + 1)];
}
