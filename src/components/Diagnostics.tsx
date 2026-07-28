import { useCallback, useEffect, useState } from "react";
import type { Campaign } from "../models/campaign";
import { getDb, sqlAvailable } from "../lib/db";
import { listQuarantined } from "../lib/localJson";
import { migrationStatus } from "../lib/campaignStore";
import { pushToast } from "../lib/appToast";
import { parseSheetSafe } from "../lib/sheetCodec";
import { parseSceneData } from "../vtt/data/sceneRepo";
import { parseEncounterData } from "../vtt/data/encounterRepo";

interface Props {
  campaign: Campaign | null;
}

interface TableStat {
  table: string;
  rows: number;
  unreadable: number;
}

interface Damaged {
  table: string;
  id: string;
  name: string;
  reason: string;
}

// Where your data lives, how much of it there is, and whether any of it is
// damaged. The app previously had no way to answer any of those — a failed read
// rendered as "you have no characters", which is indistinguishable from real loss,
// and a quarantined blob was invisible.
export function Diagnostics({ campaign }: Props) {
  const [stats, setStats] = useState<TableStat[]>([]);
  const [damaged, setDamaged] = useState<Damaged[]>([]);
  const [dbError, setDbError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const quarantined = listQuarantined();

  const scan = useCallback(async () => {
    setLoading(true);
    setDbError(null);
    if (!sqlAvailable()) {
      setLoading(false);
      setDbError("The database is only available in the desktop app.");
      return;
    }
    try {
      const db = await getDb();
      const out: TableStat[] = [];
      const bad: Damaged[] = [];

      // Row counts per table. A table that does not EXIST is skipped rather than
      // reported as unreadable — campaign_kv only arrives with the Phase 2 schema,
      // and listing it as broken would be a false alarm on exactly the screen
      // built to stop false alarms.
      const existing = new Set(
        (await db.select<{ name: string }[]>("SELECT name FROM sqlite_master WHERE type = 'table'")).map((r) => r.name)
      );
      for (const t of ["campaigns", "characters", "scenes", "encounters", "assets", "notes", "codex_sequences", "rolls", "campaign_kv", "rule_layers"]) {
        if (!existing.has(t)) continue;
        try {
          const rows = await db.select<{ n: number }[]>(`SELECT COUNT(*) AS n FROM ${t}`);
          out.push({ table: t, rows: rows[0]?.n ?? 0, unreadable: 0 });
        } catch {
          out.push({ table: t, rows: -1, unreadable: 0 });
        }
      }

      // Which stored blobs cannot be read. This is the question the app could not
      // answer before: a damaged record used to look like an empty one.
      const checks: [string, string, (raw: string | null) => boolean][] = [
        ["characters", "SELECT id, name, data FROM characters", (r) => parseSheetSafe(r).corrupt],
        ["scenes", "SELECT id, name, data FROM scenes", (r) => parseSceneData(r).corrupt],
        ["encounters", "SELECT id, name, data FROM encounters", (r) => parseEncounterData(r).corrupt],
      ];
      for (const [table, sql, isCorrupt] of checks) {
        try {
          const rows = await db.select<{ id: string; name: string; data: string | null }[]>(sql);
          let n = 0;
          for (const r of rows) {
            if (!isCorrupt(r.data)) continue;
            n++;
            bad.push({
              table,
              id: r.id,
              name: r.name || "(unnamed)",
              reason: r.data === "" ? "stored empty (an interrupted write)" : "could not be read",
            });
          }
          const s = out.find((x) => x.table === table);
          if (s) s.unreadable = n;
        } catch {
          /* counted above as unreadable table */
        }
      }

      setStats(out);
      setDamaged(bad);
    } catch (e) {
      // A failed DB open is exactly the condition this screen exists to surface.
      setDbError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void scan();
  }, [scan]);

  const migration = campaign ? migrationStatus(campaign.id) : [];
  const pending = migration.filter((m) => !m.migrated);

  return (
    <div className="diag">
      <div className="panel-title">Storage health</div>

      {dbError && (
        <p className="diag-error">
          The database could not be opened: {dbError}
          <br />
          Close any other copy of W.T.E and use Re-scan. Nothing has been changed.
        </p>
      )}

      {loading ? (
        <p className="list-empty">Scanning…</p>
      ) : (
        <>
          <table className="diag-table">
            <thead>
              <tr>
                <th>Table</th>
                <th>Records</th>
                <th>Unreadable</th>
              </tr>
            </thead>
            <tbody>
              {stats.map((s) => (
                <tr key={s.table} className={s.unreadable > 0 ? "bad" : undefined}>
                  <td>{s.table}</td>
                  <td>{s.rows < 0 ? "unreadable" : s.rows}</td>
                  <td>{s.unreadable || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {damaged.length > 0 && (
            <>
              <div className="panel-title mt">Damaged records ({damaged.length})</div>
              <p className="diag-hint">
                These are kept exactly as found. Nothing overwrites them — open a damaged character to copy the stored
                data out, repair it, or reset it deliberately.
              </p>
              <ul className="diag-list">
                {damaged.map((d) => (
                  <li key={d.table + d.id}>
                    <b>{d.name}</b> <span className="diag-dim">({d.table})</span> — {d.reason}
                  </li>
                ))}
              </ul>
            </>
          )}

          {quarantined.length > 0 && (
            <>
              <div className="panel-title mt">Rescued copies ({quarantined.length})</div>
              <p className="diag-hint">
                Settings that could not be read were copied aside before anything else touched them, so nothing was
                lost. Each entry holds the original text.
              </p>
              <ul className="diag-list">
                {quarantined.map((q) => (
                  <li key={q.key}>
                    <b>{q.original}</b> <span className="diag-dim">{new Date(q.at).toLocaleString()}</span> — {q.bytes}{" "}
                    bytes, kept as <code>{q.key}</code>
                  </li>
                ))}
              </ul>
            </>
          )}

          {campaign && (
            <>
              <div className="panel-title mt">This campaign's data</div>
              <p className="diag-hint">
                {pending.length === 0
                  ? "All of this campaign's settings live in the database, so they travel with a backup or an export."
                  : `${pending.length} of ${migration.length} settings are still only in this device's browser storage — they will be copied to the database automatically, and are not included in a database backup until then.`}
              </p>
              {pending.length > 0 && (
                <ul className="diag-list">
                  {pending.map((m) => (
                    <li key={m.key}>{m.key}</li>
                  ))}
                </ul>
              )}
            </>
          )}
        </>
      )}

      <div className="diag-actions">
        <button className="ghost-btn" onClick={() => void scan()} disabled={loading}>
          Re-scan
        </button>
        <button
          className="ghost-btn"
          onClick={() => {
            const summary = [
              ...stats.map((s) => `${s.table}: ${s.rows} rows${s.unreadable ? `, ${s.unreadable} unreadable` : ""}`),
              ...damaged.map((d) => `DAMAGED ${d.table} ${d.id} (${d.name}) — ${d.reason}`),
              ...quarantined.map((q) => `RESCUED ${q.key} (${q.bytes} bytes)`),
            ].join("\n");
            navigator.clipboard
              .writeText(summary)
              .then(() => pushToast("Storage report copied to your clipboard.", "info", 4000))
              .catch(() => pushToast("Couldn't reach the clipboard.", "error"));
          }}
        >
          Copy report
        </button>
      </div>
    </div>
  );
}
