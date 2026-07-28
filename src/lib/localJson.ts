// Guarded localStorage access.
//
// The pattern this replaces, found at ~20 sites: read a key, JSON.parse it, and on
// any failure return [] or {}. The UI shows that emptiness as real data, then the
// next edit does read-then-write and the original bytes are gone. campaignDesk was
// the archetype — one malformed byte and the next keystroke destroyed every desk
// note and the whole campaign calendar, with no error shown.
//
// Three rules here, each fixing a distinct failure:
//
// 1. ABSENT IS NOT CORRUPT. A missing key means "first run" and returns the
//    fallback quietly. Only a key that HAS content which cannot be parsed is
//    corrupt. Conflating the two is why a fresh install and a damaged one looked
//    identical.
//
// 2. CORRUPT CONTENT IS QUARANTINED, NOT OVERWRITTEN. The unreadable text is moved
//    to `<key>.corrupt.<timestamp>` before anything else happens, so the bytes
//    survive for recovery and the inevitable later write cannot destroy them. The
//    user is told.
//
// 3. WRITES REPORT FAILURE. Every one of these sites swallowed the exception while
//    returning the new value, so a full quota rendered as a successful save. The
//    write result now says whether it landed.
import { pushToast } from "./appToast";

export interface ReadResult<T> {
  value: T;
  /** True only when the key held content that could not be parsed. */
  corrupt: boolean;
  /** Where the unreadable text was moved to, if it was quarantined. */
  quarantinedAs?: string;
}

export interface WriteResult {
  ok: boolean;
  error?: string;
}

/** Quarantine key for damaged content. Timestamped so repeated damage does not
 *  overwrite an earlier rescue. */
function quarantineKey(key: string, now: number): string {
  return `${key}.corrupt.${now}`;
}

/**
 * Read and parse a JSON key.
 *
 * `validate` is optional but recommended: a value that parses as JSON but is the
 * wrong SHAPE (an object where an array belongs) is just as destructive as one that
 * does not parse, because the UI renders it as empty all the same.
 */
export function readJson<T>(
  key: string,
  fallback: T,
  opts?: { validate?: (v: unknown) => boolean; label?: string; now?: number }
): ReadResult<T> {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(key);
  } catch {
    // Storage disabled entirely; nothing to lose and nothing to warn about.
    return { value: fallback, corrupt: false };
  }
  // Absent, or explicitly empty — a genuine "nothing here yet".
  if (raw === null || raw === "") return { value: fallback, corrupt: false };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return quarantine(key, raw, fallback, opts);
  }
  if (opts?.validate && !opts.validate(parsed)) {
    return quarantine(key, raw, fallback, opts);
  }
  return { value: parsed as T, corrupt: false };
}

function quarantine<T>(
  key: string,
  raw: string,
  fallback: T,
  opts?: { label?: string; now?: number }
): ReadResult<T> {
  const now = opts?.now ?? Date.now();
  const qk = quarantineKey(key, now);
  let saved = false;
  try {
    // Only quarantine once — if a copy is already there, the damage was already
    // rescued on a previous read and re-copying would overwrite the good rescue
    // with whatever is there now.
    if (localStorage.getItem(qk) === null) {
      localStorage.setItem(qk, raw);
    }
    saved = true;
  } catch {
    // Quota full. We cannot rescue the bytes, so we must NOT let a later write
    // replace them: leaving the original key untouched is the best available
    // outcome, and the caller still gets the fallback to render.
    saved = false;
  }
  if (saved) {
    // Heal the original key so later reads are clean. Without this, every read of
    // a damaged key would quarantine again under a fresh timestamp — filling
    // storage with copies and re-toasting the user on every render.
    try {
      localStorage.setItem(key, JSON.stringify(fallback));
    } catch {
      /* the rescue already succeeded, which is what matters */
    }
  }
  const what = opts?.label ?? key;
  pushToast(
    saved
      ? `Couldn't read your ${what} — the damaged copy was kept as "${qk}" so nothing was lost.`
      : `Couldn't read your ${what}, and there was no room to keep a copy. Free up space before making changes.`,
    "error",
    14000
  );
  return { value: fallback, corrupt: true, quarantinedAs: saved ? qk : undefined };
}

/** Write a JSON value, reporting whether it actually landed. */
export function writeJson(key: string, value: unknown, opts?: { label?: string; silent?: boolean }): WriteResult {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const quota = /quota|exceed/i.test(msg);
    if (!opts?.silent) {
      pushToast(
        quota
          ? `Couldn't save your ${opts?.label ?? key} — this device's storage for W.T.E is full.`
          : `Couldn't save your ${opts?.label ?? key}: ${msg}`,
        "error",
        14000
      );
    }
    return { ok: false, error: msg };
  }
}

/** Remove a key, reporting failure. */
export function removeJson(key: string): WriteResult {
  try {
    localStorage.removeItem(key);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Every quarantined copy currently on this device, newest first — for the
 *  diagnostics screen, so a user can find and recover damaged data. */
export function listQuarantined(): { key: string; original: string; at: number; bytes: number }[] {
  const out: { key: string; original: string; at: number; bytes: number }[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k) continue;
      const m = /^(.*)\.corrupt\.(\d+)$/.exec(k);
      if (!m) continue;
      out.push({ key: k, original: m[1], at: Number(m[2]), bytes: (localStorage.getItem(k) ?? "").length });
    }
  } catch {
    /* storage unavailable */
  }
  return out.sort((a, b) => b.at - a.at);
}

/** Common validators, so callers do not each hand-roll a shape check. */
export const isArray = (v: unknown): boolean => Array.isArray(v);
export const isRecord = (v: unknown): boolean => typeof v === "object" && v !== null && !Array.isArray(v);
