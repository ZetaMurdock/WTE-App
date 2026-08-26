// The pre-Roll-Axis dialect, translated — not rewritten.
//
// The 62 Incepts and a handful of species entries were authored before Roll
// Axis existed, in a D&D-shaped vocabulary the rest of the app no longer speaks:
// "CON Check (DC 15)", "Dexterity Saving Throws", "roll Wisdom (DC 12)", "ADA
// rolls". Genus and Cipher pages meanwhile say "Physical Save — Evasion". Two
// vocabularies for one system means an Incept's roll reaches no dice at all,
// because the only parser that finds a real route is looking for the other one.
//
// This module is the dictionary between them, and nothing else. It maps a
// legacy STATISTIC NAME plus a legacy DIRECTION WORD onto a Roll Axis route.
// It does not read DVs (abilityActions.ts owns that, and a second DV reader is
// exactly the "two halves of one rule" bug the Actions Engine keeps warning
// about), it does not touch the authored prose, and it does not invent.
//
// THE TABLE IS CLOSED. Every legacy word the shipped corpus actually rolls is
// listed below, each seated on a Roll Axis path or explicitly seated NOWHERE.
// A word outside the table is not a stat this dictionary knows, and
// `unmappedRollWords` exists so a new one shows up as a report instead of a
// silent nothing.
//
// FOUR REFUSALS, ALL LOUD:
//   • direction-not-on-path — the stat is real and seated, but the legacy verb
//     asks for a direction the path does not have. "Wisdom Saving Throw" wants a
//     Capacity save; Capacity is a check only. Routing it to the nearest save
//     would put the roll on a different statistic than the sentence names.
//   • off-axis-statistic  — Inspiration, Weight and Control are real W.T.E
//     specialties that sit on no Roll Axis path at all.
//   • undeclared-statistic — CON, ADA and Insight are rolled by the legacy prose
//     and name no W.T.E statistic whatsoever. These need the user's decision,
//     not a parser's.
//   • contradictory-hybrid — a sentence written half in each vocabulary whose
//     two halves disagree, e.g. a Physical direction on a mental statistic.
import { ROLL_AXIS_PATHS, type RollAxisPath, type RollDirection } from "./rollAxis";
import type { InceptRollRef } from "./inceptGrants";

export type LegacySource = "attribute" | "specialty";
type PathId = RollAxisPath["id"];

/** Where a legacy word sits on the Roll Axis. `source` is omitted when the word
 *  names the PATH rather than one of its two roll sources — a path roll picks
 *  the stronger of the two anyway, so an omitted source constrains nothing. */
export interface LegacySeat {
  path: PathId;
  source?: LegacySource;
}

interface LegacyStat {
  /** What the word is called today. Legacy spellings collapse onto one of these
   *  so a report reads in the vocabulary the app actually uses. */
  stat: string;
  /** Null means the statistic exists but no Roll Axis path carries it, or the
   *  word names nothing the system has. `unseated` says which; `note` says it
   *  in a sentence. Both are carried as data rather than inferred from the
   *  name, so adding a word is one line and never a second edit somewhere else. */
  seat: LegacySeat | null;
  unseated?: Extract<LegacyRefusalCode, "off-axis-statistic" | "undeclared-statistic">;
  note?: string;
}

function attr(stat: string, path: PathId): LegacyStat {
  return { stat, seat: { path, source: "attribute" } };
}
function spec(stat: string, path: PathId): LegacyStat {
  return { stat, seat: { path, source: "specialty" } };
}
function pathOnly(stat: string, path: PathId): LegacyStat {
  return { stat, seat: { path } };
}
/** A real W.T.E specialty that no Roll Axis path pairs. */
function offAxis(stat: string, note: string): LegacyStat {
  return { stat, seat: null, unseated: "off-axis-statistic", note };
}

/** A word the legacy prose rolls that names no W.T.E statistic at all. */
function undeclared(stat: string, note: string): LegacyStat {
  return { stat, seat: null, unseated: "undeclared-statistic", note };
}

/**
 * Every legacy word the corpus rolls, and where it sits.
 *
 * Keys are lowercased legacy spellings, including the D&D short forms the old
 * prose imported. Built from an enumeration of `src/game/data/incepts.json` and
 * `src/rules/*_Incepts.md`, not from imagination — see legacyVocabulary.test.ts,
 * which walks the shipped corpus and fails when a word appears that is not here.
 */
