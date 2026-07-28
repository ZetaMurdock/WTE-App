import type { MigrationGate } from "../lib/db";

interface Props {
  gate: MigrationGate;
  onRetry: () => void;
}

// Shown INSTEAD of the app when the pre-upgrade backup did not succeed.
//
// This build upgrades the database to a schema older builds cannot open, so the
// only safe order is: copy first, upgrade second. When the copy fails the correct
// behaviour is to do nothing at all — and to say so, rather than let the user find
// out later that the upgrade happened and the restore point did not.
export function DataBlocked({ gate, onRetry }: Props) {
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        background: "var(--bg)",
        color: "var(--ink)",
        display: "grid",
        placeItems: "center",
        padding: "24px",
        overflow: "auto",
      }}
    >
      <div
        style={{
          maxWidth: 640,
          background: "var(--panel)",
          border: "1px solid var(--panel-line)",
          borderRadius: 10,
          padding: "22px 24px",
        }}
      >
        <div className="panel-title" style={{ margin: 0 }}>
          Your data was not opened
        </div>

        <p style={{ marginTop: 14, lineHeight: 1.55 }}>
          This version of W.T.E needs to upgrade how your campaigns are stored. Before doing that it makes a copy of
          your data, so the upgrade can be undone. <strong>That copy could not be made, so nothing was changed.</strong>
        </p>

        <p
          style={{
            margin: "14px 0",
            padding: "10px 12px",
            background: "var(--bar)",
            border: "1px solid var(--panel-line)",
            borderRadius: 6,
            color: "var(--bone)",
          }}
        >
          {gate.reason || "The backup could not be verified."}
        </p>

        <p style={{ lineHeight: 1.55, color: "var(--muted)" }}>
          Your campaigns, characters and scenes are untouched. The most common cause is a second W.T.E window still
          running — close every one of them, then try again. If it keeps failing, check that the drive holding your
          W.T.E folder has free space and is not read-only.
        </p>

        <div style={{ display: "flex", gap: 10, marginTop: 18 }}>
          <button className="primary-btn" onClick={onRetry}>
            Try again
          </button>
        </div>

        <p style={{ marginTop: 16, fontSize: 12, color: "var(--muted)" }}>
          Storage format {gate.schema_version} · nothing has been migrated
        </p>
      </div>
    </div>
  );
}
