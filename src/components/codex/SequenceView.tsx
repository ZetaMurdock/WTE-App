import { useMemo, useRef, useState } from "react";
import { SEQ_COLORS, SEQ_ICONS, newScript, type Script, type Sequence } from "../../models/sequence";

// A Sequence page: knowledge-path editor + its Scripts (guided trails).
// Everything edits inline and saves on change — templates over blank fields.

interface Props {
  seq: Sequence;
  pages: string[];
  onSave: (seq: Sequence) => void;
  onDelete: (id: string) => void;
  onOpenPage: (stem: string) => void;
  onBegin: (seq: Sequence, script: Script) => void;
}

const pretty = (stem: string) => stem.replace(/_/g, " ");

export function SequenceView({ seq, pages, onSave, onDelete, onOpenPage, onBegin }: Props) {
  const [recSearch, setRecSearch] = useState("");
  const [varInput, setVarInput] = useState("");
  const [openScript, setOpenScript] = useState<string | null>(null);
  const [stepSearch, setStepSearch] = useState("");
  const dragIdx = useRef<number | null>(null);

  const patch = (p: Partial<Sequence>) => onSave({ ...seq, ...p });

  const recMatches = useMemo(() => {
    const f = recSearch.trim().toLowerCase();
    if (!f) return [];
    return pages.filter((p) => p.toLowerCase().includes(f) && !seq.recordIds.includes(p)).slice(0, 8);
  }, [recSearch, pages, seq.recordIds]);

  const stepMatches = useMemo(() => {
    const f = stepSearch.trim().toLowerCase();
    if (!f) return [];
    return pages.filter((p) => p.toLowerCase().includes(f)).slice(0, 8);
  }, [stepSearch, pages]);

  // ── records: drag pages into order ──
  function onDrop(to: number) {
    const from = dragIdx.current;
    dragIdx.current = null;
    if (from == null || from === to) return;
    const ids = [...seq.recordIds];
    const [moved] = ids.splice(from, 1);
    ids.splice(to, 0, moved);
    patch({ recordIds: ids });
  }

  function addVariable() {
    const v = varInput.trim();
    if (!v || seq.variables.includes(v)) return;
    patch({ variables: [...seq.variables, v] });
    setVarInput("");
  }

  function patchScript(id: string, p: Partial<Script>) {
    patch({ scripts: seq.scripts.map((s) => (s.id === id ? { ...s, ...p } : s)) });
  }

  return (
    <div className="seq">
      <div className="seq-head">
        <div className="seq-glyph" style={{ color: seq.color, borderColor: seq.color }}>
          {seq.icon}
        </div>
        <div className="seq-head-main">
          <input className="seq-title" value={seq.title} onChange={(e) => patch({ title: e.target.value })} placeholder="Sequence name" />
          <div className="seq-meta-row">
            <select className="bg-select" value={seq.scope} onChange={(e) => patch({ scope: e.target.value as Sequence["scope"] })}>
              <option value="personal">Personal</option>
              <option value="campaign">Campaign</option>
              <option value="official">Official</option>
              <option value="community">Community</option>
            </select>
            <button
              className={"chip" + (seq.visibility === "gm" ? " active" : "")}
              onClick={() => patch({ visibility: seq.visibility === "gm" ? "player" : "gm" })}
              title="GM-only sequences stay hidden from players"
            >
              {seq.visibility === "gm" ? "GM only" : "Player visible"}
            </button>
            <span className="rank-spacer" />
            <button className="icon-btn" onClick={() => onDelete(seq.id)}>
              Delete
            </button>
          </div>
        </div>
      </div>

      <div className="seq-pick-row">
        {SEQ_ICONS.map((i) => (
          <button key={i} className={"seq-pick" + (seq.icon === i ? " on" : "")} onClick={() => patch({ icon: i })}>
            {i}
          </button>
        ))}
        <span className="seq-pick-gap" />
        {SEQ_COLORS.map((c) => (
          <button
            key={c}
            className={"seq-swatch" + (seq.color === c ? " on" : "")}
            style={{ background: c }}
            onClick={() => patch({ color: c })}
            title={c}
          />
        ))}
      </div>

      <textarea
        className="sheet-notes seq-desc"
        placeholder="What this path is for — e.g. “Session 5 prep”, “Player onboarding”, “The Red Moon investigation”…"
        value={seq.description}
        onChange={(e) => patch({ description: e.target.value })}
      />

      <div className="panel-title mt">Variables</div>
      <div className="chip-row">
        {seq.variables.map((v) => (
          <button key={v} className="chip active" title="Remove" onClick={() => patch({ variables: seq.variables.filter((x) => x !== v) })}>
            {v} ×
          </button>
        ))}
        <input
          className="bg-select seq-var-input"
          placeholder="Add variable (Curator, Combat, Beginner…)"
          value={varInput}
          onChange={(e) => setVarInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") addVariable();
          }}
        />
      </div>

      <div className="panel-title mt">Records · {seq.recordIds.length}</div>
      <div className="seq-records">
        {seq.recordIds.map((stem, i) => (
          <div
            key={stem}
            className="seq-record"
            draggable
            onDragStart={() => (dragIdx.current = i)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => onDrop(i)}
          >
            <span className="seq-grip">⠿</span>
            <button className="seq-record-open" onClick={() => onOpenPage(stem)}>
              {pretty(stem)}
            </button>
            <button className="cdx-tab-x" title="Remove" onClick={() => patch({ recordIds: seq.recordIds.filter((x) => x !== stem) })}>
              ×
            </button>
          </div>
        ))}
        {seq.recordIds.length === 0 && <p className="list-empty">No records yet — search below and add pages in reading order.</p>}
      </div>
      <input className="bg-select full" placeholder="Add a record — search the archive…" value={recSearch} onChange={(e) => setRecSearch(e.target.value)} />
      {recMatches.length > 0 && (
        <div className="seq-matches">
          {recMatches.map((p) => (
            <button
              key={p}
              className="cdx-item"
              onClick={() => {
                patch({ recordIds: [...seq.recordIds, p] });
                setRecSearch("");
              }}
            >
              + {pretty(p)}
            </button>
          ))}
        </div>
      )}

      <div className="panel-title mt">
        Scripts · {seq.scripts.length}
        <button
          className="chip"
          style={{ marginLeft: 10 }}
          onClick={() => {
            const sc = newScript("New script");
            patch({ scripts: [...seq.scripts, sc] });
            setOpenScript(sc.id);
          }}
        >
          + New script
        </button>
      </div>
      {seq.scripts.map((sc) => (
        <div key={sc.id} className="seq-script">
          <div className="seq-script-head">
            <button className="seq-script-toggle" onClick={() => setOpenScript((o) => (o === sc.id ? null : sc.id))}>
              {openScript === sc.id ? "▾" : "▸"}
            </button>
            <input className="seq-script-title" value={sc.title} onChange={(e) => patchScript(sc.id, { title: e.target.value })} />
            <span className="seq-script-n">{sc.steps.length} steps</span>
            <button
              className={"chip" + (sc.visibility === "gm" ? " active" : "")}
              onClick={() => patchScript(sc.id, { visibility: sc.visibility === "gm" ? "player" : "gm" })}
            >
              {sc.visibility === "gm" ? "GM" : "Player"}
            </button>
            <button className="primary-btn seq-begin" disabled={sc.steps.length === 0} onClick={() => onBegin(seq, sc)}>
              Begin
            </button>
          </div>
          {openScript === sc.id && (
            <div className="seq-script-body">
              {sc.steps.map((st, i) => (
                <div key={st.stem + i} className="seq-record">
                  <span className="seq-step-n">{i + 1}</span>
                  <button className="seq-record-open" onClick={() => onOpenPage(st.stem)}>
                    {pretty(st.stem)}
                  </button>
                  <button className="cdx-tab-x" onClick={() => patchScript(sc.id, { steps: sc.steps.filter((_, x) => x !== i) })}>
                    ×
                  </button>
                </div>
              ))}
              <input
                className="bg-select full"
                placeholder="Add a step — search the archive…"
                value={openScript === sc.id ? stepSearch : ""}
                onChange={(e) => setStepSearch(e.target.value)}
              />
              {stepMatches.length > 0 && (
                <div className="seq-matches">
                  {stepMatches.map((p) => (
                    <button
                      key={p}
                      className="cdx-item"
                      onClick={() => {
                        patchScript(sc.id, { steps: [...sc.steps, { stem: p }] });
                        setStepSearch("");
                      }}
                    >
                      + {pretty(p)}
                    </button>
                  ))}
                </div>
              )}
              <button className="icon-btn" onClick={() => patch({ scripts: seq.scripts.filter((x) => x.id !== sc.id) })}>
                Delete script
              </button>
            </div>
          )}
        </div>
      ))}
      {seq.scripts.length === 0 && <p className="list-empty">Scripts are guided trails — ordered steps through pages (“Build your first character”).</p>}
    </div>
  );
}
