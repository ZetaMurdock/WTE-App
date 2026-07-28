// HTML sanitizer for content that crosses between users.
//
// Codex pages sync through the shared Firebase library and character files are
// handed player to player, so any markup in them is UNTRUSTED. Before this
// existed, md.ts passed every line starting with "<" through untouched into
// dangerouslySetInnerHTML, and with csp:null + withGlobalTauri:true that script
// reached window.__TAURI__.invoke — the sql plugin, wte_save_page, the asset
// protocol. One published page was code execution on every install that had ever
// pulled that stem.
//
// Two deliberate implementation choices:
//
// 1. ALLOWLIST, not escape. A census of the 336 real pages found raw HTML in 319
//    of them — 49,676 <td>, plus MathML, SVG and 12,483 style attributes. Escaping
//    the passthrough would destroy nearly every page in the Codex.
//
// 2. Parse with the PLATFORM parser and walk the tree; never regex. The corpus
//    contains MathML and SVG, which is precisely where regex sanitizers get
//    defeated (mXSS: markup that reparses differently once it is reinserted).
//    Walking a real DOM means we see the same tree the browser will build.
//
// Anything not on these lists is removed. Unknown ELEMENTS are unwrapped rather
// than deleted so their text survives — losing a page's prose to an unrecognised
// tag would be its own kind of silent data loss.

const ALLOWED_TAGS = new Set([
  // structure
  "p", "div", "span", "section", "aside", "figure", "figcaption", "blockquote",
  "hr", "br", "h1", "h2", "h3", "h4", "h5", "h6",
  // lists
  "ul", "ol", "li", "dl", "dt", "dd",
  // tables
  "table", "thead", "tbody", "tfoot", "tr", "td", "th", "caption", "colgroup", "col",
  // inline
  "b", "strong", "i", "em", "u", "s", "small", "big", "sub", "sup", "code", "pre", "kbd", "abbr",
  "a", "img",
  // MathML — the corpus renders formulas with these
  "math", "mrow", "mi", "mn", "mo", "ms", "mtext", "mfrac", "msup", "msub", "msubsup",
  "msqrt", "mroot", "mstyle", "mspace", "mtable", "mtr", "mtd", "munder", "mover",
  "munderover", "semantics", "annotation", "annotation-xml",
  // SVG — icons only; <use> is allowed but its target is scheme-checked below
  "svg", "g", "path", "use", "circle", "rect", "line", "polyline", "polygon", "ellipse",
  "text", "tspan", "defs", "title", "symbol",
]);

/** Attributes allowed on any element. Deliberately excludes every event handler:
 *  the rule is an allowlist, so on* never needs naming, but see stripAttributes
 *  for a belt-and-braces check. */
const ALLOWED_ATTRS = new Set([
  "class", "id", "title", "lang", "dir", "role",
  "colspan", "rowspan", "span", "headers", "scope",
  "alt", "width", "height", "loading", "decoding", "srcset", "sizes",
  "aria-hidden", "aria-label", "aria-describedby",
  // MathML
  "displaystyle", "scriptlevel", "encoding", "alttext", "stretchy", "mathvariant",
  "xmlns", "display", "linethickness", "fence", "separator", "accent",
  // SVG presentation
  "viewbox", "fill", "stroke", "stroke-width", "stroke-linecap", "stroke-linejoin",
  "d", "cx", "cy", "r", "rx", "ry", "x", "y", "x1", "y1", "x2", "y2", "points",
  "transform", "opacity", "preserveaspectratio",
  // the app's own hooks, used by 967 wiki-mirrored links
  "data-wte-link", "data-hash", "data-ext-link",
]);

/** Attributes whose value is a URL and must be scheme-checked. */
const URL_ATTRS = new Set(["href", "src", "xlink:href", "data-src"]);

/** Schemes safe to keep. Notably absent: javascript:, vbscript:, and file:. */
const SAFE_SCHEMES = ["http:", "https:", "mailto:"];

/** data: is allowed ONLY for images, and only for real image types — a data: URL
 *  carrying text/html is a navigable document. */
const SAFE_DATA_IMAGE = /^data:image\/(png|jpeg|jpg|gif|webp|avif);base64,[a-z0-9+/=\s]+$/i;

