/** A non-player combatant: NPC, creature/bestiary entry, or other stat block. */
export interface Actor {
  id: string;
  campaignId: string | null;
  name: string;
  kind: "npc" | "creature" | "other";
  data?: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
}
