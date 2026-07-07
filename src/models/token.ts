export interface Token {
  id: string;
  sceneId: string;
  /** Optional link to a character or actor this token represents. */
  characterId?: string | null;
  actorId?: string | null;
  name: string;
  x: number;
  y: number;
  data?: Record<string, unknown>;
}