function safeUrl(value: string, isImage: boolean): string | null {
  const v = value.trim();
  // A PROTOCOL-RELATIVE url ("//host/path") looks relative but inherits the page
  // scheme and resolves to an external host, so it must be rejected before the
  // single-slash relative check below would wave it through.
  if (/^[\u0000-\u0020]*\/\//.test(v)) return null;
  // A relative or in-page reference has no scheme and cannot navigate elsewhere.
  if (v.startsWith("#") || v.startsWith("/") || v.startsWith("./") || v.startsWith("../")) return v;
  if (isImage && SAFE_DATA_IMAGE.test(v)) return v;
  // Control characters are how "java\0script:" and "java\tscript:" slip past a
  // naive prefix check — the browser strips them, so we must too before testing.
  const flat = v.replace(/[\u0000-\u0020]/g, "").toLowerCase();
  for (const s of SAFE_SCHEMES) if (flat.startsWith(s)) return v;
  // No recognised scheme and not relative: could be "javascript:..." obfuscated,
  // or a protocol-relative //host. Reject.
  return null;
}

/** CSS is kept but filtered: url() can beacon out to an arbitrary host (a real
 *  exfiltration channel even with no script), and expression() is legacy script. */
function safeStyle(css: string): string {
  return css
    .split(";")
    .filter((decl) => {
      const d = decl.toLowerCase();
      if (/url\s*\(/.test(d)) return false;
      if (/expression\s*\(/.test(d)) return false;
      if (/[\\]/.test(d)) return false; // CSS escapes used to rebuild the above
      return true;
    })
    .join(";");
}

function stripAttributes(el: Element): void {
  for (const attr of [...el.attributes]) {
    const name = attr.name.toLowerCase();
    const value = attr.value;

    // Event handlers, on anything, unconditionally.
    if (name.startsWith("on")) {
      el.removeAttribute(attr.name);
      continue;
    }
    if (name === "style") {
      const cleaned = safeStyle(value);
      if (cleaned.trim()) el.setAttribute("style", cleaned);
      else el.removeAttribute(attr.name);
      continue;
    }
    if (URL_ATTRS.has(name)) {
      const ok = safeUrl(value, el.tagName.toLowerCase() === "img");
      if (ok === null) el.removeAttribute(attr.name);
      else el.setAttribute(attr.name, ok);
      continue;
    }
    if (!ALLOWED_ATTRS.has(name)) el.removeAttribute(attr.name);
  }
  // An external link must not be able to reach back into the opener.
  if (el.tagName.toLowerCase() === "a" && el.getAttribute("href")) {
    el.setAttribute("rel", "noopener noreferrer");
  }
}

/** Replace an element with its children, keeping the text. */
function unwrap(el: Element): void {
  const parent = el.parentNode;
  if (!parent) {
    el.remove();
    return;
  }
  while (el.firstChild) parent.insertBefore(el.firstChild, el);
  parent.removeChild(el);
}

/** Tags whose CONTENT is as dangerous as the tag, so it goes with them. */
const DROP_WITH_CONTENT = new Set(["script", "style", "iframe", "object", "embed", "template", "noscript", "link", "meta", "base", "form", "input", "button", "select", "textarea"]);

/**
 * Sanitize an untrusted HTML fragment.
 *
 * Requires a DOM (DOMParser). Called from React render paths, which always have
 * one; if it is ever called without a DOM it returns the text with all tags
 * stripped rather than returning the input unchanged — failing closed, because
 * returning the raw markup is the bug this module exists to prevent.
 */
export function sanitizeHtml(html: string): string {
  if (typeof DOMParser === "undefined") {
    return html.replace(/<[^>]*>/g, "");
  }
  const doc = new DOMParser().parseFromString("<body>" + html + "</body>", "text/html");
  const body = doc.body;
  if (!body) return "";

  // Snapshot first: the walk mutates the tree, and a live list would skip nodes.
  const all: Element[] = [];
  const walk = (n: Element) => {
    all.push(n);
    for (const c of [...n.children]) walk(c as Element);
  };
  for (const c of [...body.children]) walk(c as Element);

  for (const el of all) {
    // Already detached by an ancestor being removed.
    if (!el.parentNode) continue;
    const tag = el.tagName.toLowerCase();
    if (DROP_WITH_CONTENT.has(tag)) {
      el.remove();
      continue;
    }
    if (!ALLOWED_TAGS.has(tag)) {
      unwrap(el);
      continue;
    }
    stripAttributes(el);
  }

  return body.innerHTML;
}
