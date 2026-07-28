// Campaign-scoped storage in SQLite, and the one-way migration off localStorage.
//
// Why this exists: localStorage lives in the webview's profile directory, not
// beside wte.db. Copy the database to a new machine, or restore it from a backup,
// and the campaign arrived stripped of its rules, desk notes, calendar, folder
// trees, custom armory and Codex page visibility. The campaign row was there; most
// of what made it a campaign was not.
//
// Two guarantees shape the design:
//
//  - MIGRATION NEVER DESTROYS THE SOURCE. localStorage is read and copied, never
//    cleared. If anything here is wrong, the original is still on disk and the
//    migration can be re-run after a fix.
//  - IT IS RESUMABLE. Each key records its own completion. A key that fails leaves
//    its marker unset and is retried next launch, instead of one bad entry
//    stranding the rest — the bug the old campaign migration had, where a single
//    successful insert permanently disabled the whole thing.
import { getDb, sqlAvailable } from "./db";
import { readJson } from "./localJson";

/** Namespaces within a campaign's key-value store. */
export type KvScope = "desk" | "folders" | "armory" | "pagemeta" | "misc";

interface KvRow {
  campaign_id: string;
  scope: string;
  key: string;
  value: string;
  updated_at: number;
}

/** Read one campaign-scoped value. Returns null when absent — the caller decides
 *  what "absent" means, exactly as with localJson. */
export async function kvGet<T>(campaignId: string, scope: KvScope, key: string): Promise<T | null> {
  if (!sqlAvailable()) return null;
  const db = await getDb();
  const rows = await db.select<KvRow[]>(
    "SELECT * FROM campaign_kv WHERE campaign_id = $1 AND scope = $2 AND key = $3",
    [campaignId, scope, key]
  );
  if (!rows.length) return null;
  try {
    return JSON.parse(rows[0].value) as T;
  } catch {
    // Damaged blob. Do NOT return a blank that a later write would persist over —
    // null means "nothing usable", and the caller falls back without overwriting.
    return null;
  }
}

/** Write one campaign-scoped value. */
export async function kvSet(campaignId: string, scope: KvScope, key: string, value: unknown): Promise<void> {
  if (!sqlAvailable()) return;
  const db = await getDb();
  await db.execute(
    "INSERT OR REPLACE INTO campaign_kv (campaign_id, scope, key, value, updated_at) VALUES ($1,$2,$3,$4,$5)",
    [campaignId, scope, key, JSON.stringify(value), Date.now()]
  );
}

/** Every value in one scope for a campaign — used by the package exporter. */
export async function kvAll(campaignId: string, scope?: KvScope): Promise<{ scope: string; key: string; value: unknown }[]> {
  if (!sqlAvailable()) return [];
  const db = await getDb();
  const rows = scope
    ? await db.select<KvRow[]>("SELECT * FROM campaign_kv WHERE campaign_id = $1 AND scope = $2", [campaignId, scope])
    : await db.select<KvRow[]>("SELECT * FROM campaign_kv WHERE campaign_id = $1", [campaignId]);
  return rows.map((r) => {
    let value: unknown = null;
    try {
      value = JSON.parse(r.value);
    } catch {
      value = null;
    }
    return { scope: r.scope, key: r.key, value };
  });
}

export async function kvDelete(campaignId: string, scope: KvScope, key: string): Promise<void> {
  if (!sqlAvailable()) return;
  const db = await getDb();
  await db.execute("DELETE FROM campaign_kv WHERE campaign_id = $1 AND scope = $2 AND key = $3", [
    campaignId,
    scope,
    key,
  ]);
}

// ── Migration off localStorage ────────────────────────────────────────────────

/** Per-key completion markers, so a partial run resumes rather than restarts. */
const MIGRATED_PREFIX = "wte-kv-migrated:";

function markerKey(campaignId: string, scope: KvScope, key: string): string {
  return `${MIGRATED_PREFIX}${campaignId}:${scope}:${key}`;
}

function alreadyMigrated(campaignId: string, scope: KvScope, key: string): boolean {
  try {
    return localStorage.getItem(markerKey(campaignId, scope, key)) === "1";
  } catch {
    return false;
  }
}

