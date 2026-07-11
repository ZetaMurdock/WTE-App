// Minimal renderer for Codex pages: markdown with raw-HTML passthrough (the wiki
// mirror saves pages as `# Title` + arbitrary HTML). Produces an HTML string for
// the Codex reader; link clicks are intercepted by the reader, not here.

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function inline(s: string): string {
  let t = esc(s);
  t = t.replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>");
  t = t.replace(/\*([^*]+)\*/g, "<i>$1</i>");
  t = t.replace(/`([^`]+)`/g, "<code>$1</code>");
  t = t.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2">$1</a>');
  return t;
}

export function renderCodexHtml(md: string): string {
  const lines = (md || "").replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  let para: string[] = [];
  let table: string[] = [];
  let list: string[] = [];

  const flushPara = () => {
    if (para.length) out.push(`<p>${para.join(" ")}</p>`);
    para = [];
  };
  const flushTable = () => {
    if (!table.length) return;
    const rows = table
      .filter((r) => !/^\s*\|?[\s:|-]+\|?\s*$/.test(r)) // drop |---|---| separators
      .map((r, i) => {
        const cells = r.split("|").slice(1, -1).map((c) => inline(c.trim()));
        const tag = i === 0 ? "th" : "td";
        return `<tr>${cells.map((c) => `<${tag}>${c}</${tag}>`).join("")}</tr>`;
      });
    out.push(`<table>${rows.join("")}</table>`);
    table = [];
  };
  const flushList = () => {
    if (list.length) out.push(`<ul>${list.map((li) => `<li>${li}</li>`).join("")}</ul>`);
    list = [];
  };
  const flushAll = () => {
    flushPara();
    flushTable();
    flushList();
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    const t = line.trim();
    if (!t) {
      flushAll();
      continue;
    }
    if (t.startsWith("<")) {
      // raw HTML block line — pass through untouched (wiki-mirrored content)
      flushAll();
      out.push(line);
      continue;
    }
    const h = t.match(/^(#{1,5})\s+(.+)$/);
    if (h) {
      flushAll();
      const lvl = Math.min(h[1].length, 5);
      out.push(`<h${lvl}>${inline(h[2])}</h${lvl}>`);
      continue;
    }
    if (/^\|/.test(t)) {
      flushPara();
      flushList();
      table.push(t);
      continue;
    }
    if (/^\s*-{3,}\s*$/.test(t)) {
      flushAll();
      out.push("<hr/>");
      continue;
    }
    const li = t.match(/^[-*]\s+(.+)$/);
    if (li) {
      flushPara();
      flushTable();
      list.push(inline(li[1]));
      continue;
    }
    flushTable();
    flushList();
    para.push(inline(t));
  }
  flushAll();
  return out.join("\n");
}

/** The page's display title: first heading, else the file stem prettified. */
export function pageTitle(md: string, stem: string): string {
  const m = (md || "").match(/^#{1,4}\s+(.+)$/m);
  if (m) return m[1].replace(/<[^>]*>/g, "").trim();
  return stem.replace(/_/g, " ");
}
