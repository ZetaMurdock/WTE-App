// Where a summoned body's numbers come from.
//
// `Summon: 100 Lesser Stygian` names a creature. It does not state a statline,
// and it must not: a page that carried its own HP would be a stat block welded
// into an ability, editable only by whoever edits that ability. So the name is
// resolved against content that already exists and that a table can already
// open and change — the campaign's quick creatures and the Codex's creature
// pages. Both are editable in the app; neither is compiled into this file.
//
// WHAT THIS MODULE REFUSES TO DO is the important half.
//
// Parts of the corpus give a summon's profile in PROSE. Seraph's Kirkndomou
// says a Vibra "without a dedicated profile uses 75 HP · Attack Power 10 ·
// Evasion 10 · Action Priority 5 · all other resolutions 7"; Elemental Genus's
// Living Element says "HP equal to 10 + Neuronal Capacity Modifier". Reading
// those sentences here and typing their numbers into TypeScript would put the
// setting's own rules somewhere no table could fork — the exact thing this app
// exists not to do. So an unmatched name resolves to `unstatted`, the bodies
// still arrive (a summon that placed nothing would be worse), and the caller
// SAYS that they carry no profile and where one would have to be written.
//
// The Curator then has two doors, both of them content: type a quick creature
// with that name, or give the creature a Codex page. Either makes the next
// summon of that name resolve, and the numbers live where they can be edited.
import type { QuickCreature } from "./quickCreatures";
import type { CreatureSpawnPayload } from "./actorSpawn";

/** Which store answered. Shown to the Curator, because "your campaign's quick
 *  block" and "the shared Codex page" are different claims about where to go
 *  and edit the numbers. */
export type SummonSource = "quick-creature" | "codex-creature";

export interface SummonProfile {
  source: SummonSource;
  /** The name as the CONTENT spells it, which may differ in case or spacing
   *  from the page's word. */
  name: string;
  /** The payload `creatureToTokenSpec` already knows how to place. Reused
   *  rather than re-derived so a summoned Lesser Stygian and one spawned by
   *  hand from the Actors panel cannot end up with different HP. */
  spawn: CreatureSpawnPayload;
}

export type SummonResolution =
  | {
      status: "resolved";
      profile: SummonProfile;
      /** The same name in the other store. Not an error — a table may keep a
       *  campaign-local block for a creature that also has a page — but the
       *  Curator is told, because two statlines under one name is exactly the
       *  situation where the wrong one lands silently. */
      shadowed: SummonProfile[];
    }
  | {
      /** Two entries in the SAME store answer to this name. The engine does not
       *  pick; picking would make one of the table's own pages unreachable by
       *  a coin flip nobody can see. */
      status: "ambiguous";
      name: string;
      matches: SummonProfile[];
    }
  | { status: "unstatted"; name: string };

/** A Codex creature page, already run through `computeCreature` by the caller.
 *  Kept structural on purpose: this module must not reach into the Codex
 *  loader, which is async and Tauri-only, to answer a pure question. */
export interface CodexSummonEntry {
  name: string;
  cls?: number;
  hp: number;
  dr?: number;
  size?: number;
  flags?: string[];
  stats?: Record<string, number>;
  traits?: string;
  desc?: string;
}

export interface SummonRoster {
  quick?: readonly QuickCreature[];
  codex?: readonly CodexSummonEntry[];
}

/**
 * How two names are judged the same.
 *
 * Case and inner whitespace only. Deliberately NOT fuzzy: "Lesser Stygian"
 * matching "Greater Stygian" because they share a word would hand a swarm the
 * wrong statline, and a summon that silently used the wrong creature is worse
 * in every way than one that reports it found nothing.
 *
 * A trailing plural is the one exception, and only the bare "-s": the corpus
 * writes "conjure 100 Lesser Stygian Minions" while a bestiary page names the
 * singular "Lesser Stygian Minion", and a table should not have to keep two
 * spellings in sync to make a count work.
 */
export function summonNameKey(name: string): string {
  const folded = String(name ?? "").trim().replace(/\s+/g, " ").toLowerCase();
  return folded.endsWith("s") ? folded.slice(0, -1) : folded;
}

function fromQuick(qc: QuickCreature): SummonProfile {
  return {
    source: "quick-creature",
    name: qc.name,
    spawn: {
      name: qc.name,
      hp: qc.hp,
      dr: qc.dr,
      size: qc.size,
      stats: qc.stats,
      traits: qc.traits,
      desc: qc.desc,
    },
  };
}

function fromCodex(entry: CodexSummonEntry): SummonProfile {
  return {
    source: "codex-creature",
    name: entry.name,
    spawn: {
      name: entry.name,
      cls: entry.cls,
      hp: entry.hp,
      dr: entry.dr,
      size: entry.size,
      flags: entry.flags,
      stats: entry.stats,
      traits: entry.traits,
      desc: entry.desc,
    },
  };
}

/**
 * Resolve one declared summon name against the table's own content.
 *
 * The campaign's quick creature wins a tie with a Codex page. A quick block was
 * typed into THIS campaign by the Curator running THIS table, while a Codex
 * page is shared across every campaign in the vault; when both answer, the
 * narrower one is the one that was aimed at this game. The loser is returned in
 * `shadowed` rather than dropped, so the choice is visible instead of silent.
 */
export function resolveSummon(name: string, roster: SummonRoster): SummonResolution {
  const key = summonNameKey(name);
  const label = String(name ?? "").trim();
  if (!key) return { status: "unstatted", name: label };

  const quick = (roster.quick ?? []).filter((qc) => summonNameKey(qc.name) === key).map(fromQuick);
  const codex = (roster.codex ?? []).filter((entry) => summonNameKey(entry.name) === key).map(fromCodex);
  if (quick.length > 1) return { status: "ambiguous", name: label, matches: quick };
  if (quick.length === 0 && codex.length > 1) return { status: "ambiguous", name: label, matches: codex };
  const winner = quick[0] ?? codex[0];
  if (!winner) return { status: "unstatted", name: label };
  const shadowed = quick[0] ? codex : [];
  return { status: "resolved", profile: winner, shadowed };
}

/**
 * What the Curator reads before confirming, in one line.
 *
 * The unstatted sentence names the two places a profile could be written,
 * because "no profile found" on its own tells a table it has hit a wall rather
 * than a fork in the road.
 */
export function summonProfileNote(resolution: SummonResolution): string {
  if (resolution.status === "ambiguous") {
    return `Two entries are named “${resolution.name}” — rename one, or the table cannot say which statline these bodies have.`;
  }
  if (resolution.status === "unstatted") {
    return `No creature page or quick creature is named “${resolution.name}”. The bodies will be placed with no profile — give the creature a page or a quick block and they arrive with its numbers.`;
  }
  const { profile, shadowed } = resolution;
  const where = profile.source === "quick-creature" ? "quick creature" : "Codex creature page";
  const hp = profile.spawn.hp != null ? ` · ${profile.spawn.hp} HP` : "";
  const also = shadowed.length ? ` (a Codex page of the same name is not being used)` : "";
  return `${profile.name} — ${where}${hp}${also}`;
}
