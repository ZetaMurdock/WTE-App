// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";

// The gate exists to stop ONE thing: a schema upgrade running after the backup
// that was supposed to make it reversible failed. So the tests are about whether
// Database.load is reached, not about what the message says.

let gateAnswer: unknown = { ok: true, reason: null, backup_dir: "C:/x", schema_version: 5 };
let gateThrows = false;
let gateHangs = false;
let loads = 0;

vi.mock("@tauri-apps/api/core", () => ({
  invoke: async (cmd: string) => {
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

const { getDb, probeMigrationGate, lastMigrationGate, BackupRequiredError, __resetDbForTests } = await import("./db");

beforeEach(() => {
  loads = 0;
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

describe("the gate never becomes its own failure", () => {
  it("opens the database when the build has no such command", async () => {
    gateThrows = true;
    await getDb();
    expect(loads).toBe(1);
  });

  it("gives up on an unresponsive gate instead of hanging the boot screen", async () => {
    vi.useFakeTimers();
    gateHangs = true;
    const p = probeMigrationGate();
    await vi.advanceTimersByTimeAsync(5000);
    expect(await p).toBeNull();
    vi.useRealTimers();
  });

  it("reports null rather than throwing when the command is missing", async () => {
    gateThrows = true;
    expect(await probeMigrationGate()).toBeNull();
  });
});

describe("the last answer is available to diagnostics", () => {
  it("remembers the verdict without asking again", async () => {
    gateAnswer = { ok: false, reason: "disk full", schema_version: 5 };
    await probeMigrationGate();
    expect(lastMigrationGate()).toMatchObject({ ok: false, reason: "disk full" });
  });
});
