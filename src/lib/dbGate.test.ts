// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";

// The gate exists to stop ONE thing: a schema upgrade running after the backup
// that was supposed to make it reversible failed. So the tests are about whether
// Database.load is reached, not about what the message says.

let gateAnswer: unknown = { ok: true, reason: null, backup_dir: "C:/x", schema_version: 5 };
let retryAnswer: unknown = { ok: true, reason: null, schema_version: 5 };
let gateThrows = false;
let gateHangs = false;
let loads = 0;
let retried = 0;

vi.mock("@tauri-apps/api/core", () => ({
  invoke: async (cmd: string) => {
    if (cmd === "wte_retry_backup") {
      retried++;
      return retryAnswer;
    }
    if (cmd !== "wte_migration_gate") throw new Error("unexpected command " + cmd);
    if (gateThrows) throw new Error("command not found");
    if (gateHangs) return new Promise(() => {});
    return gateAnswer;
  },
}));

vi.mock("@tauri-apps/plugin-sql", () => ({
  default: {
    load: async () => {
      loads++;
      return {
        select: async () => [],
        execute: async () => ({ rowsAffected: 0 }),
      };
    },
  },
}));

vi.mock("./tauri", () => ({ isTauri: () => true }));

const { getDb, probeMigrationGate, retryBackup, lastMigrationGate, BackupRequiredError, __resetDbForTests } =
  await import("./db");

beforeEach(() => {
  loads = 0;
  retried = 0;
  retryAnswer = { ok: true, reason: null, schema_version: 5 };
  gateThrows = false;
  gateHangs = false;
  gateAnswer = { ok: true, reason: null, backup_dir: "C:/x", schema_version: 5 };
  __resetDbForTests();
  localStorage.setItem("wte-campaigns-migrated", "1");
});

describe("a failed backup stops the upgrade", () => {
  it("does not open the database when the gate is closed", async () => {
    gateAnswer = { ok: false, reason: "the copy of wte.db-wal is 0 bytes but the original is 40960", schema_version: 5 };
    await expect(getDb()).rejects.toBeInstanceOf(BackupRequiredError);
    // The point of the whole mechanism: loading is what migrates.
    expect(loads).toBe(0);
  });

  it("carries the reason through to something a person can read", async () => {
    gateAnswer = { ok: false, reason: "Another copy of W.T.E is starting up or backing up.", schema_version: 5 };
    await expect(getDb()).rejects.toThrow(/Another copy of W\.T\.E/);
    await expect(getDb()).rejects.toThrow(/Nothing has been changed/);
  });

  it("opens normally when the backup succeeded", async () => {
    await getDb();
    expect(loads).toBe(1);
  });

  it("retries rather than memoizing the refusal", async () => {
    // The failure is usually "close your other window", which the user can fix
    // without restarting. A cached rejection would make the fix do nothing.
    gateAnswer = { ok: false, reason: "busy", schema_version: 5 };
    await expect(getDb()).rejects.toThrow();
    gateAnswer = { ok: true, reason: null, schema_version: 5 };
    await getDb();
    expect(loads).toBe(1);
  });
});

describe("not getting an answer is not permission to proceed", () => {
  it("refuses to open the database when the gate command errors", async () => {
    // Inside the desktop app this command always exists, so an error means the
    // shell and the frontend disagree about what build this is — the worst
    // possible moment to apply an irreversible migration.
    gateThrows = true;
    await expect(getDb()).rejects.toBeInstanceOf(BackupRequiredError);
    expect(loads).toBe(0);
  });

  it("refuses to open the database when the gate never answers", async () => {
    vi.useFakeTimers();
    gateHangs = true;
    const p = getDb();
    const assertion = expect(p).rejects.toBeInstanceOf(BackupRequiredError);
    await vi.advanceTimersByTimeAsync(15000);
    await assertion;
    expect(loads).toBe(0);
    vi.useRealTimers();
  });

  it("reports a closed gate, not null, when the command is missing", async () => {
    gateThrows = true;
    const g = await probeMigrationGate();
    expect(g).toMatchObject({ ok: false, state: "unavailable" });
  });

  it("says something a person can act on when it times out", async () => {
    vi.useFakeTimers();
    gateHangs = true;
    const p = probeMigrationGate();
    await vi.advanceTimersByTimeAsync(15000);
    expect((await p)?.reason).toMatch(/did not answer/i);
    vi.useRealTimers();
  });
});

describe("try again actually tries again", () => {
  it("runs the backup rather than re-reading the old verdict", async () => {
    gateAnswer = { ok: false, reason: "busy", schema_version: 5 };
    expect((await probeMigrationGate())?.ok).toBe(false);
    // The user closed the other window; the retry must reach Rust again.
    retryAnswer = { ok: true, reason: null, has_restore_point: true, state: "created", schema_version: 5 };
    const g = await retryBackup();
    expect(g?.ok).toBe(true);
    expect(retried).toBe(1);
  });

  it("reports a still-closed gate honestly", async () => {
    retryAnswer = { ok: false, reason: "still busy", schema_version: 5 };
    expect((await retryBackup())?.ok).toBe(false);
  });
});

describe("a restore point is reported, never assumed", () => {
  it("passes through the fact that no copy exists", async () => {
    gateAnswer = { ok: true, reason: null, has_restore_point: false, state: "already-migrated", schema_version: 5 };
    const g = await probeMigrationGate();
    expect(g).toMatchObject({ ok: true, has_restore_point: false, state: "already-migrated" });
  });
});

describe("the last answer is available to diagnostics", () => {
  it("remembers the verdict without asking again", async () => {
    gateAnswer = { ok: false, reason: "disk full", schema_version: 5 };
    await probeMigrationGate();
    expect(lastMigrationGate()).toMatchObject({ ok: false, reason: "disk full" });
  });
});
