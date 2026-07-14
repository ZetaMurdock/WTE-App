import { useEffect, useRef, useState } from "react";
import {
  WD_COLORS,
  extractDoc,
  embedDoc,
  importLegacy,
  makeComponent,
  makeNode,
  nodeIcon,
  nodeLabel,
  wdId,
  type WdDoc,
  type WdNode,
} from "./model";
import { renderDocHtml } from "./render";
import { fileToPngDataUrl } from "../../../lib/image";

// The Visual Engine: a Figma-style semantic editor. Left = layers tree, centre =
// the live page (the editor IS the preview — text edits in place), right =
// properties of the selected object. The palette inserts semantic blocks and
// reusable components; an inline toolbar formats selected text like a word
// processor. HTML/CSS are generated behind the scenes (render.ts).

const PALETTE: { group: string; items: { kind: string; label: string }[] }[] = [
  {
    group: "Layout",
    items: [
      { kind: "section", label: "Section" },
      { kind: "columns", label: "Columns" },
      { kind: "spacer", label: "Spacer" },
      { kind: "divider", label: "Divider" },
    ],
  },
  {
    group: "Content",
    items: [
      { kind: "heading", label: "Heading" },
      { kind: "text", label: "Text" },
      { kind: "image", label: "Image" },
      { kind: "table", label: "Table" },
    ],
  },
  {
    group: "Boxes",
    items: [
      { kind: "callout", label: "Callout" },
      { kind: "panel", label: "Info Box" },
      { kind: "spoiler", label: "Dropdown" },
    ],
  },
  {
    group: "Components",
    items: [
      { kind: "infobox", label: "📦 Info Box" },
      { kind: "speciescard", label: "🧬 Species Card" },
      { kind: "statpanel", label: "📊 Stat Panel" },
      { kind: "quote", label: "❝ Quote" },
      { kind: "warning", label: "⚠ Warning" },
    ],
  },
];
const COMPONENT_KINDS = new Set(["infobox", "speciescard", "statpanel", "quote", "warning"]);

function clone(d: WdDoc): WdDoc {
  return JSON.parse(JSON.stringify(d)) as WdDoc;
}
/** Every child list in the doc (root, containers, spoilers, each column). */
function allLists(d: WdDoc): WdNode[][] {
  const out: WdNode[][] = [d.children];
  const walk = (n: WdNode) => {
    if (n.type === "container" || n.type === "spoiler") {
      out.push(n.children);
      n.children.forEach(walk);
    } else if (n.type === "columns") {
      for (const c of n.cols) {
        out.push(c);
        c.forEach(walk);
      }
    }
  };
  d.children.forEach(walk);
  return out;
}
function findList(d: WdDoc, id: string): { list: WdNode[]; idx: number } | null {
  for (const list of allLists(d)) {
    const idx = list.findIndex((n) => n.id === id);
    if (idx >= 0) return { list, idx };
  }
  return null;
}
function findNode(d: WdDoc, id: string | null): WdNode | null {
  if (!id) return null;
  const hit = findList(d, id);
  return hit ? hit.list[hit.idx] : null;
}

function tint(hex?: string): string {
  return hex ? hex + "22" : "rgba(126,207,202,0.08)";
}

interface Props {
  value: string;
  onChange: (source: string) => void;
}

