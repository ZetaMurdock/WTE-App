// The model behind the Mechanics block editor: a Genus/Cipher page taken apart
// into labelled blocks and put back together as canonical page source.
//
// Everything here is pure and kept separate from the React component so the
// contract that actually matters — scan(rebuild(model)) is the same model, and
// every emitted phrase is recognised by parseAbilityActions — can be tested
// without a DOM. The blocks are the same rows parseCodexEntry reads, so a page
// edited here parses into the catalogs exactly as the blocks promised.
//
// A page may also DECLARE its steps in an `## Actions` block (abilityEffects.ts).
// The model carries that section WHOLE and re-emits it verbatim in one fixed
// position, after `## Effect`. It is deliberately not folded into the effect
// prose: the scanner sweeps loose lines into the effect, so a model that did not
// know the section would have merged the bullets into the rule text and the
// first rebuild would have deleted the block the ability runs on.
import { KNOWN_KEYS, parseCodexEntry } from "../../lib/codexParse";
import { CIPHER_TIERS, GENUS_DOMAIN_NAMES, PARADIGMS } from "../../game/wte";
import { ROLL_AXIS_PATHS, type RollAxisPath, type RollDirection } from "../../game/rollAxis";

export type MechanicsKind = "genus" | "cipher";

export interface MechanicsRow {
  /** Normalized key ("ss", "range", …) for known rows; raw key for extras. */
  key: string;
  /** The key exactly as written, so rebuilds do not re-case the author's page. */
  rawKey: string;
  value: string;
}

export interface MechanicsModel {
  kind: MechanicsKind;
  title: string;
  rows: MechanicsRow[];
  effect: string;
  /** The `## Actions` block exactly as the page wrote it, or "" when the page
   *  declares nothing. Untouched text: the grammar belongs to abilityEffects,
   *  and a model that re-worded the bullets would be a second author. */
  actions: string;
}

/** The one heading whose body is declared steps rather than prose. */
const ACTIONS_HEADING = /^actions$/i;

/** Identity rows shown read-only: editing these by hand breaks the link between
 *  a fork and the official rule it replaces, so the editor displays them and
 *  leaves them alone. */
export const IDENTITY_KEYS = new Set(["type", "id", "overrides", "aliases", "alias", "visibility"]);

const norm = (key: string): string => key.trim().replace(/\s+/g, " ").toLowerCase();

const ROW_RE = /^\s*\|\s*([^|]+?)\s*\|\s*([^|]*?)\s*\|\s*$/;

/** True when the raw lines are exactly what the scanner models: one title,
 *  two-cell table rows with unique keys, optional `## Effect` and `## Actions`
 *  headings, and prose the pre-parser will leave alone. Anything else — visual-doc
 *  trees, extra sections, bold/tab spec rows, three-cell rows, duplicate keys —
 *  would be silently destroyed or reinterpreted by the first rebuild, so such
 *  pages stay in the Design/Code editors that can hold them. */