const LEGACY_STATS: Readonly<Record<string, LegacyStat>> = {
  // ── Attributes, in the words the old pages spelled them ──
  strength: attr("Strength", "power"),
  str: attr("Strength", "power"),
  phy: attr("Strength", "power"),
  "action priority": attr("Action Priority", "density"),
  priority: attr("Action Priority", "density"),
  ap: attr("Action Priority", "density"),
  dexterity: attr("Dexterity", "evasion"),
  dex: attr("Dexterity", "evasion"),
  endurance: attr("Endurance", "recovery"),
  end: attr("Endurance", "recovery"),
  wisdom: attr("Wisdom", "capacity"),
  wis: attr("Wisdom", "capacity"),
  intelligence: attr("Intelligence", "perception"),
  int: attr("Intelligence", "perception"),
  charisma: attr("Charisma", "influence"),
  cha: attr("Charisma", "influence"),

  // ── Specialties that a Roll Axis path carries ──
  "weapon mastery": spec("Weapon Mastery", "power"),
  wm: spec("Weapon Mastery", "power"),
  precision: spec("Precision", "density"),
  pre: spec("Precision", "density"),
  balance: spec("Balance", "evasion"),
  bal: spec("Balance", "evasion"),
  adaptation: spec("Adaptation", "recovery"),
  // The pages spell it both ways; abilityActions.ts already scans for both.
  adaption: spec("Adaptation", "recovery"),
  adp: spec("Adaptation", "recovery"),
  "mental fortitude": spec("Mental Fortitude", "capacity"),
  mf: spec("Mental Fortitude", "capacity"),
  cunning: spec("Cunning", "influence"),
  cun: spec("Cunning", "influence"),
  // Perception is the name of a specialty AND of the path that carries it. Both
  // readings reach the same route, so the source is left open rather than
  // guessed from a sentence that cannot distinguish them.
  perception: pathOnly("Perception", "perception"),
  per: spec("Perception", "perception"),

  // ── Path names written bare, without the Physical/Mental prefix ──
  power: pathOnly("Power", "power"),
  density: pathOnly("Density", "density"),
  evasion: pathOnly("Evasion", "evasion"),
  recovery: pathOnly("Recovery", "recovery"),
  capacity: pathOnly("Capacity", "capacity"),
  influence: pathOnly("Influence", "influence"),

  // ── Real specialties that no Roll Axis path carries ──
  // The seven paths pair seven of the ten specialties. These three are left
  // over, and a roll named on one of them has no route to resolve through.
  inspiration: offAxis("Inspiration", "Inspiration is a specialty no Roll Axis path carries."),
  ins: offAxis("Inspiration", "Inspiration is a specialty no Roll Axis path carries."),
  weight: offAxis("Weight", "Weight is a specialty no Roll Axis path carries."),
  wt: offAxis("Weight", "Weight is a specialty no Roll Axis path carries."),
  control: offAxis("Control", "Control is a specialty no Roll Axis path carries."),
  ctrl: offAxis("Control", "Control is a specialty no Roll Axis path carries."),

  // ── Words the legacy prose rolls that name no W.T.E statistic ──
  // Listed so they REPORT. Bending CON onto Endurance or ADA onto Adaptation
  // would be inventing a rule and calling it canon.
  con: undeclared("CON", "CON is a D&D attribute; W.T.E declares no Constitution."),
  constitution: undeclared("CON", "CON is a D&D attribute; W.T.E declares no Constitution."),
  ada: undeclared("ADA", "ADA is rolled by the prose but declared by no page as a statistic."),
  insight: undeclared("Insight", "Insight is rolled by the prose but is not a W.T.E specialty."),
};

export type LegacyRefusalCode =
  | "direction-not-on-path"
  | "off-axis-statistic"
  | "undeclared-statistic"
  | "contradictory-hybrid";

export interface LegacyRoute {
  /** The legacy spelling as it was written. */
  term: string;
  /** That word in today's vocabulary. */
  stat: string;
  ref: InceptRollRef;
  source?: LegacySource;
  /** How the route reads back, e.g. `Mental Check — Capacity`. */
  label: string;
}

