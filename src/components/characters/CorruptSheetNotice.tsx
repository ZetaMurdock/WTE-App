import { useState } from "react";
import { repairCharacterData, resetCorruptCharacter } from "../../lib/characters";
import { pushToast } from "../../lib/appToast";
import { ConfirmButton } from "../ui/ConfirmButton";

interface Props {
  id: string;
  name: string;
  /** The stored text that could not be parsed. */
  raw: string;
  error?: string;
  onBack: () => void;
  /** Called after a successful repair or an explicit reset, to reload the sheet. */
  onResolved: () => void;
}

// Shown INSTEAD of the character sheet when a row's `data` column cannot be
// parsed. The sheet is not rendered at all here, deliberately: previously a
// corrupt row rendered as a blank rank-0 character with the correct name — which
// reads as "my character was reset" — and the 400ms autosave then wrote that blank
// over the only copy of the real data.
//
// So the rules for this screen are: show that it is a read failure and not an
// empty character, never write anything on its own, and keep the original bytes
// in front of the user so they can be rescued.
export function CorruptSheetNotice({ id, name, raw, error, onBack, onResolved }: Props) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(raw);
  const [busy, setBusy] = useState(false);

  async function copyRaw() {
    try {
      await navigator.clipboard.writeText(raw);
      pushToast("The stored data was copied to your clipboard.", "info", 4000);
    } catch {
      pushToast("Couldn't reach the clipboard — select the text and copy it manually.", "error");
    }
  }

  async function repair() {
    setBusy(true);
    try {
      await repairCharacterData(id, text);
      pushToast(`"${name}" was repaired.`, "info", 5000);
      onResolved();
    } catch (e) {
      pushToast(e instanceof Error ? e.message : String(e), "error");
    } finally {
      setBusy(false);
    }
  }

  async function reset() {
    setBusy(true);
    try {
      await resetCorruptCharacter(id);
      pushToast(`"${name}" was reset to a blank sheet.`, "info", 5000);
      onResolved();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="dashboard">
      <div className="sheet-head">
        <button className="link-btn" onClick={onBack}>
          Back to the vault
        </button>
      </div>

      <div className="panel-title">This character's data could not be read</div>
      <p className="corrupt-lede">
        <b>{name}</b> is still here, but the stored sheet is damaged and W.T.E cannot make sense of it. Nothing has been
        changed or overwritten — the original is exactly as it was found, and it stays that way until you choose one of
        the options below.
      </p>
      {error ? <p className="corrupt-why">Reader said: {error}</p> : null}

      <div className="panel-title mt">The stored data</div>
      <p className="corrupt-hint">
        Copy this somewhere safe first. If you can see where it is truncated or malformed, you can edit it below and try
        again — a repair that still cannot be read is refused, so the original is never lost by trying.
      </p>

      {editing ? (
        <textarea
          className="corrupt-raw editing"
          value={text}
          spellCheck={false}
          onChange={(e) => setText(e.target.value)}
          rows={14}
        />
      ) : (
        <pre className="corrupt-raw">{raw || "(the field was empty)"}</pre>
      )}

      <div className="corrupt-actions">
        <button className="ghost-btn" onClick={copyRaw}>
          Copy the stored data
        </button>
        {editing ? (
          <>
            <button className="primary-btn" onClick={repair} disabled={busy || text === raw}>
              Try to repair
            </button>
            <button
              className="icon-btn"
              onClick={() => {
                setEditing(false);
                setText(raw);
              }}
              disabled={busy}
            >
              Cancel
            </button>
          </>
        ) : (
          <button className="ghost-btn" onClick={() => setEditing(true)}>
            Edit and try to repair
          </button>
        )}
        <ConfirmButton
          className="icon-btn danger"
          label="Reset to a blank sheet"
          confirmLabel="Reset — this discards the stored data"
          onConfirm={() => {
            if (!busy) void reset();
          }}
        />
      </div>
    </div>
  );
}
