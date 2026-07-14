// The Visual Engine's semantic document model. Users compose CONTENT concepts
// (Section, Information Box, Heading, Columns…) — never HTML tags. The tree is
// the source of truth, embedded in the saved page as a single-line JSON comment
// (<!--wte-doc {…}-->) followed by generated HTML for the Codex reader. Because
// the model is semantic, the rendering target can change without touching docs.
import { contentToBlocks } from "../VisualBlockEditor";

export type WdAlign = "left" | "center" | "right";
export type WdContainerStyle = "plain" | "callout" | "panel";

export interface WdContainer {
  id: string;
  type: "container";
  style: WdContainerStyle;
  color?: string;
  pad?: number;
  gap?: number;
  children: WdNode[];
}
export interface WdColumns {
  id: string;
  type: "columns";
  gap?: number;
  cols: WdNode[][];
}
export interface WdHeading {
  id: string;
  type: "heading";
  level: number; // 1..5
  text: string;
  color?: string;
  align?: WdAlign;
}
export interface WdText {
  id: string;
  type: "text";
  html: string; // rich inline HTML from the canvas (b/i/u/spans)
  align?: WdAlign;
}
export interface WdImage {
  id: string;
  type: "image";
  src: string;
  alt?: string;
  width?: number; // percent 10..100
  align?: WdAlign;
}
export interface WdDivider {
  id: string;
  type: "divider";
  color?: string;
}
export interface WdSpacer {
  id: string;
  type: "spacer";
  h: number; // px
}
export interface WdSpoiler {
  id: string;
  type: "spoiler";
  title: string;
  color?: string;
  children: WdNode[];
}
export interface WdTable {
  id: string;
  type: "table";
  rows: string[][];
  color?: string;
}

export type WdNode = WdContainer | WdColumns | WdHeading | WdText | WdImage | WdDivider | WdSpacer | WdSpoiler | WdTable;

export interface WdDoc {
  v: 1;
  children: WdNode[];
}

let seq = 0;
export const wdId = (): string => "w" + Date.now().toString(36) + (seq++).toString(36);

export const WD_COLORS = ["#7ecfca", "#a1584a", "#a08a4f", "#6f9a68", "#837aae", "#a7aebd"];

// ── Factories ──
export function makeNode(kind: string): WdNode {
  switch (kind) {
    case "section":
      return { id: wdId(), type: "container", style: "plain", children: [] };
    case "callout":
      return { id: wdId(), type: "container", style: "callout", color: WD_COLORS[0], children: [] };
    case "panel":
      return { id: wdId(), type: "container", style: "panel", color: WD_COLORS[0], children: [] };
    case "columns":
      return { id: wdId(), type: "columns", cols: [[], []] };
    case "heading":
      return { id: wdId(), type: "heading", level: 2, text: "Heading" };
    case "text":
      return { id: wdId(), type: "text", html: "Write here…" };
    case "image":
      return { id: wdId(), type: "image", src: "", width: 100 };
    case "divider":
      return { id: wdId(), type: "divider" };
    case "spacer":
      return { id: wdId(), type: "spacer", h: 24 };
    case "spoiler":
      return { id: wdId(), type: "spoiler", title: "Details", color: WD_COLORS[0], children: [{ id: wdId(), type: "text", html: "Hidden content…" }] };
    case "table":
      return { id: wdId(), type: "table", rows: [["Header", "Header"], ["", ""]] };
    default:
      return { id: wdId(), type: "text", html: "" };
  }
}

// ── Component presets (reusable semantic components) ──
export function makeComponent(kind: string): WdNode {
  if (kind === "infobox") {
    return {
      id: wdId(), type: "container", style: "panel", color: WD_COLORS[0], children: [
        { id: wdId(), type: "heading", level: 3, text: "Information", color: WD_COLORS[0] },
        { id: wdId(), type: "text", html: "Describe the subject here." },
      ],
    };
  }
  if (kind === "speciescard") {
    return {
      id: wdId(), type: "container", style: "panel", color: WD_COLORS[4], children: [
        {
          id: wdId(), type: "columns", cols: [
            [{ id: wdId(), type: "image", src: "", width: 100 } as WdNode],
            [
              { id: wdId(), type: "heading", level: 2, text: "Species Name", color: WD_COLORS[4] },
              { id: wdId(), type: "text", html: "Overview of the species." },
              { id: wdId(), type: "table", rows: [["Trait", "Value"], ["Size", "Moderate"], ["Homeworld", "—"]] },
            ] as WdNode[],
          ],
        },
      ],
    };
  }
  if (kind === "statpanel") {
    return {
      id: wdId(), type: "container", style: "callout", color: WD_COLORS[2], children: [
        { id: wdId(), type: "heading", level: 4, text: "Stats", color: WD_COLORS[2] },
        { id: wdId(), type: "table", rows: [["Stat", "Value"], ["HP", "0"], ["DR", "0"]] },
      ],
    };
  }
  if (kind === "quote") {
    return {
      id: wdId(), type: "container", style: "callout", color: WD_COLORS[3], children: [
        { id: wdId(), type: "text", html: "<i>“Quote goes here.”</i>" },
      ],
    };
  }
  if (kind === "warning") {
    return {
      id: wdId(), type: "container", style: "callout", color: WD_COLORS[1], children: [
        { id: wdId(), type: "heading", level: 4, text: "⚠ Warning", color: WD_COLORS[1] },
        { id: wdId(), type: "text", html: "Important caution text." },
      ],
    };
  }
  return makeNode(kind);
}

