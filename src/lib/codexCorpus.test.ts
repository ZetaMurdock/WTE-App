// @vitest-environment happy-dom
//
// Regression guard for the sanitizer against REAL Codex pages. 319 of the 336
// pages on this machine contain raw HTML (49,676 <td>, MathML, SVG, 12,483 style
// attributes), so the risk of allowlist sanitization is not that it lets script
// through — it is that it quietly eats the rules content.
//
// The bundled pages under src/rules are always checked. If a full wiki mirror is
// present in APP DATA on this machine, those are swept too; on another machine or
// in CI that directory is absent and the sweep is skipped rather than failing.
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { renderCodexHtml } from "./md";
import { sanitizeHtml } from "./sanitizeHtml";

const BUNDLED = path.resolve(__dirname, "../rules");
const MIRROR = process.env.APPDATA ? path.join(process.env.APPDATA, "com.wte.tabletop/rules") : "";

function pagesIn(dir: string): { name: string; md: string }[] {
  if (!dir || !fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .map((f) => ({ name: f, md: fs.readFileSync(path.join(dir, f), "utf8") }));
}

// The comparison must not count markdown emphasis markers or HTML comments as
// "prose". renderCodexHtml legitimately turns **bold** into <b>bold</b> (so the
// asterisks vanish) and the parser drops MediaWiki transclusion comments. Counting
// either as lost content produced three false positives on the real corpus.
const textOf = (html: string) =>
  html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/[*_`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
const tagsOf = (html: string) => {
  const c: Record<string, number> = {};
  for (const m of html.matchAll(/<\s*([a-zA-Z][a-zA-Z0-9-]*)/g)) {
    const t = m[1].toLowerCase();
    c[t] = (c[t] || 0) + 1;
  }
  return c;
};

/** Tags the sanitizer is SUPPOSED to remove — losing these is the point. */
const EXPECTED_TO_GO = new Set([
  "script", "style", "iframe", "object", "embed", "template", "noscript",
  "link", "meta", "base", "form", "input", "button", "select", "textarea",
]);

describe("the bundled Codex pages survive rendering", () => {
  const pages = pagesIn(BUNDLED);

  it("finds the bundled pages", () => {
    expect(pages.length).toBeGreaterThan(0);
  });

  it("keeps every word of prose that sanitizing could have eaten", () => {
    // Scoped to the SANITIZER, comparing rendered-and-sanitized against
    // rendered-only. Comparing raw markdown against rendered output instead was
    // wrong three different ways — it counted markdown ** markers, markdown link
    // syntax, and URL slugs moving into href attributes as lost prose. None of
    // those involve the sanitizer at all.
    const losses: string[] = [];
    const wordsIn = (s: string) => new Set(textOf(s).match(/[A-Za-z]{6,}/g) ?? []);
    for (const p of pages) {
      const rendered = renderCodexHtml(p.md);
      // Hoisted: computing this inside the filter re-sanitized the whole page once
      // per word, which timed out the worker rather than failing an assertion.
      const kept = wordsIn(sanitizeHtml(rendered));
      const missing = [...wordsIn(rendered)].filter((w) => !kept.has(w));
      if (missing.length) losses.push(`${p.name}: lost ${missing.slice(0, 5).join(", ")}`);
    }
    expect(losses).toEqual([]);
  });

  it("removes nothing except the tags it is meant to remove", () => {
    const unexpected: string[] = [];
    for (const p of pages) {
      const htmlLines = p.md.split(/\r?\n/).filter((l) => l.trim().startsWith("<")).join("\n");
      if (!htmlLines) continue;
      const a = tagsOf(htmlLines);
      const b = tagsOf(renderCodexHtml(p.md));
      for (const [tag, n] of Object.entries(a)) {
        if (EXPECTED_TO_GO.has(tag)) continue;
        const kept = b[tag] || 0;
        if (kept < n) unexpected.push(`${p.name}: <${tag}> ${n} -> ${kept}`);
      }
    }
    expect(unexpected).toEqual([]);
  });

  it("never emits a script tag or an event handler", () => {
    for (const p of pages) {
      const out = renderCodexHtml(p.md).toLowerCase();
      expect(out, p.name).not.toContain("<script");
      expect(out, p.name).not.toMatch(/\son\w+\s*=/);
      expect(out, p.name).not.toContain("javascript:");
    }
  });
});

describe.skipIf(!pagesIn(MIRROR).length)("the full wiki mirror survives rendering", () => {
  const pages = pagesIn(MIRROR);

  it("sweeps every mirrored page for injected script", { timeout: 120000 }, () => {
    const injected: string[] = [];
    for (const p of pages) {
      const lower = renderCodexHtml(p.md).toLowerCase();
      if (lower.includes("<script") || /\son\w+\s*=/.test(lower) || lower.includes("javascript:")) {
        injected.push(p.name);
      }
    }
    expect({ injected, pagesSwept: pages.length }).toEqual({ injected: [], pagesSwept: pages.length });
  });

  it("removes no text that the browser would otherwise have rendered", { timeout: 120000 }, () => {
    // This isolates the SANITIZER rather than the renderer. Comparing raw markdown
    // to rendered HTML conflates the two and produced three false positives:
    // markdown ** markers that correctly become <b>, and — on Energy_Weapon.md —
    // a 21,818-byte MediaWiki debug comment (51% of the file) fragmented across an
    // embedded visual-doc JSON payload, which the HTML parser swallows exactly as
    // a browser always did, with or without sanitization.
    //
    // So: parse the page's raw HTML with the same DOM on both sides and compare
    // the resulting text. Any difference is attributable to sanitizing alone.
    const losses: string[] = [];
    for (const p of pages) {
      const htmlLines = p.md.split(/\r?\n/).filter((l) => l.trim().startsWith("<")).join("\n");
      if (!htmlLines) continue;
      const parsedText = (h: string) => {
        const d = new DOMParser().parseFromString("<body>" + h + "</body>", "text/html");
        return (d.body?.textContent ?? "").replace(/\s+/g, " ").trim();
      };
      const before = parsedText(htmlLines);
      const after = parsedText(sanitizeHtml(htmlLines));
      // Only a DECREASE is a problem. Sanitizing can legitimately increase visible
      // text: on Energy_Weapon.md removing a dropped element exposed prose that the
      // fragmented <!-- had been swallowing (7461 -> 7605 chars). Flagging any
      // difference reported that gain as a loss.
      if (after.length < before.length) {
        losses.push(`${p.name}: ${before.length} -> ${after.length} chars of text`);
      }
    }
    expect(losses).toEqual([]);
  });
});
