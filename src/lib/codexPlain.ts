// A page's mechanics, whichever editor wrote it.
//
// Every rule parser in the app reads Markdown: `| Field | Value |` rows, `##`
// headings, `- **Ability** — effect` bullets. The Visual Engine does not write
// any of that. It writes a semantic tree in a `<!--wte-doc {…}-->` comment
// followed by generated HTML for the reader — so the moment a Curator opened a
// mechanics page in the visual editor and saved, every field row became a
// `<td>` and the page stopped being a rule.
//
// It failed silently and in two places at once. `pageIdentity` could no longer
// read `Type`, so the page was filed as a generic `page` with no `Overrides`,
// and `gameData` could no longer read `Type` either, so it was skipped entirely.
// The Curator saw their edit saved, in the Codex, badged Pulled — and no effect
// anywhere in the game.
//
// This turns either representation back into the Markdown the parsers expect.
// The semantic tree is authoritative when present: it is what the editor round
// trips, and it survives changes to the generated HTML.

/** The subset of the Visual Engine's node shapes that can carry mechanics.
 *  Structural nodes are walked for their children; the rest contribute nothing.
 *  Declared here rather than imported so this stays free of the editor's React
 *  dependencies — the loader runs long before any editor is mounted. */
interface WdNodeLike {
  type?: string;
  level?: number;
  text?: string;
  html?: string;
  title?: string;
  rows?: unknown;
  children?: unknown;
  cols?: unknown;
}

const DOC_RE = /<!--wte-doc (.+?)-->/;
/** The key cell of a `| Key | Value |` row. */
const ROW_KEY_RE = /^\s*\|\s*([^|]+?)\s*\|/;

/** Inline HTML → text. Block-level tags become newlines so a `<br>`-separated
 *  list of ability bullets does not collapse onto one unparseable line. */
function htmlToText(html: string): string {
  return (html || "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr|h[1-6])>/gi, "\n")
    .replace(/<li[^>]*>/gi, "- ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function cell(value: unknown): string {
  return htmlToText(String(value ?? "")).replace(/\r?\n+/g, " ").trim();
}

function emit(node: WdNodeLike, out: string[]): void {
  switch (node.type) {
    case "heading": {
      const level = Math.min(Math.max(Number(node.level) || 3, 1), 6);
      out.push(`${"#".repeat(level)} ${cell(node.text)}`);
      return;
    }
    case "table": {
      if (!Array.isArray(node.rows)) return;
      for (const row of node.rows) {
        if (!Array.isArray(row) || !row.length) continue;
        out.push(`| ${row.map(cell).join(" | ")} |`);
      }
      return;
    }
    case "text":
      out.push(htmlToText(String(node.html ?? "")));
      return;
    // A spoiler's title is a heading in every way that matters to a parser:
    // Curators file variant and ability blocks inside collapsible sections.
    case "spoiler":
      out.push(`### ${cell(node.title)}`);
      walk(node.children, out);
      return;
    case "container":
      walk(node.children, out);
      return;
    case "columns": {
      if (!Array.isArray(node.cols)) return;
      for (const column of node.cols) walk(column, out);
      return;
    }
    default:
      // image, divider, spacer, and anything a later version adds. Unknown
      // nodes are skipped rather than guessed at.
      return;
  }
}

function walk(nodes: unknown, out: string[]): void {
  if (!Array.isArray(nodes)) return;
  for (const node of nodes) {
    if (node && typeof node === "object") emit(node as WdNodeLike, out);
  }
}

/** True when this page was written by the Visual Engine. */
export function isVisualDocPage(content: string): boolean {
  return DOC_RE.test(content || "");
}

/**
 * A page as Markdown, for any parser that reads rules out of one.
 *
 * Markdown pages are returned untouched — the parsers' behaviour on the
 * existing corpus must not shift by a single character. A visual page is
 * flattened from its semantic tree.
 */
export function codexPlainSource(content: string): string {
  const raw = content || "";
  const match = raw.match(DOC_RE);
  if (!match) return raw;
  let doc: { children?: unknown };
  try {
    doc = JSON.parse(match[1]) as { children?: unknown };
  } catch {
    // A damaged comment must not cost the page its mechanics: the generated
    // HTML below it still holds the same table.
    return htmlToText(raw.replace(DOC_RE, ""));
  }
  if (!doc || !Array.isArray(doc.children)) return htmlToText(raw.replace(DOC_RE, ""));
  const out: string[] = [];
  walk(doc.children, out);
  // The identity rows that `withIdentityRow` prepends live OUTSIDE the doc
  // comment, as loose Markdown. Keep them, or a visual page loses the very id
  // that says which rule it replaces — but only where the authored table is
  // silent. A page can carry BOTH (the prepended row was added precisely
  // because the table could not be read), and then they disagree: one reader
  // takes the first match and another takes the last, so the same page resolves
  // to two different rules. The authored table wins, once, for every reader.
  const rowKey = (line: string): string | null => {
    const m = line.match(ROW_KEY_RE);
    return m ? m[1].toLowerCase() : null;
  };
  const declared = new Set(out.map(rowKey).filter(Boolean));
  const loose = raw
    .slice(0, match.index ?? 0)
    .split("\n")
    .filter((line) => {
      const key = rowKey(line);
      return key !== null && !declared.has(key);
    })
    .join("\n");
  return [loose, out.join("\n\n")].filter((part) => part.trim()).join("\n\n");
}