export interface LegacyRefusal {
  term: string;
  stat: string;
  direction: RollDirection;
  code: LegacyRefusalCode;
  /** One sentence a human can act on. Never a suggested substitute. */
  detail: string;
}

export type LegacyTranslation = { ok: true; route: LegacyRoute } | { ok: false; refusal: LegacyRefusal };

const PATH_BY_ID = new Map(ROLL_AXIS_PATHS.map((path) => [path.id, path]));

function lookup(term: string): LegacyStat | undefined {
  const key = term.trim().toLowerCase().replace(/\s+/g, " ");
  return Object.prototype.hasOwnProperty.call(LEGACY_STATS, key) ? LEGACY_STATS[key] : undefined;
}

/** Is this word in the dictionary at all? Lets a caller tell "not a stat" apart
 *  from "a stat that cannot be routed" without provoking a refusal. */
export function isLegacyStatWord(term: string): boolean {
  return lookup(term) !== undefined;
}

/** Every legacy spelling the dictionary knows, for authoring UIs and audits. */
export function legacyStatWords(): string[] {
  return Object.keys(LEGACY_STATS).sort();
}

/**
 * `("Dexterity", "save")` → the Physical Save — Evasion route.
 *
 * Returns null when the word is not in the closed table — that is "this is not
 * a statistic I know", which is different from a refusal and must not be
 * reported as one. Everything the table DOES know either routes or refuses with
 * a reason; nothing falls through to a nearest neighbour.
 */
export function translateLegacyStat(term: string, direction: RollDirection): LegacyTranslation | null {
  const entry = lookup(term);
  if (!entry) return null;
  if (!entry.seat) {
    // "CON" names nothing; "Inspiration" names something the axis does not
    // carry. A reader deciding what to do about it needs to know which.
    const code = entry.unseated ?? "undeclared-statistic";
    return { ok: false, refusal: { term, stat: entry.stat, direction, code, detail: entry.note ?? "" } };
  }
  const path = PATH_BY_ID.get(entry.seat.path);
  if (!path || !path.directions.includes(direction)) {
    const has = path ? path.directions.map((d) => (d === "check" ? "check" : "save")).join(" and ") : "no";
    return {
      ok: false,
      refusal: {
        term,
        stat: entry.stat,
        direction,
        code: "direction-not-on-path",
        detail: `${entry.stat} sits on the ${path?.name ?? entry.seat.path} path, which has a ${has} only — no ${direction}.`,
      },
    };
  }
  return {
    ok: true,
    route: {
      term,
      stat: entry.stat,
      ref: { axis: path.axis, direction, path: path.id },
      source: entry.seat.source,
      label: `${path.axis === "physical" ? "Physical" : "Mental"} ${direction === "check" ? "Check" : "Save"} — ${path.name}`,
    },
  };
}

// ── Phrase grammar ─────────────────────────────────────────────────────────
//
// The direction words the legacy dialect actually uses, enumerated from the
// corpus. "Saving Throw" and "Save" are saves. "Check" is a check. A bare
// `roll <Stat>` — "roll Wisdom (DC 12)", "Roll Intelligence (DC 25)" — is a
// CHECK: in this dialect the acting character rolls, and a target-side
// resolution is always spelled with the word Save or Saving Throw. That is a
// stated rule, not a guess, and it is the only place direction is inferred.
const DIRECTION_WORD: Readonly<Record<string, RollDirection>> = {
  check: "check",
  checks: "check",
  roll: "check",
  rolls: "check",
  save: "save",
  saves: "save",
  "saving throw": "save",
  "saving throws": "save",
};

/** Qualifiers the old prose stacks between the stat and the direction word.
 *  "Perception Skill Check" is a Perception check with a decorative middle. */
const FILLER = new Set(["skill", "skills"]);

/** Stat names run up to three words ("Action Priority", "Mental Fortitude"). */
const MAX_TERM_WORDS = 3;