export function VisualDocEditor({ value, onChange }: Props) {
  const [doc, setDoc] = useState<WdDoc>(() => extractDoc(value) ?? importLegacy(value));
  const [selId, setSelId] = useState<string | null>(null);
  const first = useRef(true);
  const canvasRef = useRef<HTMLDivElement>(null);
  const [fmtBar, setFmtBar] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    onChange(embedDoc(doc, renderDocHtml(doc)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc]);

  // Inline formatting toolbar: appears over a text selection inside the canvas.
  useEffect(() => {
    function onSel() {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || !canvasRef.current || !sel.anchorNode || !canvasRef.current.contains(sel.anchorNode)) {
        setFmtBar(null);
        return;
      }
      const host = (sel.anchorNode instanceof Element ? sel.anchorNode : sel.anchorNode.parentElement)?.closest?.("[data-wd-rich]");
      if (!host) {
        setFmtBar(null);
        return;
      }
      const r = sel.getRangeAt(0).getBoundingClientRect();
      setFmtBar({ x: r.left + r.width / 2, y: r.top });
    }
    document.addEventListener("selectionchange", onSel);
    return () => document.removeEventListener("selectionchange", onSel);
  }, []);

  const mutate = (fn: (d: WdDoc) => void) => {
    setDoc((prev) => {
      const next = clone(prev);
      fn(next);
      return next;
    });
  };

  function insert(kind: string) {
    const node = COMPONENT_KINDS.has(kind) ? makeComponent(kind) : makeNode(kind);
    mutate((d) => {
      const sel = findNode(d, selId);
      if (sel && (sel.type === "container" || sel.type === "spoiler")) sel.children.push(node);
      else if (sel && sel.type === "columns") sel.cols[0].push(node);
      else if (sel) {
        const hit = findList(d, sel.id)!;
        hit.list.splice(hit.idx + 1, 0, node);
      } else d.children.push(node);
    });
    setSelId(node.id);
  }
  function removeSel() {
    if (!selId) return;
    mutate((d) => {
      const hit = findList(d, selId);
      if (hit) hit.list.splice(hit.idx, 1);
    });
    setSelId(null);
  }
  function moveSel(dir: -1 | 1) {
    if (!selId) return;
    mutate((d) => {
      const hit = findList(d, selId);
      if (!hit) return;
      const j = hit.idx + dir;
      if (j < 0 || j >= hit.list.length) return;
      [hit.list[hit.idx], hit.list[j]] = [hit.list[j], hit.list[hit.idx]];
    });
  }
  function patchSel(p: Record<string, unknown>) {
    if (!selId) return;
    mutate((d) => {
      const n = findNode(d, selId);
      if (n) Object.assign(n, p);
    });
  }

  function fmt(cmd: string, arg?: string) {
    try {
      document.execCommand("styleWithCSS", false, "true");
      document.execCommand(cmd, false, arg);
    } catch {
      /* ignore */
    }
  }
  function fmtGlow(color: string) {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) return;
    const d = document.createElement("div");
    d.appendChild(sel.getRangeAt(0).cloneContents());
    try {
      document.execCommand("insertHTML", false, `<span style="text-shadow:0 0 8px ${color};color:${color}">${d.innerHTML}</span>`);
    } catch {
      /* ignore */
    }
  }

  const selected = findNode(doc, selId);

  return (
    <div className="wde">
      <div className="wde-palette">
        {PALETTE.map((g) => (
          <span className="wde-pal-group" key={g.group}>
            <span className="wde-pal-label">{g.group}</span>
            {g.items.map((it) => (
              <button key={it.kind} className="chip" onClick={() => insert(it.kind)} title={`Insert ${it.label}${selected ? " into / after the selection" : ""}`}>
                {it.label}
              </button>
            ))}
          </span>
        ))}
      </div>

      <div className="wde-body">
        <div className="wde-layers">
          <div className="wde-pane-title">Layers</div>
          <div className="wde-tree">
            <LayerRow label="📄 Page" depth={0} selected={selId === null} onSelect={() => setSelId(null)} />
            {doc.children.map((n) => (
              <LayerTree key={n.id} node={n} depth={1} selId={selId} onSelect={setSelId} />
            ))}
          </div>
        </div>

        <div className="wde-canvas" ref={canvasRef} onClick={() => setSelId(null)}>
          {doc.children.length === 0 && <p className="pe-hint">The page is empty — insert blocks or components from the palette above.</p>}
          <div className="wd-page" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {doc.children.map((n) => (
              <CanvasNode key={n.id} node={n} selId={selId} onSelect={setSelId} onPatch={(id, p) => mutate((d) => Object.assign(findNode(d, id) ?? {}, p))} />
            ))}
          </div>
        </div>

        <div className="wde-props">
          <div className="wde-pane-title">Properties</div>
          {!selected ? (
            <p className="pe-hint">Select an object on the page or in Layers.</p>
          ) : (
            <PropsPanel node={selected} onPatch={patchSel} onMove={moveSel} onRemove={removeSel} />
          )}
        </div>
      </div>

      {fmtBar && (
        <div className="wde-fmtbar" style={{ left: fmtBar.x, top: fmtBar.y }} onMouseDown={(e) => e.preventDefault()}>
          <button onClick={() => fmt("bold")}><b>B</b></button>
          <button onClick={() => fmt("italic")}><i>I</i></button>
          <button onClick={() => fmt("underline")}><u>U</u></button>
          {WD_COLORS.slice(0, 4).map((c) => (
            <button key={c} className="wde-fmt-sw" style={{ background: c }} onClick={() => fmt("foreColor", c)} title="Text colour" />
          ))}
          <button onClick={() => fmt("hiliteColor", "rgba(126,207,202,0.25)")} title="Highlight">▩</button>
          <button onClick={() => fmtGlow("#7ecfca")} title="Glow">✦</button>
          <button onClick={() => fmt("removeFormat")} title="Clear formatting">⌫</button>
        </div>
      )}
    </div>
  );
}

