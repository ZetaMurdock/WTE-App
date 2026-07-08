// Parse a user-authored Codex page (or a catalog entry) into a typed CodexEntry.
// Accommodates the WTE spec-table format (see docs/CODEX-FORMAT.md):
//  - a `#`/`##`/`###` title (optional `N.` prefix, "(REWORKED …)" meta stripped),
//    a key/value spec block (markdown table `| K | V |`, HTML table, tab, or `**Field:**`),
//    then labeled prose sections. `[130]` / `[97, 130]` citation markers are stripped.
// Pages without a recognized **Type** field return null (kept as pure lore).
import type { CodexEntry, CodexType, Overclock, CodexAbility } from "../models/codex";

const strip = (s: string) => (s || "").replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").trim();
const stripCitations = (s: string) => s.replace(/\s*\[\s*\d+(?:\s*,\s*\d+)*\s*\]/g, "");
const cleanName = (s: string) =>
  strip(s).replace(/^\d+\.\s*/, "").replace(/\s*\((?:reworked)[^)]*\)/gi, "").trim();

// Spec fields the app reads (normalized: lowercase, single-spaced).
const KNOWN_KEYS = new Set([
  "type", "name", "category", "grade", "slot", "weight", "mods", "nc cost", "ede", "domain",
  "damage", "range", "size min", "ss", "ss cost", "activation", "target", "component",
  "paradigm", "tier", "archive", "size", "rank", "hp", "attack", "evasion", "movement",
  "keywords", "limit",
]);
const normKey = (k: string) => strip(k).replace(/\*\*/g, "").replace(/:\s*$/, "").replace(/\s+/g, " ").trim().toLowerCase();

// Read a KEY/VALUE pair from a single line (markdown table, HTML table, tab, or **Field:**).
function fieldFromLine(line: string): [string, string] | null {
  let m = line.match(/<td[^>]*>([\s\S]*?)<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>/i);
  if (m) return [strip(m[1]), strip(m[2])];
  if (/^\s*\|/.test(line)) {
    const parts = line.split("|").slice(1, -1).map((c) => c.trim());
    if (parts.length >= 2 && !/^:?-+:?$/.test(parts[0])) return [parts[0], parts[1]];
    return null;
  }
  m = line.match(/^\s*(?:[-*]\s*)?\*\*([^*]+)\*\*:?\s*(.*)$/);
  if (m) return [m[1], m[2]];
  m = line.match(/^\s*([A-Za-z][A-Za-z /]+?)\t+(.+)$/);
  if (m) return [m[1], m[2]];
  m = line.match(/^\s*([A-Za-z][A-Za-z /]{1,18}?):[ \t]+(.+)$/);
  if (m) return [m[1], m[2]];
  return null;
}

function canonSection(label: string): string | null {
  const l = label.toLowerCase();
  if (l.includes("overclock")) return "overclock";
  if (l.includes("base attack")) return "baseAttack";
  if (l.includes("synergy") || l.includes("combat integration") || l.includes("effect")) return "effect";
  if (l.includes("abilit")) return "abilities";
  if (l.includes("lore") || l.includes("synopsis")) return "lore";
  return null;
}
const isPhaseLine = (line: string) =>
  /\bphase\s+(i{1,3}|1|2|3)\b/i.test(line) || /(extender|backlash|equalizer)\s+phase/i.test(line);

interface PreParsed {
  title: string;
  fields: Record<string, string>;
  sections: Record<string, string>;
}

