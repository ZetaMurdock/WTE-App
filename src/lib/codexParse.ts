// Parse a user-authored Codex page (markdown) into a typed CodexEntry.
// Format: `# Title`, a block of `**Field:** value` lines, then `## Section` rich-text bodies.
// See docs/CODEX-FORMAT.md. Pages without a **Type:** field return null (kept as pure lore).
import type { CodexEntry, CodexType, Overclock, CodexAbility } from "../models/codex";

interface PreParsed {
  title: string;
  fields: Record<string, string>;
  sections: Record<string, string>;
}

function preParse(md: string): PreParsed {
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  let title = "";
  const fields: Record<string, string> = {};
  const sections: Record<string, string> = {};
  let section: string | null = null;
  let buf: string[] = [];
  const flush = () => {
    if (section) sections[section] = buf.join("\n").trim();
    buf = [];
  };

  for (const line of lines) {
    const h2 = line.match(/^##\s+(.+)$/);
    if (h2) {
      flush();
      section = h2[1].trim().toLowerCase();
      continue;
    }
    if (section) {
      buf.push(line);
      continue;
    }
    const h1 = line.match(/^#\s+(.+)$/);
    if (h1 && !title) {
      title = h1[1].trim();
      continue;
    }
    // field line: `**Field:** value` or `- **Field**: value`
    const f = line.match(/^\s*(?:[-*]\s*)?\*\*([^*]+)\*\*:?\s*(.*)$/);
    if (f) fields[f[1].replace(/:\s*$/, "").trim().toLowerCase()] = f[2].trim();
  }
  flush();
  return { title, fields, sections };
}

function num(v?: string): number | undefined {
  if (v == null) return undefined;
  const m = v.match(/-?\d+/);
  return m ? parseInt(m[0], 10) : undefined;
}
function list(v?: string): string[] | undefined {
  if (!v) return undefined;
  const arr = v.split(",").map((s) => s.trim()).filter(Boolean);
  return arr.length ? arr : undefined;
}
function overclock(body?: string): Overclock | undefined {
  if (!body) return undefined;
  const req = body.match(/^\s*\*\*Requires:?\*\*:?\s*(.+)$/im);
  const text = body.replace(/^\s*\*\*Requires:?\*\*:?\s*.+$/im, "").trim();
  return { requires: req ? req[1].trim() : undefined, text };
}
function abilities(body?: string): CodexAbility[] | undefined {
  if (!body) return undefined;
  const out: CodexAbility[] = [];
  const re = /^\s*[-*]\s*\*\*([^*]+)\*\*\s*[—–:-]\s*(.+)$/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) out.push({ name: m[1].trim(), effect: m[2].trim() });
  return out.length ? out : undefined;
}

const KNOWN: CodexType[] = ["weapon", "equipment", "cipher", "genus", "creature"];

export function parseCodexEntry(md: string): CodexEntry | null {
  const { title, fields, sections } = preParse(md);
  const type = (fields["type"] || "").toLowerCase();
  if (!KNOWN.includes(type as CodexType)) return null;

  const name = title || fields["name"] || "Unnamed";
  const keywords = list(fields["keywords"]);
  const effect = sections["effect"];
  const oc = overclock(sections["overclock"]);

  switch (type as CodexType) {
    case "weapon":
      return { type: "weapon", name, keywords, effect, overclock: oc, category: fields["category"], grade: num(fields["grade"]), damage: fields["damage"], range: fields["range"], weight: fields["weight"], sizeMin: fields["size min"] };
    case "equipment":
      return { type: "equipment", name, keywords, effect, overclock: oc, slot: fields["slot"], grade: num(fields["grade"]), weight: fields["weight"], mods: fields["mods"] };
    case "cipher":
      return { type: "cipher", name, keywords, effect, paradigm: fields["paradigm"], tier: fields["tier"], ss: num(fields["ss"]), activation: fields["activation"], range: fields["range"], target: fields["target"], component: fields["component"] };
    case "genus":
      return { type: "genus", name, keywords, effect, domain: fields["domain"], ss: num(fields["ss"]), activation: fields["activation"], range: fields["range"], target: fields["target"], limit: fields["limit"] };
    case "creature":
      return { type: "creature", name, keywords, archive: fields["archive"], size: fields["size"], rank: num(fields["rank"]), hp: num(fields["hp"]), attack: num(fields["attack"]), evasion: num(fields["evasion"]), movement: fields["movement"], abilities: abilities(sections["abilities"]), lore: sections["lore"] };
  }
  return null;
}