// ── Layers tree ──
function LayerRow({ label, depth, selected, onSelect }: { label: string; depth: number; selected: boolean; onSelect: () => void }) {
  return (
    <button className={"wde-layer" + (selected ? " on" : "")} style={{ paddingLeft: 8 + depth * 14 }} onClick={onSelect}>
      {label}
    </button>
  );
}
function LayerTree({ node, depth, selId, onSelect }: { node: WdNode; depth: number; selId: string | null; onSelect: (id: string) => void }) {
  return (
    <>
      <LayerRow label={`${nodeIcon(node)} ${nodeLabel(node)}`} depth={depth} selected={selId === node.id} onSelect={() => onSelect(node.id)} />
      {(node.type === "container" || node.type === "spoiler") &&
        node.children.map((c) => <LayerTree key={c.id} node={c} depth={depth + 1} selId={selId} onSelect={onSelect} />)}
      {node.type === "columns" &&
        node.cols.map((col, i) => (
          <span key={i}>
            <LayerRow label={`▥ Column ${i + 1}`} depth={depth + 1} selected={false} onSelect={() => onSelect(node.id)} />
            {col.map((c) => (
              <LayerTree key={c.id} node={c} depth={depth + 2} selId={selId} onSelect={onSelect} />
            ))}
          </span>
        ))}
    </>
  );
}

