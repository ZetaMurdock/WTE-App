// The Curator's genus contest — token vs token, resolved from real records.
//
// The first contest UI lived on the player sheet and asked the PLAYER to type
// the opponent's name, Focus, Control and rank into four fields — numbers only
// the Curator knows, hand-copied mid-encounter. The redesign inverts it: the
// Curator selects their combatant, targets a token, picks the genus being
// pressed, and the contest resolves itself — both sides' Focus, Control and
// rank read straight off the records, the defender answering with their most
// strongly focused genus, dice thrown only when the Focus rule calls for them.
import { focusContest, type ContestResult, type ContestSide } from "../../game/synapticFocus";
import type { RuleLayer } from "../../game/ruleLayers";
import type { CharacterRecord } from "../../lib/characters";
import { characterActionSet, characterEffectiveRollScores, type VttAbility } from "./characterAbilities";

export interface TokenContestOutcome {
  result: ContestResult;
  attacker: ContestSide;
  defender: ContestSide;
  /** The genus the defender answered with. */
  defenderAbility: string;
  /** One line for the toast: who landed on whom, and why. */
  verdict: string;
}

function side(record: CharacterRecord, abilityName: string, focus: number): ContestSide {
  const scores = characterEffectiveRollScores(record);
  return {
    label: `${record.name || "Unnamed"} · ${abilityName}`,
    focus,
    control: scores.spec.ctrl ?? 0,
    rank: record.sheet.rank ?? 0,
  };
}

/** The defender's strongest invested genus — the one that answers a contest.
 *  Null when they have no genus at all: there is nothing to contest WITH. */
export function bestContestAnswer(record: CharacterRecord, layers?: RuleLayer[]): VttAbility | null {
  const genus = characterActionSet(record, layers).genus;
  if (!genus.length) return null;
  return genus.reduce((best, candidate) => ((candidate.focus ?? 0) > (best.focus ?? 0) ? candidate : best));
}

/**
 * Resolve one Curator-initiated contest. Returns null when the defender has no
 * genus — the caller says so instead of inventing a zero-Focus phantom.
 */
export function contestTokens(
  attacker: CharacterRecord,
  ability: VttAbility,
  defender: CharacterRecord,
  layers?: RuleLayer[]
): TokenContestOutcome | null {
  const answer = bestContestAnswer(defender, layers);
  if (!answer) return null;
  const a = side(attacker, ability.name, ability.focus ?? 0);
  const b = side(defender, answer.name, answer.focus ?? 0);
  const result = focusContest(a, b);
  const winner = result.winner === "a" ? attacker.name || "The attacker" : defender.name || "The defender";
  const verdict = result.byFocus
    ? `${result.note}`
    : `${result.note} ${winner} takes the contest.`;
  return { result, attacker: a, defender: b, defenderAbility: answer.name, verdict };
}