// ── Semantic labels + icons for the layers tree ──
export function nodeLabel(n: WdNode): string {
  switch (n.type) {
    case "container":
      return n.style === "panel" ? "Information Box" : n.style === "callout" ? "Callout" : "Section";
    case "columns":
      return `Columns (${n.cols.length})`;
    case "heading":
      return `Heading · ${(n.text || "").slice(0, 18) || "…"}`;
    case "text":
      return "Paragraph";
    case "image":
      return "Image";
    case "divider":
      return "Divider";
    case "spacer":
      return "Spacer";
    case "spoiler":
      return `Dropdown · ${(n.title || "").slice(0, 14)}`;
    case "table":
      return "Table";
  }
}
export function nodeIcon(n: WdNode): string {
  switch (n.type) {
    case "container":
      return n.style === "plain" ? "🧩" : "📦";
    case "columns":
      return "◫";
    case "heading":
      return "📝";
    case "text":
      return "📖";
    case "image":
      return "🖼";
    case "divider":
      return "─";
    case "spacer":
      return "⬜";
    case "spoiler":
      return "▸";
    case "table":
      return "📊";
  }
}

// ── Embed / extract the doc in page source ──
const DOC_RE = /<!--wte-doc (.+?)-->/;

export function extractDoc(source: string): WdDoc | null {
  const m = (source || "").match(DOC_RE);
  if (!m) return null;
  try {
    const doc = JSON.parse(m[1]) as WdDoc;
    return doc && Array.isArray(doc.children) ? doc : null;
  } catch {
    return null;
  }
}

export function embedDoc(doc: WdDoc, html: string): string {
  const json = JSON.stringify(doc).replace(/-->/g, "--\\u003e");
  return `<!--wte-doc ${json}-->\n${html}`;
}

// ── Import a legacy markdown/HTML page into a semantic doc (best-effort) ──
function escapeHtml(s: string): string {
  return (s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
export function importLegacy(source: string): WdDoc {
  const doc: WdDoc = { v: 1, children: [] };
  if (!source || !source.trim()) return doc;
  for (const b of contentToBlocks(source)) {
    if (b.type === "heading") doc.children.push({ id: wdId(), type: "heading", level: b.level || 3, text: b.text || "", color: b.color });
    else if (b.type === "text") doc.children.push({ id: wdId(), type: "text", html: escapeHtml(b.text || "").replace(/\n/g, "<br>") });
    else if (b.type === "list") doc.children.push({ id: wdId(), type: "text", html: `<ul>${(b.items || []).map((i) => `<li>${escapeHtml(i)}</li>`).join("")}</ul>` });
    else if (b.type === "table") doc.children.push({ id: wdId(), type: "table", rows: b.rows || [] });
    else if (b.type === "image") doc.children.push({ id: wdId(), type: "image", src: b.src || "", alt: b.text, width: 100 });
    else if (b.type === "box") doc.children.push({ id: wdId(), type: "container", style: "callout", color: b.color, children: [{ id: wdId(), type: "text", html: escapeHtml(b.text || "").replace(/\n/g, "<br>") }] });
    else if (b.type === "dropdown") doc.children.push({ id: wdId(), type: "spoiler", title: b.title || "Details", color: b.color, children: [{ id: wdId(), type: "text", html: escapeHtml(b.text || "").replace(/\n/g, "<br>") }] });
    else if (b.type === "divider") doc.children.push({ id: wdId(), type: "divider" });
    else if (b.type === "html") doc.children.push({ id: wdId(), type: "text", html: b.text || "" });
  }
  return doc;
}