function scanIsFaithful(source: string): boolean {
  if (source.includes("<!--wte-doc")) return false; // Visual Engine owns the page
  let sawTitle = false;
  const keys = new Set<string>();
  for (const line of source.replace(/\r\n/g, "\n").split("\n")) {
    const heading = line.match(/^(#{1,4})\s+(.+)$/);
    if (heading) {
      if (!sawTitle && heading[1] === "#") {
        sawTitle = true;
        continue;
      }
      const label = heading[2].trim();
      if (/^effect$/i.test(label) || ACTIONS_HEADING.test(label)) continue;
      return false; // a ## Lore / ### Overclock section the rebuild would fold into Effect
    }
    const row = line.match(ROW_RE);
    if (row) {
      if (/^:?-+:?$/.test(row[1]) || (norm(row[1]) === "field" && norm(row[2]) === "value")) continue;
      const key = norm(row[1]);
      if (keys.has(key)) return false; // blocks would show the first, the parser reads the last
      keys.add(key);
      continue;
    }
    if (/^\s*\|/.test(line)) return false; // three-cell rows etc. — parsed as fields, invisible here
    if (/<\/?t[dr]/i.test(line)) return false; // HTML table rows the parser reads but the scanner cannot
    if (specShapedLabel(line)) return false; // bold/tab/colon spec rows in prose would override the blocks
  }
  return keys.has("type");
}

/** The label of a line the pre-parser would lift out of prose as a spec field:
 *  `Key: value`, `**Key:** value`, or `Key<TAB>value` with a known key —
 *  mirror shapes of codexParse's fieldFromLine. */
function specShapedLabel(line: string): string | null {
  const label = (raw: string): string => raw.replace(/:\s*$/, "").trim();
  const bold = line.match(/^\s*(?:[-*]\s*)?\*\*([^*]+)\*\*/);
  if (bold && KNOWN_KEYS.has(norm(label(bold[1])))) return label(bold[1]);
  const tab = line.match(/^\s*([A-Za-z][A-Za-z /]+?)\t+.+$/);
  if (tab && KNOWN_KEYS.has(norm(tab[1]))) return tab[1].trim();
  const colon = line.match(/^\s*([A-Za-z][A-Za-z /]{1,18}?):[ \t]+.+$/);
  if (colon && KNOWN_KEYS.has(norm(colon[1]))) return colon[1].trim();
  return null;
}

/** Which page kind the Mechanics editor can represent, if any. Claims a page
 *  only when it parses as an ability AND the raw lines round-trip faithfully
 *  through scan/rebuild — every baked page and editor-authored fork does;
 *  hand-written pages with richer structure keep their Design/Code editors. */
export function detectMechanicsKind(source: string): MechanicsKind | null {
  if (!source.trim()) return null;
  const entry = parseCodexEntry(source, "draft");
  const kind = entry?.type === "genus" || entry?.type === "cipher" ? entry.type : null;
  if (!kind) return null;
  return scanIsFaithful(source) ? kind : null;
}

/** Take the page apart line by line. Table rows become blocks; the `## Effect`
 *  section and any loose prose (which parseCodexEntry would sweep into the
 *  effect anyway) become the effect text, and `## Actions` fills the declared
 *  block. */
export function scanMechanicsPage(source: string, kind: MechanicsKind): MechanicsModel {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  let title = "";
  const rows: MechanicsRow[] = [];
  const prose: string[] = [];
  const declared: string[] = [];
  // Where the lines that follow belong. Only `## Actions` diverts them; every
  // other heading (there is at most `## Effect`) hands them back to the prose.
  let body = prose;
  for (const line of lines) {
    const heading = line.match(/^#{1,4}\s+(.+)$/);
    if (heading) {
      const label = heading[1].trim();
      const section = /^effect$/i.test(label) || ACTIONS_HEADING.test(label);
      // A section heading is never the page's name, even on a page that opens
      // without one. Taking the first heading whatever it said made an untitled
      // page renamed `# Actions` with its every bullet swept into the effect
      // prose — the block deleted and re-read as rule text by the first rebuild.
      if (!title && !section) {
        title = label.replace(/[*_`]/g, "").trim();
        continue;
      }
      body = ACTIONS_HEADING.test(label) ? declared : prose;
      continue;
    }
    const row = line.match(ROW_RE);
    if (row) {
      if (/^:?-+:?$/.test(row[1]) || (norm(row[1]) === "field" && norm(row[2]) === "value")) continue;
      rows.push({ key: norm(row[1]), rawKey: row[1], value: row[2] });
      continue;
    }
    if (/^\s*\|/.test(line)) continue; // other table structure
    body.push(line);
  }
  return {
    kind,
    title,
    rows,
    effect: prose.join("\n").replace(/\n{3,}/g, "\n\n").trim(),
    actions: declared.join("\n").replace(/\n{3,}/g, "\n\n").trim(),
  };
}

/** Canonical page source for a model — the exact shape the baked pages use. */
export function rebuildMechanicsPage(model: MechanicsModel): string {
  const body = model.rows
    .filter((row) => row.value.trim() !== "")
    .map((row) => `| ${row.rawKey.trim()} | ${row.value.replace(/\r?\n+/g, " ").replace(/\|/g, "/").trim()} |`)
    .join("\n");
  const sections = [`# ${model.title || "Untitled"}`, `| Field | Value |\n|---|---|\n${body}`];
  const effect = model.effect.trim();
  if (effect) sections.push("## Effect", effect);
  // Always last, whatever order the source used: one fixed position is what
  // makes scan and rebuild agree about where the block lives, so a page that
  // arrived with its steps above the prose still round-trips from here on.
  const actions = model.actions.trim();
  if (actions) sections.push("## Actions", actions);
  return `${sections.join("\n\n")}\n`;
}

export interface BlockInfo {
  key: string;
  label: string;
  /** The key as written on the page when the block adds its row. Defaults to
   *  the label; needed where the display label is not the spec key ("SS Cost"
   *  labels the `SS` row — writing the label would re-scan as a custom field). */
  rowKey?: string;
  /** Plain-language explanation, shown as the block's subtext. */
  hint: string;
  kinds: readonly MechanicsKind[];
  options?: readonly string[];
  numeric?: boolean;
}

/** The mechanic blocks, in display order, with their plain-language subtext. */
export const MECHANIC_BLOCKS: readonly BlockInfo[] = [
  {
    key: "name", label: "Name", kinds: ["cipher"],
    hint: "This cipher's identity. Keep it to change the official cipher; change it to make a brand-new one.",
  },
  {
    key: "domain", label: "Domain", kinds: ["genus"], options: GENUS_DOMAIN_NAMES,
    hint: "The energy family this ability belongs to — it decides which paradigms can learn it.",
  },
  {
    key: "paradigm", label: "Paradigm", kinds: ["cipher"], options: PARADIGMS.map((p) => p.id),
    hint: "Whose cipher list this belongs to.",
  },
  {
    key: "tier", label: "Tier", kinds: ["cipher"], options: CIPHER_TIERS,
    hint: "offline works anywhere · online needs the paradigm network · special is story-gated.",
  },
  {
    key: "ss", label: "SS Cost", rowKey: "SS", kinds: ["genus", "cipher"], numeric: true,
    hint: "Synaptic Space spent to use it. A bigger number takes more of your focus.",
  },
  {
    key: "activation", label: "Activation", kinds: ["genus", "cipher"],
    hint: "What it takes to switch on — the kind of action, and how long it stays active.",
  },
  {
    key: "rank", label: "Rank", kinds: ["cipher"],
    hint: "The paradigm rank you must reach before this cipher unlocks.",
  },
  {
    key: "component", label: "Component", kinds: ["cipher"],
    hint: "The physical thing the cipher works through — it needs this present to function.",
  },
  {
    key: "range", label: "Range", kinds: ["genus"],
    hint: "How far away the effect can reach from you.",
  },
  {
    key: "target", label: "Target", kinds: ["genus"],
    hint: "Who or what it can affect: yourself, one creature, an object, an area…",
  },
  {
    key: "classification", label: "Classification", kinds: ["genus"],
    hint: "The rulebook's word for HOW it works (emission, trans-modification…). Flavorful, but rules can key off it.",
  },
  {
    key: "limit", label: "Limit", kinds: ["genus"],
    hint: "How often it can be used before something has to recharge.",
  },
];

export interface DetailSegment {
  label: string;
  hint: string;
}

/** Effect-prose labels in the corpus voice. None of these words is a spec-table
 *  key, so a line that starts with them stays prose — asserted by the tests. */
export const DETAIL_SEGMENTS: readonly DetailSegment[] = [
  { label: "Vector", hint: "How the effect travels to its target — touch, projectile, gaze, burst…" },
  { label: "Duration", hint: "How long it lasts once it lands." },
  { label: "Area", hint: "The shape and size of ground it covers." },
  { label: "Resolution", hint: "How success is decided when it is not automatic." },
  { label: "Cost", hint: "Anything it costs beyond SS — Fatigue, HP, a consumed item…" },
];

/** Save-stat choices for the phrase builder. Every entry must be a word the
 *  action parser recognises — there is a test that fails if one is not. */
export const SAVE_STATS = [
  "Strength", "Dexterity", "Endurance", "Action Priority", "Wisdom", "Intelligence",
  "Charisma", "Inspiration", "Balance", "Precision", "Control", "Weapon Mastery",
  "Mental Fortitude", "Perception", "Adaptation", "Cunning", "Influence",
] as const;

/** "The target makes an Endurance Save (DC 12)." — the exact shape
 *  parseAbilityActions reads as a target-side save with its DC. */
export function savePhrase(stat: string, dc?: number): string {
  const article = /^[AEIOU]/i.test(stat) ? "an" : "a";
  return `The target makes ${article} ${stat} Save${dc ? ` (DC ${dc})` : ""}.`;
}

/** "Deals 3d10 Entropy damage." — read as an armable damage roll. */
export function damagePhrase(dice: string, type: string): string {
  return `Deals ${dice.trim()} ${type} damage.`;
}

/** "Mental Check — Capacity (DC 14)" — a full Roll Axis route. Directions are
 *  constrained to the path's legal ones, so an unreachable combination cannot
 *  be authored from the editor at all. */
export function rollAxisPhrase(path: RollAxisPath, direction: RollDirection, dc?: number): string {
  const axis = path.axis === "physical" ? "Physical" : "Mental";
  const dir = direction === "check" ? "Check" : "Save";
  return `${axis} ${dir} — ${path.name}${dc ? ` (DC ${dc})` : ""}`;
}

export { ROLL_AXIS_PATHS };

/** Effect lines that would be captured as spec fields and vanish from the
 *  prose — in any of the shapes the pre-parser reads: `Key: value`,
 *  `**Key:** value`, `Key<TAB>value`, or a pasted `| table | row |`. Surfaced
 *  as a warning instead of silently eating (or reinterpreting) the text. */
export function hazardousEffectLines(effect: string): string[] {
  const out: string[] = [];
  for (const line of effect.split("\n")) {
    if (/^\s*\|/.test(line)) {
      out.push("table row");
      continue;
    }
    const label = specShapedLabel(line);
    if (label) out.push(label);
  }
  return out;
}
