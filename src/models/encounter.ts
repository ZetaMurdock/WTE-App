export interface Encounter {
  id: string;
  campaignId: string;
  name: string;
  sceneId?: string | null;
  /** Ordered combatant refs (character/actor/token ids), initiative, round, etc. */
  data?: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
}