function preParse(md: string, name?: string): PreParsed {
  const lines = stripCitations(md.replace(/\r\n/g, "\n")).split("\n");
  let title = "";
  const fields: Record<string, string> = {};
  const prose: string[] = [];

  for (const line of lines) {
    if (/^\s*-{3,}\s*$/.test(line)) continue; // horizontal-rule entry separators
    if (!title) {
      const h = line.match(/^#{1,4}\s+(.+)$/);
      if (h) { title = cleanName(h[1]); continue; }
    }
    const kv = fieldFromLine(line);
    if (kv && canonSection(kv[0])) { prose.push(line); continue; } // section label — keep for the splitter
    if (isPhaseLine(line)) { prose.push(line); continue; } // overclock phase (often a bulleted **Phase …**)
    if (kv && KNOWN_KEYS.has(normKey(kv[0]))) { fields[normKey(kv[0])] = strip(kv[1]); continue; }
    if (/^\s*\|/.test(line) || /<\/?t[dr]/i.test(line)) continue; // table structure
    if (kv && (/\t/.test(line) || /^\s*(?:[-*]\s*)?\*\*[^*]+\*\*/.test(line))) continue; // unknown spec row
    prose.push(line);
  }
  if (!title) title = cleanName(name || prose.find((l) => l.trim()) || "") || "Unnamed";

  // Split prose into canonical sections by `## Heading`, a `Label:` start, or an Overclock Phase line.
  const sections: Record<string, string> = {};
  let cur = "effect";
  const push = (s: string, t: string) => { sections[s] = (sections[s] ? sections[s] + "\n" : "") + t; };
  for (const line of prose) {
    const h2 = line.match(/^#{2,4}\s+(.+)$/);
    if (h2) { const c = canonSection(h2[1]); if (c) cur = c; continue; }
    if (isPhaseLine(line)) { cur = "overclock"; push("overclock", line.trim()); continue; }
    const lab = line.match(/^\s*(?:\*\*)?([A-Za-z][A-Za-z '&/]{2,45}?)(?:\*\*)?:[ \t]*(.*)$/);
    if (lab) {
      const c = canonSection(lab[1]);
      if (c) { cur = c; const content = lab[2].replace(/\*\*/g, "").trim(); if (content) push(cur, content); continue; }
    }
    if (line.trim()) push(cur, line);
  }
  for (const k in sections) sections[k] = sections[k].trim();
  return { title, fields, sections };
}

function num(v?: string): number | undefined {
  if (v == null) return undefined;
  const m = v.match(/-?\d+/);
  return m ? parseInt(m[0], 10) : undefined;
}
function list(v?: string): string[] | undefined {
  if (!v) return undefined;
  const a = v.split(",").map((s) => s.trim()).filter(Boolean);
  return a.length ? a : undefined;
}
function bool(v?: string): boolean | undefined {
  if (v == null) return undefined;
  return /^(yes|true|y|1)\b/i.test(v.trim());
}
function overclock(text?: string): Overclock | undefined {
  if (!text) return undefined;
  return { text: text.trim() };
}
function abilities(body?: string): CodexAbility[] | undefined {
  if (!body) return undefined;
  const out: CodexAbility[] = [];
  const re = /^\s*[-*]\s*\*\*([^*]+)\*\*\s*[—–:-]\s*(.+)$/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) out.push({ name: m[1].trim(), effect: m[2].trim() });
  return out.length ? out : undefined;
}
function fromBaseAttack(base?: string): { range?: string; damage?: string } {
  if (!base) return {};
  const rangeM = base.match(/Melee\s*\([^)]*\)|Melee|Ranged\s*\([^)]*\)|\b\d+\s*ft\b/i);
  const diceM = base.match(/\d+d\d+/i);
  const typeM = base.match(/Deals\s+([A-Za-z]+)/i);
  const damage = diceM ? `${diceM[0]}${typeM ? " " + typeM[1] : ""}` : undefined;
  return { range: rangeM ? rangeM[0].trim() : undefined, damage };
}

// Map a raw TYPE value to a CodexType (+ remember the original as the equipment category).
function mapType(raw: string): { type: CodexType | null; category?: string } {
  const first = raw.toLowerCase().replace(/[^a-z].*$/, "");
  if (first === "weapon") return { type: "weapon" };
  if (["cipher", "genus", "creature"].includes(first)) return { type: first as CodexType };
  if (["equipment", "utility", "module", "cybernetic", "consumable", "armor", "implant", "gear", "wing"].includes(first))
    return { type: "equipment", category: raw.replace(/\s*\[.*$/, "").trim() };
  return { type: null };
}

export function parseCodexEntry(md: string, name?: string): CodexEntry | null {
  const { title, fields, sections } = preParse(md, name);
  const mapped = mapType(fields["type"] || "");
  if (!mapped.type) return null;

  const nm = title;
  const keywords = list(fields["keywords"]);
  const effect = sections["effect"] || undefined;
  const ede = bool(fields["ede"]);
  const oc = ede === false ? undefined : overclock(sections["overclock"]);
  if (oc && fields["domain"]) oc.requires = fields["domain"]; // the domain gate is the real Overclock requirement

  switch (mapped.type) {
    case "weapon": {
      const ba = fromBaseAttack(sections["baseAttack"]);
      return {
        type: "weapon", name: nm, keywords, effect, overclock: oc,
        category: fields["category"], grade: num(fields["grade"]), slot: fields["slot"],
        weight: fields["weight"], mods: fields["mods"], ncCost: num(fields["nc cost"]),
        ede, domain: fields["domain"], sizeMin: fields["size min"],
        damage: fields["damage"] || ba.damage, range: fields["range"] || ba.range,
        baseAttack: sections["baseAttack"] || undefined,
      };
    }
    case "equipment":
      return {
        type: "equipment", name: nm, keywords, effect, overclock: oc,
        category: fields["category"] || mapped.category, slot: fields["slot"], grade: num(fields["grade"]),
        weight: fields["weight"], mods: fields["mods"], ncCost: num(fields["nc cost"]), ede, domain: fields["domain"],
      };
    case "cipher":
      return {
        type: "cipher", name: nm, keywords, effect, paradigm: fields["paradigm"], tier: fields["tier"],
        ss: num(fields["ss"] ?? fields["ss cost"]), activation: fields["activation"], range: fields["range"],
        target: fields["target"], component: fields["component"],
      };
    case "genus":
      return {
        type: "genus", name: nm, keywords, effect, domain: fields["domain"], ss: num(fields["ss"] ?? fields["ss cost"]),
        activation: fields["activation"], range: fields["range"], target: fields["target"], limit: fields["limit"],
      };
    case "creature":
      return {
        type: "creature", name: nm, keywords, archive: fields["archive"], size: fields["size"], rank: num(fields["rank"]),
        hp: num(fields["hp"]), attack: num(fields["attack"]), evasion: num(fields["evasion"]), movement: fields["movement"],
        abilities: abilities(sections["abilities"]), lore: sections["lore"] || undefined,
      };
  }
  return null;
}
