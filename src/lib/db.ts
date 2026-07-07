// SQLite access via tauri-plugin-sql. Only usable inside the desktop app;
// callers must gate on sqlAvailable() and fall back to localStorage otherwise.
import Database from "@tauri-apps/plugin-sql";
import { isTauri } from "./tauri";

const DB_URL = "sqlite:wte.db";
let dbPromise: Promise<Database> | null = null;

export function sqlAvailable(): boolean {
  return isTauri();
}

export function getDb(): Promise<Database> {
  if (!dbPromise) {
    dbPromise = (async () => {
      const db = await Database.load(DB_URL);
      await migrateFromLocalStorage(db);
      return db;
    })();
  }
  return dbPromise;
}

// One-time import of the Phase-1 localStorage campaigns into SQLite. Idempotent:
// runs only when the campaigns table is empty. localStorage is left intact as a backup.
async function migrateFromLocalStorage(db: Database): Promise<void> {
  try {
    const rows = await db.select<{ n: number }[]>("SELECT COUNT(*) AS n FROM campaigns");
    if ((rows[0]?.n ?? 0) > 0) return;
    const raw = localStorage.getItem("wte-campaigns");
    if (!raw) return;
    const list = JSON.parse(raw) as Array<{
      id: string;
      name: string;
      system?: string;
      createdAt: number;
      updatedAt: number;
      archived?: boolean;
    }>;
    for (const c of list) {
      await db.execute(
        "INSERT OR IGNORE INTO campaigns (id, name, system, created_at, updated_at, archived) VALUES ($1,$2,$3,$4,$5,$6)",
        [c.id, c.name, c.system ?? null, c.createdAt, c.updatedAt, c.archived ? 1 : 0]
      );
    }
  } catch {
    /* migration is best-effort — a fresh DB just starts empty */
  }
}
