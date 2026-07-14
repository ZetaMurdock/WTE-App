import { useMemo, useRef } from "react";

// A dense, no-dependency code editor for page source: a highlighted <pre> behind a
// transparent <textarea> (scroll-synced), plus a linter that red-underlines broken
// markup and lists what's wrong. Tuned to the W.T.E dark aesthetic.

type Cls = "txt" | "tag" | "attr" | "str" | "var" | "color" | "head" | "link" | "code";

interface Issue {
  line: number;
  col: number;
  message: string;
  start: number;
  end: number;
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Per-character token class (later passes override earlier for nesting).
function classify(src: string): Cls[] {
  const cls: Cls[] = new Array(src.length).fill("txt");
  const paint = (re: RegExp, c: Cls) => {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(src))) {
      for (let i = m.index; i < m.index + m[0].length; i++) cls[i] = c;
      if (m.index === re.lastIndex) re.lastIndex++;
    }
  };
  paint(/<\/?[a-zA-Z][\w-]*|\/?>/g, "tag");
  paint(/[a-zA-Z][\w-]*(?==")/g, "attr");
  paint(/"[^"]*"/g, "str");
  paint(/data-[bc]\b/g, "var");
  paint(/#[0-9a-fA-F]{3,8}\b/g, "color");
  paint(/^#{1,5}\s.*$/gm, "head");
  paint(/\[[^\]]+\]\([^)\s]+\)|wte:\/\/\S+/g, "link");
  paint(/`[^`]+`/g, "code");
  return cls;
}

const VOID = new Set(["br", "hr", "img", "input", "meta", "link", "area", "base", "col", "source", "wbr", "!doctype"]);
const COLOR_WORDS = new Set([
  "transparent", "inherit", "currentcolor", "none", "white", "black", "red", "green", "blue", "yellow",
  "orange", "purple", "gray", "grey", "cyan", "magenta", "pink", "brown", "gold", "silver", "navy", "teal", "maroon", "olive", "lime",
]);
function validColor(v: string): boolean {
  const s = v.trim().toLowerCase();
  if (/^#[0-9a-f]{3}$|^#[0-9a-f]{4}$|^#[0-9a-f]{6}$|^#[0-9a-f]{8}$/.test(s)) return true;
  if (/^(var|rgb|rgba|hsl|hsla)\(/.test(s)) return true;
  return COLOR_WORDS.has(s);
}

function lineCol(src: string, pos: number): { line: number; col: number } {
  let line = 1;
  let last = -1;
  for (let i = 0; i < pos; i++) if (src[i] === "\n") (line++, (last = i));
  return { line, col: pos - last };
}

function lint(src: string): Issue[] {
  const issues: Issue[] = [];
  const mk = (start: number, end: number, message: string) => issues.push({ ...lineCol(src, start), message, start, end });

  // Tag balance
  const stack: { tag: string; pos: number }[] = [];
  const tagRe = /<(\/?)([a-zA-Z][\w-]*)([^>]*)>/g;
  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(src))) {
    const closing = m[1] === "/";
    const tag = m[2].toLowerCase();
    if (VOID.has(tag) || /\/\s*$/.test(m[3])) continue;
    if (!closing) stack.push({ tag, pos: m.index });
    else if (!stack.length) mk(m.index, m.index + m[0].length, `Unexpected </${tag}> — nothing is open`);
    else {
      const top = stack.pop()!;
      if (top.tag !== tag) mk(m.index, m.index + m[0].length, `</${tag}> doesn't close <${top.tag}>`);
    }
  }
  for (const s of stack) mk(s.pos, s.pos + s.tag.length + 1, `<${s.tag}> is never closed`);

  // Stray "<" not starting a tag/comment
  const strayRe = /<(?![a-zA-Z/!])/g;
  while ((m = strayRe.exec(src))) mk(m.index, m.index + 1, `Stray "<" — write &lt; or open a tag`);

  // Invalid colours (data-c / css color)
  const colRe = /(?:data-c="|color\s*:\s*)([^";)>]+)/g;
  while ((m = colRe.exec(src))) {
    const val = m[1];
    if (!validColor(val)) {
      const start = m.index + m[0].length - m[1].length;
      mk(start, start + val.length, `Invalid colour "${val.trim()}"`);
    }
  }
  return issues;
}

function highlight(src: string, cls: Cls[], errAt: Uint8Array): string {
  if (!src) return "&nbsp;";
  let out = "";
  let i = 0;
  while (i < src.length) {
    const c = cls[i];
    const e = errAt[i];
    let j = i + 1;
    while (j < src.length && cls[j] === c && errAt[j] === e) j++;
    out += `<span class="tok-${c}${e ? " tok-err" : ""}">${esc(src.slice(i, j))}</span>`;
    i = j;
  }
  return out;
}

interface Props {
  value: string;
  onChange: (v: string) => void;
}

export function CodeArea({ value, onChange }: Props) {
  const preRef = useRef<HTMLPreElement>(null);
  const { html, issues } = useMemo(() => {
    const cls = classify(value);
    const iss = lint(value);
    const errAt = new Uint8Array(value.length);
    for (const it of iss) for (let i = it.start; i < it.end && i < value.length; i++) errAt[i] = 1;
    return { html: highlight(value, cls, errAt), issues: iss };
  }, [value]);

  return (
    <div className="code-area-wrap">
      <div className="code-area">
        <pre ref={preRef} className="code-hl" aria-hidden dangerouslySetInnerHTML={{ __html: html + "\n" }} />
        <textarea
          className="code-input"
          spellCheck={false}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onScroll={(e) => {
            if (preRef.current) {
              preRef.current.scrollTop = e.currentTarget.scrollTop;
              preRef.current.scrollLeft = e.currentTarget.scrollLeft;
            }
          }}
        />
      </div>
      <div className={"code-issues" + (issues.length ? " has" : "")}>
        {issues.length === 0 ? (
          <span className="code-ok">✓ No issues</span>
        ) : (
          issues.slice(0, 12).map((it, k) => (
            <div className="code-issue" key={k}>
              <span className="code-issue-loc">{it.line}:{it.col}</span>
              {it.message}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