const PHRASE_RE =
  /\b((?:[A-Za-z][A-Za-z'’-]*\s+){0,4}?)(saving\s+throws?|checks?|saves?|rolls?)\b/gi;

export interface LegacyPhrase {
  /** The exact text matched, so a report can quote the page. */
  phrase: string;
  /** Where the match starts, so a caller can tell one mention of a statistic
   *  from another and so overlapping readings can be resolved. */
  index: number;
  end: number;
  direction: RollDirection;
  /** The direction word was written plural — "Dexterity Saving THROWS". The old
   *  prose spells a standing penalty that way ("Disadvantage on Balance
   *  Checks") and a roll somebody actually makes in the singular, so a caller
   *  arming dice needs to tell the two apart. */
  plural: boolean;
  translation: LegacyTranslation;
}

/** Split "Dexterity and Cunning" — one direction word can govern a list. */
function candidateTerms(lead: string): string[] {
  const words = lead.trim().split(/\s+/).filter(Boolean);
  while (words.length && FILLER.has(words[words.length - 1].toLowerCase())) words.pop();
  if (!words.length) return [];
  const joined = words.join(" ");
  const parts = joined.split(/\s*(?:,|\band\b|\bor\b)\s*/i).filter(Boolean);
  const out: string[] = [];
  for (const part of parts) {
    const pieces = part.trim().split(/\s+/);
    // Longest first: "Mental Fortitude" must beat the bare "Fortitude" tail.
    for (let take = Math.min(MAX_TERM_WORDS, pieces.length); take >= 1; take--) {
      const candidate = pieces.slice(pieces.length - take).join(" ");
      if (isLegacyStatWord(candidate)) {
        out.push(candidate);
        break;
      }
    }
  }
  return out;
}

/**
 * Read one stretch of legacy prose and return every roll it names.
 *
 * Words outside the closed table are simply not returned: "progression checks",
 * "Opportunity Rolls" and "any stat-based check" are prose, not routes, and a
 * dictionary that shouted about them would train a Curator to stop reading it.
 */
export function scanLegacyRolls(text: string): LegacyPhrase[] {
  const out: LegacyPhrase[] = [];
  const source = String(text || "").replace(/\\n/g, "\n");
  let m: RegExpExecArray | null;
  PHRASE_RE.lastIndex = 0;
  while ((m = PHRASE_RE.exec(source))) {
    const direction = DIRECTION_WORD[m[2].trim().toLowerCase().replace(/\s+/g, " ")];
    if (!direction) continue;
    for (const term of candidateTerms(m[1])) {
      const translation = translateLegacyStat(term, direction);
      if (!translation) continue;
      out.push({
        phrase: `${term} ${m[2].replace(/\s+/g, " ")}`.trim(),
        index: m.index,
        end: m.index + m[0].length,
        direction,
        plural: /s$/i.test(m[2].trim()),
        translation,
      });
    }
  }
  return out;
}

// ── The hybrid form ────────────────────────────────────────────────────────
//
// A handful of pages write half of each vocabulary at once:
//
//     force a Perception Save - Intelligence upon the weakened enemy
//     resist the condition by making a Mental Check - Wisdom
//
// The head is Roll Axis (an axis or a path plus a direction); the tail is a
// legacy statistic where a Roll Axis phrase would carry a path name. Neither
// parser recognises it, so both sentences currently reach no dice at all.
//
// The tail is what decides the route — it names the statistic being rolled —
// and the head is then CHECKED against it rather than trusted. "Physical Check
// - Wisdom" names a physical roll on a mental statistic; that is a contradiction
// in the sentence, and picking a winner would be choosing which half of the
// user's rule to throw away.
const HYBRID_RE =
  /\b(Physical|Mental|Power|Density|Evasion|Recovery|Capacity|Perception|Influence)\s+(Checks?|Saves?|Saving\s+Throws?)\s*[—–:·-]\s*([A-Za-z][A-Za-z' ]*?)\b(?=[\s.,;)]|$)/gi;

export function scanLegacyHybrids(text: string): LegacyPhrase[] {
  const out: LegacyPhrase[] = [];
  const source = String(text || "").replace(/\\n/g, "\n");
  let m: RegExpExecArray | null;
  HYBRID_RE.lastIndex = 0;
  while ((m = HYBRID_RE.exec(source))) {
    const head = m[1].toLowerCase();
    const direction = DIRECTION_WORD[m[2].trim().toLowerCase().replace(/\s+/g, " ")];
    if (!direction) continue;
    const [tail] = candidateTerms(m[3]);
    if (!tail) continue;
    const translation = translateLegacyStat(tail, direction);
    if (!translation) continue;
    const phrase = m[0].replace(/\s+/g, " ").trim();
    const span = { index: m.index, end: m.index + m[0].length, plural: /s$/i.test(m[2].trim()) };
    if (!translation.ok) {
      out.push({ phrase, ...span, direction, translation });
      continue;
    }
    const route = translation.route;
    const headMatches = head === "physical" || head === "mental" ? head === route.ref.axis : head === route.ref.path;
    if (!headMatches) {
      out.push({
        phrase,
        ...span,
        direction,
        translation: {
          ok: false,
          refusal: {
            term: tail,
            stat: route.stat,
            direction,
            code: "contradictory-hybrid",
            detail: `${m[1]} contradicts ${route.stat}, which sits on ${route.label}.`,
          },
        },
      });
      continue;
    }
    out.push({ phrase, ...span, direction, translation });
  }
  return out;
}

/**
 * Every legacy roll one stretch of prose names, hybrids included.
 *
 * A hybrid's head is itself a bare `Perception Save`, which the plain scanner
 * also reads. The hybrid reading wins over any plain hit inside its span:
 * it is the one that checked both halves of the sentence against each other.
 */
export function scanLegacyVocabulary(text: string): LegacyPhrase[] {
  const hybrids = scanLegacyHybrids(text);
  const plain = scanLegacyRolls(text).filter(
    (found) => !hybrids.some((hybrid) => found.index < hybrid.end && found.end > hybrid.index)
  );
  return [...hybrids, ...plain].sort((a, b) => a.index - b.index);
}

/** The routes and the refusals of one page, split for a report. */
export function legacyReport(text: string): { routes: LegacyRoute[]; refusals: LegacyRefusal[] } {
  const routes: LegacyRoute[] = [];
  const refusals: LegacyRefusal[] = [];
  for (const found of scanLegacyVocabulary(text)) {
    if (found.translation.ok) routes.push(found.translation.route);
    else refusals.push(found.translation.refusal);
  }
  return { routes, refusals };
}

// A capitalised word that reads like the name of a statistic — "Wisdom",
// "Balance". Deliberately narrow: the corpus is full of lowercase prose
// ("progression checks", "that check") and of hyphenated qualifiers
// ("DC-based checks") that name no statistic and must not be reported.
const NAME_RE = /^(?:[A-Z][a-z']+|[A-Z]{2,4})$/;

/** Words that sit where a statistic would but name none: the two axis words a
 *  Roll Axis phrase opens with, and the vocabulary of DVs. Reporting these as
 *  unmapped statistics would bury a real one under `Physical Check`. */
const NOT_A_STATISTIC = new Set(["physical", "mental", "dc", "dv", "dice", "check", "checks", "save", "saves", "throw", "throws"]);

/**
 * Capitalised words rolled by an explicit Check / Save / Saving Throw that the
 * closed table does not contain.
 *
 * This is the tripwire. The table was built by enumerating the shipped corpus,
 * so today this returns nothing; the day someone authors a new legacy phrase it
 * returns that phrase instead of the app quietly resolving nothing.
 */
export function unmappedRollWords(text: string): string[] {
  const out = new Set<string>();
  const source = String(text || "").replace(/\\n/g, "\n");
  const re = /\b((?:[A-Za-z][A-Za-z'’-]*\s+){1,3}?)(saving\s+throws?|checks?|saves?)\b/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source))) {
    const words = m[1].trim().split(/\s+/).filter((w) => !FILLER.has(w.toLowerCase()));
    if (!words.length) continue;
    const parts = words.join(" ").split(/\s*(?:,|\band\b|\bor\b)\s*/i).filter(Boolean);
    for (const part of parts) {
      const pieces = part.trim().split(/\s+/);
      let known = false;
      for (let take = Math.min(MAX_TERM_WORDS, pieces.length); take >= 1 && !known; take--) {
        if (isLegacyStatWord(pieces.slice(pieces.length - take).join(" "))) known = true;
      }
      if (known) continue;
      const tail = pieces[pieces.length - 1];
      if (NAME_RE.test(tail) && !NOT_A_STATISTIC.has(tail.toLowerCase())) out.add(tail);
    }
  }
  return [...out].sort();
}
