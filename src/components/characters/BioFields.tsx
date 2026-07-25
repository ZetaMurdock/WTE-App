import { useState } from "react";
import {
  BIO_FIELD_KINDS,
  BIO_LABEL_MAX,
  addBioField,
  moveBioField,
  numOf,
  removeBioField,
  renameBioField,
  setBioValue,
  stepBioField,
  type BioField,
  type BioFieldKind,
} from "../../lib/bioFields";

interface Props {
  fields: BioField[];
  editable?: boolean;
  onChange: (next: BioField[]) => void;
}

// Player-defined bio bubbles — age, favourite food, a tally of how many times
// something happened. Whatever the sheet does not already have a box for.
export function BioFields({ fields, editable = true, onChange }: Props) {
  const [adding, setAdding] = useState(false);
  const [label, setLabel] = useState("");
  const [kind, setKind] = useState<BioFieldKind>("text");
  const [renaming, setRenaming] = useState<string | null>(null);

  function commitAdd() {
    if (!label.trim()) return;
    onChange(addBioField(fields, label, kind));
    setLabel("");
    setKind("text");
    setAdding(false);
  }

  return (
    <div className="bio-bubbles-wrap">
      {fields.length === 0 && !adding && (
        <p className="list-empty">
          No custom fields yet. Add one for anything the sheet doesn&apos;t track — age, a callsign, a
          tally of how many times something went wrong.
        </p>
      )}

      <div className="bio-bubbles">
        {fields.map((f, i) => (
          <div className={"bio-bubble k-" + f.kind} key={f.id}>
            <div className="bio-bubble-head">
              {renaming === f.id && editable ? (
                <input
                  className="bio-bubble-label-edit"
                  autoFocus
                  defaultValue={f.label}
                  maxLength={BIO_LABEL_MAX}
                  onBlur={(e) => {
                    onChange(renameBioField(fields, f.id, e.target.value));
                    setRenaming(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                    if (e.key === "Escape") setRenaming(null);
                  }}
                />
              ) : (
                <button
                  className="bio-bubble-label"
                  disabled={!editable}
                  title={editable ? "Rename" : undefined}
                  onClick={() => editable && setRenaming(f.id)}
                >
                  {f.label}
                </button>
              )}
              {editable && (
                <span className="bio-bubble-tools">
                  <button className="icon-btn xs" title="Move left" disabled={i === 0} onClick={() => onChange(moveBioField(fields, f.id, -1))}>
                    ‹
                  </button>
                  <button
                    className="icon-btn xs"
                    title="Move right"
                    disabled={i === fields.length - 1}
                    onClick={() => onChange(moveBioField(fields, f.id, 1))}
                  >
                    ›
                  </button>
                  <button className="icon-btn xs" title="Remove this field" onClick={() => onChange(removeBioField(fields, f.id))}>
                    ×
                  </button>
                </span>
              )}
            </div>

            {f.kind === "counter" ? (
              <div className="bio-counter">
                <button className="icon-btn xs" disabled={!editable} onClick={() => onChange(stepBioField(fields, f.id, -1))}>
                  −
                </button>
                <span className="bio-counter-val">{numOf(f.value)}</span>
                <button className="icon-btn xs" disabled={!editable} onClick={() => onChange(stepBioField(fields, f.id, 1))}>
                  +
                </button>
              </div>
            ) : (
              <input
                className="bio-bubble-value"
                type={f.kind === "number" ? "number" : "text"}
                disabled={!editable}
                value={f.value}
                placeholder={f.kind === "number" ? "0" : "—"}
                onChange={(e) => onChange(setBioValue(fields, f.id, e.target.value))}
              />
            )}
          </div>
        ))}
      </div>

      {editable && (
        <div className="bio-add">
          {adding ? (
            <div className="bio-add-form">
              <input
                className="bio-add-label"
                autoFocus
                placeholder="Field name — e.g. Age, Favourite food, Times arrested"
                value={label}
                maxLength={BIO_LABEL_MAX}
                onChange={(e) => setLabel(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commitAdd();
                  if (e.key === "Escape") setAdding(false);
                }}
              />
              <div className="chip-row">
                {BIO_FIELD_KINDS.map((k) => (
                  <button
                    key={k.kind}
                    className={"chip" + (kind === k.kind ? " active" : "")}
                    title={k.hint}
                    onClick={() => setKind(k.kind)}
                  >
                    {k.label}
                  </button>
                ))}
              </div>
              <div className="bio-add-actions">
                <button className="primary-btn" disabled={!label.trim()} onClick={commitAdd}>
                  Add
                </button>
                <button className="icon-btn" onClick={() => setAdding(false)}>
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button className="icon-btn" onClick={() => setAdding(true)}>
              + Add field
            </button>
          )}
        </div>
      )}
    </div>
  );
}