function markMigrated(campaignId: string, scope: KvScope, key: string): void {
  try {
    localStorage.setItem(markerKey(campaignId, scope, key), "1");
  } catch {
    /* unmarked simply means it is attempted again next launch, which is safe */
  }
}

/** One localStorage key to copy into the campaign store. */
interface Move {
  scope: KvScope;
  /** The key inside the campaign store. */
  key: string;
  /** The localStorage key, given the campaign id. */
  from: (campaignId: string) => string;
}

/** What travels with a campaign. Deliberately excludes genuinely device-local
 *  preferences — theme, cursor style, wallpaper, window state, the last open tab,
 *  the signaling/TURN config — which SHOULD stay per-device and would be wrong to
 *  carry to another machine. */
const MOVES: Move[] = [
  { scope: "desk", key: "notes", from: (c) => `wte-desk-notes:${c}` },
  { scope: "desk", key: "calendar", from: (c) => `wte-desk-cal:${c}` },
  { scope: "folders", key: "characters", from: (c) => `wte-char-folders:${c}` },
  { scope: "folders", key: "notes-inquisitor", from: (c) => `wte-note-folders:inquisitor:${c}` },
  { scope: "folders", key: "notes-unit", from: (c) => `wte-note-folders:unit:${c}` },
  { scope: "folders", key: "notes-curator", from: (c) => `wte-note-folders:curator:${c}` },
];

/** Keys that are global rather than per-campaign, copied once under a reserved id
 *  so they still travel inside a database backup. */
const GLOBAL_ID = "__global__";
const GLOBAL_MOVES: Move[] = [
  { scope: "armory", key: "weapons", from: () => "wte-armory-weapons" },
  { scope: "armory", key: "gear", from: () => "wte-armory-gear" },
  { scope: "pagemeta", key: "meta", from: () => "wte-page-meta" },
];

export interface MigrationReport {
  copied: string[];
  skipped: string[];
  failed: { key: string; error: string }[];
}

/**
 * Copy campaign data out of localStorage into SQLite.
 *
 * Safe to call on every launch and for every campaign: each key is copied at most
 * once, an absent source is nothing to do, and the source is never cleared.
 */
export async function migrateCampaignToDb(campaignId: string): Promise<MigrationReport> {
  const report: MigrationReport = { copied: [], skipped: [], failed: [] };
  if (!sqlAvailable() || !campaignId) return report;

  const run = async (id: string, moves: Move[]) => {
    for (const m of moves) {
      const label = `${m.scope}/${m.key}`;
      if (alreadyMigrated(id, m.scope, m.key)) {
        report.skipped.push(label);
        continue;
      }
      const src = m.from(id);
      // readJson quarantines damaged content rather than handing back a blank that
      // would be copied over the good data.
      const r = readJson<unknown>(src, null, { label });
      if (r.value === null || r.value === undefined) {
        // Nothing there. Mark it so we stop looking every launch.
        markMigrated(id, m.scope, m.key);
        report.skipped.push(label);
        continue;
      }
      try {
        // Never clobber a value already in the database — if both exist, the
        // database is the newer source of truth.
        const existing = await kvGet(id, m.scope, m.key);
        if (existing === null) await kvSet(id, m.scope, m.key, r.value);
        markMigrated(id, m.scope, m.key);
        report.copied.push(label);
      } catch (e) {
        // Leave the marker UNSET so this key is retried next launch. One failing
        // key must not strand the others.
        report.failed.push({ key: label, error: e instanceof Error ? e.message : String(e) });
      }
    }
  };

  await run(campaignId, MOVES);
  await run(GLOBAL_ID, GLOBAL_MOVES);
  return report;
}

/** Exposed for the diagnostics screen: what has and has not been copied. */
export function migrationStatus(campaignId: string): { key: string; migrated: boolean }[] {
  return [
    ...MOVES.map((m) => ({ key: `${m.scope}/${m.key}`, migrated: alreadyMigrated(campaignId, m.scope, m.key) })),
    ...GLOBAL_MOVES.map((m) => ({ key: `${m.scope}/${m.key}`, migrated: alreadyMigrated(GLOBAL_ID, m.scope, m.key) })),
  ];
}

export { GLOBAL_ID as GLOBAL_CAMPAIGN_ID };
