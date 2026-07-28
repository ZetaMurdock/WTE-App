// SQLite access via tauri-plugin-sql. Only usable inside the desktop app;
// callers must gate on sqlAvailable() and fall back to localStorage otherwise.
import Database from "@tauri-apps/plugin-sql";
import { isTauri } from "./tauri";

const DB_URL = "sqlite:wte.db";
let dbPromise: Promise<Database> | null = null;

export function sqlAvailable(): boolean {
  return isTauri();
}

/**
 * The SQLite handle, opened once.
 *
 * Only a SUCCESSFUL open is cached. This used to assign dbPromise before the
 * promise settled, so a single failure — a locked file from a second instance, an
 * antivirus handle, a corrupt header — was memoized and every later read and
 * write in the process got the same rejection back with no retry and nothing
 * shown to the user. Roughly 26 call sites turn that rejection into an empty list,
 * so the app rendered as "you have no campaigns, characters, scenes or assets".
 *
 * Now a failure clears the cache, so the next call genuinely retries and a
 * transient lock recovers on its own.
 */
export function getDb(): Promise<Database> {
  if (!dbPromise) {
    dbPromise = (async () => {
      const db = await Database.load(DB_URL);
      await migrateFromLocalStorage(db);
      return db;
    })().catch((e) => {
      dbPromise = null;
      throw e;
    });
  }
  return dbPromise;
}

/** Set once the legacy campaign import has fully succeeded. */
const MIGRATED_FLAG = "wte-campaigns-migrated";

// One-time import of the Phase-1 localStorage campaigns into SQLite. localStorage
// is left intact as a backup.
//
// The old guard was `SELECT COUNT(*) FROM campaigns > 0`, which had two failure
// modes. One successful insert permanently disabled the migration, so if the loop
// died on entry three of ten, the remaining seven were never imported and never
// could be. And a single throw inside the one big try/catch aborted every
// remaining row silently.
//
// Now: a completion FLAG decides whether to run (so a campaign the user later
// deletes is not resurrected), each row is isolated so one bad entry cannot stop
// the others, and the flag is only set when every row landed — a partial run
// retries on the next launch.
async function migrateFromLocalStorage(db: Database): Promise<void> {
  try {
    if (localStorage.getItem(MIGRATED_FLAG) === "1") return;
    const raw = localStorage.getItem("wte-campaigns");
    if (!raw) {
      // Nothing to import; record that so we stop looking every boot.
      try {
        localStorage.setItem(MIGRATED_FLAG, "1");
      } catch {
        /* a full quota just means we check again next launch */
      }
      return;
    }
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return;
    const list = parsed as Array<{
      id?: string;
      name?: string;
      system?: string;
      createdAt?: number;
      updatedAt?: number;
      archived?: boolean;
    }>;

    let failed = 0;
    for (const c of list) {
      if (!c || typeof c.id !== "string" || !c.id) {
        failed++;
        continue;
      }
      try {
        // INSERT OR IGNORE keeps this safe to re-run for rows already present.
        await db.execute(
          "INSERT OR IGNORE INTO campaigns (id, name, system, created_at, updated_at, archived) VALUES ($1,$2,$3,$4,$5,$6)",
          [
            c.id,
            typeof c.name === "string" ? c.name : "Untitled campaign",
            c.system ?? null,
            typeof c.createdAt === "number" ? c.createdAt : Date.now(),
            typeof c.updatedAt === "number" ? c.updatedAt : Date.now(),
            c.archived ? 1 : 0,
          ]
        );
      } catch {
        // One unimportable row must not cost the rest; leave the flag unset so
        // the next launch tries again.
        failed++;
      }
    }
    if (failed === 0) {
      try {
        localStorage.setItem(MIGRATED_FLAG, "1");
      } catch {
        /* retry next launch */
      }
    }
  } catch {
    /* a fresh DB just starts empty; the flag stays unset so this retries */
  }
}
