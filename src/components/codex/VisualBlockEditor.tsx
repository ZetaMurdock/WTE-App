import { useEffect, useRef, useState } from "react";

// No-code page builder: authors stack blocks (heading / text / callout box /
// dropdown / divider) and set colours; the editor serialises them to HTML (each
// block one line, tagged data-b for round-tripping) that the Codex reader renders
// verbatim. "Translate HTML ↔ blocks" both ways so existing visual pages re-open.

type BlockType = "heading" | "text" | "box" | "dropdown" | "divider";
interface Block {
  id: string;
  type: BlockType;
  text?: string;
  title?: string;
  color?: string;
}

const COLORS = ["#7ecfca", "#a1584a", "#a08a4f", "#6f9a68", "#837aae", "#a7aebd"];

let seq = 0;
const uid = () => "b" + Date.now().toString(36) + (seq++).toString(36);

function esc(s: string): string {
  return (s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
/** Escape + preserve line breaks as <br> so the block stays on one line. */
function escMulti(s: string): string {
  return esc(s).replace(/\n/g, "<br>");
}
function unbr(s: string): string {
  return (s || "").replace(/<br\s*\/?>/gi, "\n");
}
/** 20%-alpha tint of a #rrggbb colour. */
function tint(hex?: string): string {
  return hex ? hex + "22" : "transparent";
}

export function blockToHtml(b: Block): string {
  switch (b.type) {
    case "heading":
      return `<h3 data-b="heading"${b.color ? ` data-c="${b.color}"` : ""} style="color:${b.color || "var(--accent)"}">${esc(b.text || "")}</h3>`;
    case "text":
      return `<p data-b="text">${escMulti(b.text || "")}</p>`;
    case "box":
      return `<div data-b="box"${b.color ? ` data-c="${b.color}"` : ""} class="cdx-callout" style="border-left:3px solid ${b.color || "var(--accent)"};background:${tint(b.color)}">${escMulti(b.text || "")}</div>`;
    case "dropdown":
      return `<details data-b="dropdown"${b.color ? ` data-c="${b.color}"` : ""} class="cdx-drop"><summary style="color:${b.color || "var(--accent)"}">${esc(b.title || "Details")}</summary><div>${escMulti(b.text || "")}</div></details>`;
    case "divider":
      return `<hr data-b="divider"/>`;
  }
}

function serialize(blocks: Block[]): string {
  return blocks.map(blockToHtml).join("\n");
}

/** Parse editor-authored HTML back into blocks; null if it isn't block HTML. */
export function htmlToBlocks(html: string): Block[] | null {
  if (!html || !/data-b=/.test(html)) return null;
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
  const blocks: Block[] = [];
  for (const el of Array.from(doc.body.children)) {
    const t = el.getAttribute("data-b") as BlockType | null;
    const color = el.getAttribute("data-c") || undefined;
    if (t === "heading") blocks.push({ id: uid(), type: "heading", text: el.textContent || "", color });
    else if (t === "text") blocks.push({ id: uid(), type: "text", text: unbr(el.innerHTML) });
    else if (t === "box") blocks.push({ id: uid(), type: "box", text: unbr(el.innerHTML), color });
    else if (t === "dropdown") {
      const sum = el.querySelector("summary")?.textContent || "Details";
      const body = el.querySelector("div")?.innerHTML || "";
      blocks.push({ id: uid(), type: "dropdown", title: sum, text: unbr(body), color });
    } else if (t === "divider") blocks.push({ id: uid(), type: "divider" });
  }
  return blocks.length ? blocks : null;
}

interface Props {
  value: string;
  onChange: (html: string) => void;
}

export function VisualBlockEditor({ value, onChange }: Props) {
  const [blocks, setBlocks] = useState<Block[]>(() => htmlToBlocks(value) ?? []);
  const first = useRef(true);

  // Push serialized HTML up whenever blocks change (but not on the first render).
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    onChange(serialize(blocks));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blocks]);

  function add(type: BlockType) {
    setBlocks((bs) => [...bs, { id: uid(), type, color: type === "divider" || type === "text" ? undefined : COLORS[0] }]);
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
        <button className="chip" onClick={() => add("heading")}>＋ Heading</button>
        <button className="chip" onClick={() => add("text")}>＋ Text</button>
        <button className="chip" onClick={() => add("box")}>＋ Box</button>
        <button className="chip" onClick={() => add("dropdown")}>＋ Dropdown</button>
        <button className="chip" onClick={() => add("divider")}>＋ Divider</button>
      </div>

      {blocks.length === 0 && <p className="pe-hint">Add blocks above to build the page — no code needed.</p>}

      <div className="vbe-blocks">
        {blocks.map((b) => (
          <div className="vbe-block" key={b.id}>
            <div className="vbe-ctrls">
              <span className="vbe-kind">{b.type}</span>
              {b.type !== "divider" && b.type !== "text" && (
                <span className="vbe-swatches">
                  {COLORS.map((c) => (
                    <button
                      key={c}
                      className={"vbe-sw" + (b.color === c ? " on" : "")}
                      style={{ background: c }}
                      onClick={() => patch(b.id, { color: c })}
                    />
                  ))}
                </span>
              )}
              <span className="rank-spacer" />
              <button className="cdx-flag" title="Move up" onClick={() => move(b.id, -1)}>↑</button>
              <button className="cdx-flag" title="Move down" onClick={() => move(b.id, 1)}>↓</button>
              <button className="cdx-flag" title="Remove" onClick={() => remove(b.id)}>✕</button>
            </div>

            {b.type === "heading" && (
              <input
                className="vbe-heading"
                style={{ color: b.color }}
                placeholder="Heading…"
                value={b.text || ""}
                onChange={(e) => patch(b.id, { text: e.target.value })}
              />
            )}
            {b.type === "text" && (
              <textarea className="vbe-text" placeholder="Write text…" value={b.text || ""} onChange={(e) => patch(b.id, { text: e.target.value })} />
            )}
            {b.type === "box" && (
              <textarea
                className="vbe-text vbe-box-body"
                style={{ borderLeft: `3px solid ${b.color}`, background: tint(b.color) }}
                placeholder="Callout box text…"
                value={b.text || ""}
                onChange={(e) => patch(b.id, { text: e.target.value })}
              />
            )}
            {b.type === "dropdown" && (
              <>
                <input
                  className="vbe-drop-title"
                  style={{ color: b.color }}
                  placeholder="Dropdown label…"
                  value={b.title || ""}
                  onChange={(e) => patch(b.id, { title: e.target.value })}
                />
                <textarea className="vbe-text" placeholder="Hidden content…" value={b.text || ""} onChange={(e) => patch(b.id, { text: e.target.value })} />
              </>
            )}
            {b.type === "divider" && <hr className="vbe-divider" />}
          </div>
        ))}
      </div>
    </div>
  );
}