// ── Canvas (live page) ──
interface CanvasProps {
  node: WdNode;
  selId: string | null;
  onSelect: (id: string) => void;
  onPatch: (id: string, p: Record<string, unknown>) => void;
}
function CanvasNode({ node, selId, onSelect, onPatch }: CanvasProps) {
  const sel = selId === node.id;
  const ring = sel ? " wde-sel" : "";
  const stop = (e: React.MouseEvent) => {
    e.stopPropagation();
    onSelect(node.id);
  };
  switch (node.type) {
    case "container": {
      const style: React.CSSProperties = { display: "flex", flexDirection: "column", gap: node.gap ?? 10, padding: node.pad ?? (node.style === "plain" ? 0 : 14) };
      if (node.style === "callout") Object.assign(style, { borderLeft: `3px solid ${node.color || "var(--accent)"}`, background: tint(node.color), borderRadius: "0 6px 6px 0" });
      if (node.style === "panel") Object.assign(style, { border: `1px solid ${node.color || "var(--panel-line)"}`, borderRadius: 8 });
      return (
        <div className={"wde-node" + ring} style={style} onClick={stop}>
          {node.children.length === 0 && <span className="wde-empty">empty {nodeLabel(node)} — select it and insert blocks</span>}
          {node.children.map((c) => (
            <CanvasNode key={c.id} node={c} selId={selId} onSelect={onSelect} onPatch={onPatch} />
          ))}
        </div>
      );
    }
    case "columns":
      return (
        <div className={"wde-node" + ring} style={{ display: "grid", gridTemplateColumns: `repeat(${node.cols.length},1fr)`, gap: node.gap ?? 14 }} onClick={stop}>
          {node.cols.map((col, i) => (
            <div key={i} className="wde-column" style={{ display: "flex", flexDirection: "column", gap: 10, minWidth: 0 }}>
              {col.length === 0 && <span className="wde-empty">column {i + 1}</span>}
              {col.map((c) => (
                <CanvasNode key={c.id} node={c} selId={selId} onSelect={onSelect} onPatch={onPatch} />
              ))}
            </div>
          ))}
        </div>
      );
    case "heading": {
      const Tag = ("h" + Math.min(Math.max(node.level || 2, 1), 5)) as "h2";
      return (
        <Tag
          className={"wde-node" + ring}
          style={{ margin: 0, color: node.color || "var(--accent)", textAlign: (node.align as never) || "left" }}
          contentEditable
          suppressContentEditableWarning
          onClick={stop}
          onBlur={(e) => onPatch(node.id, { text: e.currentTarget.textContent || "" })}
        >
          {node.text}
        </Tag>
      );
    }
    case "text":
      return (
        <div
          className={"wde-node wd-text" + ring}
          style={{ textAlign: (node.align as never) || "left" }}
          data-wd-rich
          contentEditable
          suppressContentEditableWarning
          onClick={stop}
          onBlur={(e) => onPatch(node.id, { html: e.currentTarget.innerHTML })}
          dangerouslySetInnerHTML={{ __html: node.html }}
        />
      );
    case "image": {
      const m = node.align === "center" ? "0 auto" : node.align === "right" ? "0 0 0 auto" : "0";
      return node.src ? (
        <img className={"wde-node" + ring} src={node.src} alt={node.alt || ""} style={{ display: "block", margin: m, width: `${node.width ?? 100}%`, borderRadius: 6 }} onClick={stop} />
      ) : (
        <div className={"wde-node wde-imgph" + ring} onClick={stop}>
          🖼 Image — set a URL or upload in Properties
        </div>
      );
    }
    case "divider":
      return <hr className={"wde-node" + ring} style={{ border: "none", borderTop: `1px solid ${node.color || "var(--panel-line)"}`, margin: "6px 0", cursor: "pointer" }} onClick={stop} />;
    case "spacer":
      return (
        <div className={"wde-node wde-spacer" + ring} style={{ height: Math.max(4, node.h || 24) }} onClick={stop} title={`Spacer · ${node.h}px`} />
      );
    case "spoiler":
      return (
        <details className={"wde-node cdx-drop" + ring} open onClick={(e) => e.stopPropagation()}>
          <summary style={{ color: node.color || "var(--accent)" }} onClick={(e) => { e.preventDefault(); onSelect(node.id); }}>
            {node.title || "Details"}
          </summary>
          <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 8 }}>
            {node.children.length === 0 && <span className="wde-empty">empty dropdown</span>}
            {node.children.map((c) => (
              <CanvasNode key={c.id} node={c} selId={selId} onSelect={onSelect} onPatch={onPatch} />
            ))}
          </div>
        </details>
      );
    case "table":
      return (
        <table className={"wde-node wd-table" + ring} style={{ borderColor: node.color || "var(--panel-line)" }} onClick={stop}>
          <tbody>
            {node.rows.map((r, ri) => (
              <tr key={ri}>
                {r.map((c, ci) => {
                  const CellTag = (ri === 0 ? "th" : "td") as "td";
                  return (
                    <CellTag
                      key={ci}
                      contentEditable
                      suppressContentEditableWarning
                      onBlur={(e) => {
                        const rows = node.rows.map((row) => row.slice());
                        rows[ri][ci] = e.currentTarget.textContent || "";
                        onPatch(node.id, { rows });
                      }}
                    >
                      {c}
                    </CellTag>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      );
  }
}

// ── Properties panel ──
function PropsPanel({ node, onPatch, onMove, onRemove }: { node: WdNode; onPatch: (p: Record<string, unknown>) => void; onMove: (d: -1 | 1) => void; onRemove: () => void }) {
  return (
    <div className="wde-props-body">
      <div className="wde-props-head">
        <span>{nodeIcon(node)} {nodeLabel(node)}</span>
      </div>

      {"color" in node && (
        <div className="lobby-field">
          <span>Colour</span>
          <div className="vbe-swatches" style={{ marginTop: 4 }}>
            <button className={"wde-theme-sw" + (!node.color ? " on" : "")} title="Theme default" onClick={() => onPatch({ color: undefined })}>t</button>
            {WD_COLORS.map((c) => (
              <button key={c} className={"vbe-sw" + (node.color === c ? " on" : "")} style={{ background: c }} onClick={() => onPatch({ color: c })} />
            ))}
          </div>
        </div>
      )}

      {node.type === "heading" && (
        <>
          <label className="lobby-field mt"><span>Size</span>
            <select className="bg-select full" value={node.level} onChange={(e) => onPatch({ level: parseInt(e.target.value, 10) })}>
              {[1, 2, 3, 4, 5].map((l) => <option key={l} value={l}>Heading {l}</option>)}
            </select>
          </label>
          <AlignRow value={node.align} onPatch={onPatch} />
        </>
      )}
      {node.type === "text" && <AlignRow value={node.align} onPatch={onPatch} />}
      {node.type === "container" && (
        <>
          <label className="lobby-field mt"><span>Style</span>
            <select className="bg-select full" value={node.style} onChange={(e) => onPatch({ style: e.target.value })}>
              <option value="plain">Plain section</option>
              <option value="callout">Callout</option>
              <option value="panel">Info box (panel)</option>
            </select>
          </label>
          <Slider label="Padding" min={0} max={40} value={node.pad ?? (node.style === "plain" ? 0 : 14)} onChange={(v) => onPatch({ pad: v })} />
          <Slider label="Gap" min={0} max={40} value={node.gap ?? 10} onChange={(v) => onPatch({ gap: v })} />
        </>
      )}
      {node.type === "columns" && (
        <>
          <label className="lobby-field mt"><span>Columns</span>
            <select
              className="bg-select full"
              value={node.cols.length}
              onChange={(e) => {
                const n = parseInt(e.target.value, 10);
                const cols = node.cols.slice(0, n);
                while (cols.length < n) cols.push([]);
                onPatch({ cols });
              }}
            >
              {[2, 3, 4].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
          <Slider label="Gap" min={0} max={40} value={node.gap ?? 14} onChange={(v) => onPatch({ gap: v })} />
        </>
      )}
      {node.type === "image" && (
        <>
          <label className="lobby-field mt"><span>Image URL</span>
            <input className="bg-select full" value={node.src} placeholder="http/data:…" onChange={(e) => onPatch({ src: e.target.value })} />
          </label>
          <UploadBtn onDone={(url) => onPatch({ src: url })} />
          <label className="lobby-field mt"><span>Alt text</span>
            <input className="bg-select full" value={node.alt || ""} onChange={(e) => onPatch({ alt: e.target.value })} />
          </label>
          <Slider label="Width %" min={10} max={100} value={node.width ?? 100} onChange={(v) => onPatch({ width: v })} />
          <AlignRow value={node.align} onPatch={onPatch} />
        </>
      )}
      {node.type === "spacer" && <Slider label="Height px" min={4} max={160} value={node.h} onChange={(v) => onPatch({ h: v })} />}
      {node.type === "spoiler" && (
        <label className="lobby-field mt"><span>Label</span>
          <input className="bg-select full" value={node.title} onChange={(e) => onPatch({ title: e.target.value })} />
        </label>
      )}
      {node.type === "table" && (
        <div className="lobby-field mt"><span>Grid</span>
          <div className="vbe-table-btns" style={{ marginTop: 4 }}>
            <button className="cdx-flag" onClick={() => onPatch({ rows: [...node.rows, node.rows[0].map(() => "")] })}>＋ Row</button>
            <button className="cdx-flag" onClick={() => onPatch({ rows: node.rows.map((r) => [...r, ""]) })}>＋ Col</button>
            <button className="cdx-flag" onClick={() => node.rows.length > 1 && onPatch({ rows: node.rows.slice(0, -1) })}>− Row</button>
            <button className="cdx-flag" onClick={() => node.rows[0].length > 1 && onPatch({ rows: node.rows.map((r) => r.slice(0, -1)) })}>− Col</button>
          </div>
        </div>
      )}

      <div className="wde-props-actions">
        <button className="cdx-flag" onClick={() => onMove(-1)} title="Move up">↑</button>
        <button className="cdx-flag" onClick={() => onMove(1)} title="Move down">↓</button>
        <span className="rank-spacer" />
        <button className="icon-btn danger" onClick={onRemove}>Delete</button>
      </div>
    </div>
  );
}

function AlignRow({ value, onPatch }: { value?: string; onPatch: (p: Record<string, unknown>) => void }) {
  return (
    <div className="lobby-field mt"><span>Alignment</span>
      <div className="chip-row" style={{ marginTop: 4 }}>
        {(["left", "center", "right"] as const).map((a) => (
          <button key={a} className={"chip" + ((value || "left") === a ? " active" : "")} onClick={() => onPatch({ align: a })}>
            {a === "left" ? "⬅" : a === "center" ? "↔" : "➡"}
          </button>
        ))}
      </div>
    </div>
  );
}
function Slider({ label, min, max, value, onChange }: { label: string; min: number; max: number; value: number; onChange: (v: number) => void }) {
  return (
    <label className="lobby-field mt"><span>{label} · {value}</span>
      <input type="range" min={min} max={max} value={value} onChange={(e) => onChange(parseInt(e.target.value, 10))} />
    </label>
  );
}
function UploadBtn({ onDone }: { onDone: (url: string) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={ref}
        type="file"
        accept="image/*"
        hidden
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (!f) return;
          const url = await fileToPngDataUrl(f, 1600).catch(() => null);
          if (url) onDone(url);
        }}
      />
      <button className="chip" style={{ marginTop: 6 }} onClick={() => ref.current?.click()}>⬆ Upload PNG</button>
    </>
  );
}

/** New empty doc helper (kept for future "blank page" flows). */
export function emptyDoc(): WdDoc {
  return { v: 1, children: [{ id: wdId(), type: "heading", level: 1, text: "New Page" }] };
}
