import type { CharacterRecord } from "../../lib/characters";
import type { NetRollAxisRequest } from "../../net/protocol";
import {
  attributeRollProfile,
  rollProfileExpr,
  signedMod,
  specialtyRollProfile,
  resolveStatToken,
} from "../../game/wte";
import { ROLL_AXIS_PATHS, rollAxisChoices } from "../../game/rollAxis";
import { characterEffectiveRollScores, characterRollAxisStats } from "./characterAbilities";

export interface RequestedRollSpec {
  stat?: string;
  rollAxis?: NetRollAxisRequest;
}

export interface RequestedRollOption {
  /** Human-facing source choice, such as Dexterity or Balance. */
  label: string;
  /** Canonical dice-tray expression resolved from current character + Codex. */
  expr: string;
  /** Auditable source + derived breakdown shown below the source name. */
  detail?: string;
}

/** Resolve a Curator request on the machine that owns the character.
 *
 * Axis requests deliberately return both legal sources: choosing attribute or
 * specialty is part of the normal Roll Axis flow. Legacy stat-only messages
 * return one option and retain their pre-axis behavior. An invalid axis route
 * returns no options instead of quietly becoming a bare d20. */
export function requestedRollOptions(record: CharacterRecord, request: RequestedRollSpec): RequestedRollOption[] {
  if (request.rollAxis) {
    const path = ROLL_AXIS_PATHS.find(
      (candidate) => candidate.id === request.rollAxis!.path && candidate.directions.includes(request.rollAxis!.direction)
    );
    if (!path) return [];
    return rollAxisChoices(path, request.rollAxis.direction, characterRollAxisStats(record)).map((choice) => ({
      label: choice.sourceLabel,
      expr: choice.expr,
      detail: `${choice.sourceShort} ${signedMod(choice.sourceMod)} + ${path.derived.short} ${signedMod(choice.derivedMod)} = ${signedMod(choice.totalMod)}`,
    }));
  }

  const resolved = request.stat ? resolveStatToken(request.stat) : null;
  const scores = characterEffectiveRollScores(record);
  if (resolved?.kind === "attr") {
    const value = (scores.attr as unknown as Record<string, number>)[resolved.key] ?? 0;
    return [{ label: request.stat || "Attribute", expr: rollProfileExpr(attributeRollProfile(value)) }];
  }
  if (resolved?.kind === "spec") {
    const value = (scores.spec as unknown as Record<string, number>)[resolved.key] ?? 0;
    return [{ label: request.stat || "Specialty", expr: rollProfileExpr(specialtyRollProfile(value)) }];
  }
  return [{ label: request.stat || "Roll", expr: "1d20" }];
}
