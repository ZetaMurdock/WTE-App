import type { RollLock } from "../VttRollFeed";

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
