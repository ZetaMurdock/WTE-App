// Semantic doc → HTML. Emitted as ONE line (the Codex markdown renderer treats
// each line independently, passing raw-HTML lines through verbatim — a single
// line keeps nested structures intact). Colours default to theme vars so pages
// follow the app theme unless the author picks a colour.
import type { WdDoc, WdNode } from "./model";

function esc(s: string): string {
  return (s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function one(s: string): string {
  return (s || "").replace(/\r?\n/g, " ");
}
function tint(hex?: string): string {
  return hex ? hex + "22" : "rgba(126,207,202,0.08)";
}
function alignStyle(a?: string): string {
  return a && a !== "left" ? `text-align:${a};` : "";
}

export function renderNode(n: WdNode): string {
  switch (n.type) {
    case "container": {
      const inner = n.children.map(renderNode).join("");
      const gap = `display:flex;flex-direction:column;gap:${n.gap ?? 10}px;`;
      const pad = `padding:${n.pad ?? (n.style === "plain" ? 0 : 14)}px;`;
      if (n.style === "callout")
        return `<div class="cdx-callout wd" style="${gap}${pad}border-left:3px solid ${n.color || "var(--accent)"};background:${tint(n.color)}">${inner}</div>`;
      if (n.style === "panel")
        return `<div class="wd-panel wd" style="${gap}${pad}border-color:${n.color || "var(--panel-line)"}">${inner}</div>`;
      return `<div class="wd" style="${gap}${pad}">${inner}</div>`;
    }
    case "columns": {
      const cols = n.cols.map((c) => `<div class="wd-col" style="display:flex;flex-direction:column;gap:10px;min-width:0">${c.map(renderNode).join("")}</div>`).join("");
      return `<div class="wd-cols" style="display:grid;grid-template-columns:repeat(${n.cols.length},1fr);gap:${n.gap ?? 14}px">${cols}</div>`;
    }
    case "heading": {
      const lvl = Math.min(Math.max(n.level || 2, 1), 5);
      return `<h${lvl} class="wd" style="margin:0;${alignStyle(n.align)}color:${n.color || "var(--accent)"}">${esc(n.text)}</h${lvl}>`;
    }
    case "text":
      return `<div class="wd-text wd" style="${alignStyle(n.align)}">${one(n.html)}</div>`;
    case "image": {
      if (!n.src) return "";
      const w = Math.min(Math.max(n.width ?? 100, 10), 100);
      const m = n.align === "center" ? "margin:0 auto;" : n.align === "right" ? "margin-left:auto;" : "";
      return `<img class="wd-img wd" src="${esc(n.src)}" alt="${esc(n.alt || "")}" style="display:block;${m}width:${w}%;border-radius:6px"/>`;
    }
    case "divider":
      return `<hr class="wd" style="border:none;border-top:1px solid ${n.color || "var(--panel-line)"};margin:6px 0"/>`;
    case "spacer":
      return `<div class="wd" style="height:${Math.max(4, n.h || 24)}px"></div>`;
    case "spoiler": {
      const inner = n.children.map(renderNode).join("");
      return `<details class="cdx-drop wd"><summary style="color:${n.color || "var(--accent)"}">${esc(n.title || "Details")}</summary><div style="display:flex;flex-direction:column;gap:10px">${inner}</div></details>`;
    }
    case "table": {
      const rows = (n.rows || [])
        .map((r, i) => `<tr>${r.map((c) => (i === 0 ? `<th>${esc(c)}</th>` : `<td>${esc(c)}</td>`)).join("")}</tr>`)
        .join("");
      return `<table class="wd-table wd" style="border-color:${n.color || "var(--panel-line)"}">${rows}</table>`;
    }
  }
}

export function renderDocHtml(doc: WdDoc): string {
  return `<div class="wd-page" style="display:flex;flex-direction:column;gap:12px">${doc.children.map(renderNode).join("")}</div>`;
}
