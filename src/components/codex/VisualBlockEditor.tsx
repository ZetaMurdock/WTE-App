import { useEffect, useRef, useState } from "react";

// No-code page builder. Parses ANY page source (markdown + raw HTML, not just
// editor-authored blocks) into editable blocks, and serialises back to the same
// source format — so existing pages open in Visual, and edits survive a Visual↔Code
// round-trip. Content the editor can't model cleanly is preserved in a raw "HTML"
// block (the escape hatch).

type BlockType = "heading" | "text" | "list" | "table" | "image" | "box" | "dropdown" | "divider" | "html";
export interface Block {
  id: string;
  type: BlockType;
  text?: string; // heading/text/box/dropdown body/image alt/raw html
  title?: string; // dropdown summary
  color?: string;
  level?: number; // heading 1..5
  items?: string[]; // list
  rows?: string[][]; // table
  src?: string; // image
}

const COLORS = ["#7ecfca", "#a1584a", "#a08a4f", "#6f9a68", "#837aae", "#a7aebd"];

let seq = 0;
const uid = () => "b" + Date.now().toString(36) + (seq++).toString(36);

function esc(s: string): string {
  return (s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function escMulti(s: string): string {
  return esc(s).replace(/\n/g, "<br>");
}
function unbr(s: string): string {
  return (s || "").replace(/<br\s*\/?>/gi, "\n");
}
function tint(hex?: string): string {
  return hex ? hex + "22" : "transparent";
}

// ── Serialise a block back to page source ──
export function blockToHtml(b: Block): string {
  switch (b.type) {
    case "heading": {
      const lvl = Math.min(Math.max(b.level || 3, 1), 5);
      return `<h${lvl} data-b="heading"${b.color ? ` data-c="${b.color}"` : ""} style="color:${b.color || "var(--accent)"}">${esc(b.text || "")}</h${lvl}>`;
    }
    case "box":
      return `<div data-b="box"${b.color ? ` data-c="${b.color}"` : ""} class="cdx-callout" style="border-left:3px solid ${b.color || "var(--accent)"};background:${tint(b.color)}">${escMulti(b.text || "")}</div>`;
    case "dropdown":
      return `<details data-b="dropdown"${b.color ? ` data-c="${b.color}"` : ""} class="cdx-drop"><summary style="color:${b.color || "var(--accent)"}">${esc(b.title || "Details")}</summary><div>${escMulti(b.text || "")}</div></details>`;
    default:
      return "";
  }
}

function tableToMd(rows: string[][]): string {
  if (!rows.length) return "";
  const out = [`| ${rows[0].join(" | ")} |`, `| ${rows[0].map(() => "---").join(" | ")} |`];
  for (const r of rows.slice(1)) out.push(`| ${r.join(" | ")} |`);
  return out.join("\n");
}

/** Serialise a block to source: markdown where possible, HTML where richer. */
function blockToSource(b: Block): string {
  switch (b.type) {
    case "heading":
      return b.color ? blockToHtml(b) : "#".repeat(Math.min(Math.max(b.level || 3, 1), 5)) + " " + (b.text || "");
    case "text":
      return b.text || "";
    case "list":
      return (b.items || []).map((i) => "- " + i).join("\n");
    case "table":
      return tableToMd(b.rows || []);
    case "image":
      return `![${b.text || ""}](${b.src || ""})`;
    case "divider":
      return "---";
    case "box":
    case "dropdown":
      return blockToHtml(b);
    case "html":
      return b.text || "";
  }
}

export function blocksToSource(blocks: Block[]): string {
  return blocks.map(blockToSource).join("\n\n");
}

function parseDataB(line: string): Block | null {
  const doc = new DOMParser().parseFromString(`<body>${line}</body>`, "text/html");
  const el = doc.body.firstElementChild;
  if (!el) return null;
  const t = el.getAttribute("data-b");
  const color = el.getAttribute("data-c") || undefined;
  if (t === "heading") return { id: uid(), type: "heading", level: parseInt(el.tagName.slice(1), 10) || 3, text: el.textContent || "", color };
  if (t === "box") return { id: uid(), type: "box", text: unbr(el.innerHTML), color };
  if (t === "dropdown") {
    return { id: uid(), type: "dropdown", title: el.querySelector("summary")?.textContent || "Details", text: unbr(el.querySelector("div")?.innerHTML || ""), color };
  }
  if (t === "divider") return { id: uid(), type: "divider" };
  return null;
}

function parseTableRows(lines: string[]): string[][] {
  return lines
    .filter((r) => !/^\s*\|?[\s:|-]+\|?\s*$/.test(r))
    .map((r) => r.split("|").slice(1, -1).map((c) => c.trim()));
}

/** Parse page source (markdown + HTML) into editable blocks. */
export function contentToBlocks(src: string): Block[] {
  const lines = (src || "").replace(/\r\n/g, "\n").split("\n");
  const blocks: Block[] = [];
  let para: string[] = [];
  let list: string[] = [];
  let table: string[] = [];
  let html: string[] = [];
  const flushPara = () => para.length && (blocks.push({ id: uid(), type: "text", text: para.join("\n") }), (para = []));
  const flushList = () => list.length && (blocks.push({ id: uid(), type: "list", items: list.slice() }), (list = []));
  const flushTable = () => table.length && (blocks.push({ id: uid(), type: "table", rows: parseTableRows(table) }), (table = []));
  const flushHtml = () => html.length && (blocks.push({ id: uid(), type: "html", text: html.join("\n") }), (html = []));
  const flushAll = () => {
    flushPara();
    flushList();
    flushTable();
    flushHtml();
  };

  for (const raw of lines) {
    const t = raw.trim();
    if (!t) {
      flushAll();
      continue;
    }
    if (/\bdata-b="\w+"/.test(t)) {
      const b = parseDataB(t);
      if (b) {
        flushAll();
        blocks.push(b);
        continue;
      }
    }
    const h = t.match(/^(#{1,5})\s+(.+)$/);
    if (h) {
      flushAll();
      blocks.push({ id: uid(), type: "heading", level: h[1].length, text: h[2] });
      continue;
    }
    if (/^-{3,}$/.test(t)) {
      flushAll();
      blocks.push({ id: uid(), type: "divider" });
      continue;
    }
    const img = t.match(/^!\[([^\]]*)\]\(([^)\s]+)\)$/);
    if (img) {
      flushAll();
      blocks.push({ id: uid(), type: "image", text: img[1], src: img[2] });
      continue;
    }
    if (/^\|/.test(t)) {
      flushPara();
      flushList();
      flushHtml();
      table.push(t);
      continue;
    }
    const li = t.match(/^[-*]\s+(.+)$/);
    if (li) {
      flushPara();
      flushTable();
      flushHtml();
      list.push(li[1]);
      continue;
    }
    if (t.startsWith("<")) {
      flushPara();
      flushList();
      flushTable();
      html.push(raw);
      continue;
    }
    flushList();
    flushTable();
    flushHtml();
    para.push(raw);
  }
  flushAll();
  return blocks;
}

interface Props {
  value: string;
  onChange: (source: string) => void;
}

export function VisualBlockEditor({ value, onChange }: Props) {
  const [blocks, setBlocks] = useState<Block[]>(() => contentToBlocks(value));
  const first = useRef(true);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    onChange(blocksToSource(blocks));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blocks]);

  function add(type: BlockType) {
    const b: Block = { id: uid(), type };
    if (type === "heading") {
      b.level = 3;
      b.color = COLORS[0];
    }
    if (type === "box" || type === "dropdown") b.color = COLORS[0];
    if (type === "list") b.items = [""];
    if (type === "table") b.rows = [["", ""], ["", ""]];
    setBlocks((bs) => [...bs, b]);
  }
  function patch(id: string, p: Partial<Block>) {
    setBlocks((bs) => bs.map((b) => (b.id === id ? { ...b, ...p } : b)));
  }
  function remove(id: string) {
    setBlocks((bs) => bs.filter((b) => b.id !== id));
  }
  function move(id: string, dir: -1 | 1) {
    setBlocks((bs) => {
      const i = bs.findIndex((b) => b.id === id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= bs.length) return bs;
      const next = [...bs];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  }

  return (
    <div className="vbe">
      <div className="vbe-palette">
        <button className="chip" onClick={() => add("heading")}>+ Heading</button>
        <button className="chip" onClick={() => add("text")}>+ Text</button>
        <button className="chip" onClick={() => add("box")}>+ Box</button>
        <button className="chip" onClick={() => add("dropdown")}>+ Dropdown</button>
        <button className="chip" onClick={() => add("list")}>+ List</button>
        <button className="chip" onClick={() => add("table")}>+ Table</button>
        <button className="chip" onClick={() => add("image")}>+ Image</button>
        <button className="chip" onClick={() => add("divider")}>+ Divider</button>
        <button className="chip" onClick={() => add("html")}>+ HTML</button>
      </div>

      {blocks.length === 0 && <p className="pe-hint">Add blocks above to build the page — no code needed.</p>}

      <div className="vbe-blocks">
        {blocks.map((b) => (
          <div className="vbe-block" key={b.id}>
            <div className="vbe-ctrls">
              <span className="vbe-kind">{b.type}</span>
              {(b.type === "heading" || b.type === "box" || b.type === "dropdown") && (
                <span className="vbe-swatches">
                  {COLORS.map((c) => (
                    <button key={c} className={"vbe-sw" + (b.color === c ? " on" : "")} style={{ background: c }} onClick={() => patch(b.id, { color: c })} />
                  ))}
                </span>
              )}
              {b.type === "heading" && (
                <select className="vbe-lvl" value={b.level || 3} onChange={(e) => patch(b.id, { level: parseInt(e.target.value, 10) })}>
                  {[1, 2, 3, 4, 5].map((l) => (
                    <option key={l} value={l}>H{l}</option>
                  ))}
                </select>
              )}
              <span className="rank-spacer" />
              <button className="cdx-flag" title="Move up" onClick={() => move(b.id, -1)}>↑</button>
              <button className="cdx-flag" title="Move down" onClick={() => move(b.id, 1)}>↓</button>
              <button className="cdx-flag" title="Remove" onClick={() => remove(b.id)}>✕</button>
            </div>

            {b.type === "heading" && (
              <input className="vbe-heading" style={{ color: b.color }} placeholder="Heading…" value={b.text || ""} onChange={(e) => patch(b.id, { text: e.target.value })} />
            )}
            {b.type === "text" && (
              <textarea className="vbe-text" placeholder="Write text (markdown ok)…" value={b.text || ""} onChange={(e) => patch(b.id, { text: e.target.value })} />
            )}
            {b.type === "box" && (
              <textarea className="vbe-text vbe-box-body" style={{ borderLeft: `3px solid ${b.color}`, background: tint(b.color) }} placeholder="Callout box text…" value={b.text || ""} onChange={(e) => patch(b.id, { text: e.target.value })} />
            )}
            {b.type === "dropdown" && (
              <>
                <input className="vbe-drop-title" style={{ color: b.color }} placeholder="Dropdown label…" value={b.title || ""} onChange={(e) => patch(b.id, { title: e.target.value })} />
                <textarea className="vbe-text" placeholder="Hidden content…" value={b.text || ""} onChange={(e) => patch(b.id, { text: e.target.value })} />
              </>
            )}
            {b.type === "list" && (
              <textarea className="vbe-text" placeholder="One item per line…" value={(b.items || []).join("\n")} onChange={(e) => patch(b.id, { items: e.target.value.split("\n") })} />
            )}
            {b.type === "table" && <TableEditor rows={b.rows || []} onChange={(rows) => patch(b.id, { rows })} />}
            {b.type === "image" && (
              <div className="vbe-img-row">
                <input className="bg-select full" placeholder="Image URL (http/data:)…" value={b.src || ""} onChange={(e) => patch(b.id, { src: e.target.value })} />
                <input className="bg-select" placeholder="Alt text" value={b.text || ""} onChange={(e) => patch(b.id, { text: e.target.value })} />
                {b.src && <img className="vbe-img-preview" src={b.src} alt="" />}
              </div>
            )}
            {b.type === "html" && (
              <textarea className="vbe-text vbe-html" spellCheck={false} placeholder="<div>raw HTML…</div>" value={b.text || ""} onChange={(e) => patch(b.id, { text: e.target.value })} />
            )}
            {b.type === "divider" && <hr className="vbe-divider" />}
          </div>
        ))}
      </div>
    </div>
  );
}

function TableEditor({ rows, onChange }: { rows: string[][]; onChange: (r: string[][]) => void }) {
  const cols = rows[0]?.length || 0;
  function setCell(r: number, c: number, v: string) {
    const next = rows.map((row) => row.slice());
    next[r][c] = v;
    onChange(next);
  }
  function addRow() {
    onChange([...rows, Array.from({ length: cols || 1 }, () => "")]);
  }
  function addCol() {
    onChange(rows.map((row) => [...row, ""]));
  }
  return (
    <div className="vbe-table-wrap">
      <table className="vbe-table">
        <tbody>
          {rows.map((row, r) => (
            <tr key={r}>
              {row.map((cell, c) => (
                <td key={c}>
                  <input value={cell} placeholder={r === 0 ? "header" : ""} onChange={(e) => setCell(r, c, e.target.value)} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="vbe-table-btns">
        <button className="cdx-flag" onClick={addRow}>+ Row</button>
        <button className="cdx-flag" onClick={addCol}>+ Col</button>
      </div>
    </div>
  );
}
