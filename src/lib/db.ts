// SQLite access via tauri-plugin-sql. Only usable inside the desktop app;
// callers must gate on sqlAvailable() and fall back to localStorage otherwise.
import Database from "@tauri-apps/plugin-sql";
import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "./tauri";

const DB_URL = "sqlite:wte.db";
let dbPromise: Promise<Database> | null = null;

export function sqlAvailable(): boolean {
  return isTauri();
}

export interface MigrationGate {
  ok: boolean;
  reason?: string | null;
  backup_dir?: string | null;
  /** Whether a copy to go back to actually exists. Distinct from `ok`: a fresh
   *  install is fine to open and has nothing to restore. */
  has_restore_point?: boolean;
  /** Which branch the startup check took, for Diagnostics. */
  state?: string;
  schema_version: number;
}

/** The last gate answer, so Diagnostics can show it without re-asking. */
let lastGate: MigrationGate | null = null;
export function lastMigrationGate(): MigrationGate | null {
  return lastGate;
}

/** Thrown instead of opening a database this build would irreversibly upgrade. */
export class BackupRequiredError extends Error {
  constructor(
    readonly reason: string,
    readonly schemaVersion: number
  ) {
    super(
      "W.T.E did not open your data, because it could not first make a backup copy of it. " +
        reason +
        " Nothing has been changed. Close every W.T.E window and start the app again."
    );
    this.name = "BackupRequiredError";
  }
}

/**
 * Ask Rust whether the pre-upgrade backup succeeded, and refuse to continue if not.
 *
 * Loading the database is what applies the schema migration, and a v5 database
 * cannot be opened by a build that only knows v4 — so the last moment a backup is
 * worth anything is before this call. The old routine reported failures to stderr
 * and let the migration run anyway, which is a backup in name only.
 *
 * FAILS CLOSED. An earlier version treated a missing or erroring command as
 * permission to proceed, on the grounds that refusing to start is worse than the
 * problem being guarded against. That reasoning is wrong here: inside the desktop
 * app the command is always present, so an error means the shell and the frontend
 * disagree about what this build is — which is exactly when you least want to
 * apply an irreversible migration. Outside Tauri there is no database to protect
 * and the check does not apply at all.
 */
async function checkMigrationGate(): Promise<void> {
  if (!isTauri()) return;
  const gate = await askGate();
  if (!gate.ok) throw new BackupRequiredError(gate.reason || "The backup could not be verified.", gate.schema_version);
}

/** How long to wait for a verdict. The backup itself does not run inside this
 *  call, so an answer is a lookup — seconds, not minutes. */
const GATE_TIMEOUT_MS = 15000;

const failedGate = (reason: string): MigrationGate => ({
  ok: false,
  reason,
  has_restore_point: false,
  state: "unavailable",
  schema_version: 0,
});

/** Ask Rust, and turn every way of not getting an answer into a closed gate. */
async function askGate(command = "wte_migration_gate"): Promise<MigrationGate> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const gate = await Promise.race([
      invoke<MigrationGate>(command),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), GATE_TIMEOUT_MS);
      }),
    ]);
    if (!gate) {
      return failedGate("W.T.E did not answer when asked whether your data had been backed up.");
    }
    lastGate = gate;
    return gate;
  } catch (e) {
    return failedGate(
      `W.T.E could not check whether your data had been backed up (${e instanceof Error ? e.message : String(e)}).`
    );
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Ask the gate directly, for the boot screen.
 *
 * Returns null only when the question does not apply — outside the desktop app,
 * where there is no database of ours to migrate. Every other outcome, including
 * silence, is a real verdict.
 */
export async function probeMigrationGate(): Promise<MigrationGate | null> {
  if (!isTauri()) return null;
  return askGate();
}

/**
 * Run the backup again and return the new verdict.
 *
 * "Try again" used to re-read the verdict recorded at startup, which could only
 * ever say the same thing — so the button did nothing, and the usual cause (a
 * second W.T.E window, since closed) could not be fixed without a restart.
 */
export async function retryBackup(): Promise<MigrationGate | null> {
  if (!isTauri()) return null;
  return askGate("wte_retry_backup");
}

/** Test seam: forget the cached handle and the last gate answer. */
export function __resetDbForTests(): void {
  dbPromise = null;
  lastGate = null;
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
      // Before the handle exists, because opening it is what migrates it.
      await checkMigrationGate();
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
