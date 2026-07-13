// VTT v2 (slice 9): typed encounter / initiative model. Rides the v1 `encounters`
// table (id/campaign_id/name/scene_id/data JSON). One encounter links to a scene
// via scene.data.encounterId; round is mirrored into scene.data.timeline.
import { newId } from "./scene";

export interface VttCombatant {
  id: string;
  name: string;
  /** Linked scene token, so HP edits can push to the map. */
  tokenId?: string | null;
  initiative: number;
  hp: number;
  hpMax: number;
  /** Condition / status tags (e.g. "prone", "stunned"). */
  status: string[];
  color?: string;
}

export interface VttEncounterData {
  round: number;
  /** The combatant whose turn it is (id, not index — survives re-sorting). */
  activeId: string | null;
  combatants: VttCombatant[];
}

export interface VttEncounter {
  id: string;
  campaignId: string;
  sceneId: string | null;
  name: string;
  data: VttEncounterData;
  createdAt: number;
  updatedAt: number;
}

export function defaultEncounterData(): VttEncounterData {
  return { round: 1, activeId: null, combatants: [] };
}

export function newEncounter(campaignId: string, sceneId: string | null, name = "Encounter"): VttEncounter {
  const now = Date.now();
  return { id: newId("en"), campaignId, sceneId, name, data: defaultEncounterData(), createdAt: now, updatedAt: now };
}

/** Combatants sorted for the initiative order (highest first; name breaks ties). */
export function orderedCombatants(d: VttEncounterData): VttCombatant[] {
  return [...d.combatants].sort((a, b) => b.initiative - a.initiative || a.name.localeCompare(b.name));
}

/** The turn index (1-based position of activeId) for display, or 0 if none. */
export function turnNumber(d: VttEncounterData): number {
  if (!d.activeId) return 0;
  const i = orderedCombatants(d).findIndex((c) => c.id === d.activeId);
  return i < 0 ? 0 : i + 1;
}
