export interface Roll {
  id: string;
  campaignId: string | null;
  characterId?: string | null;
  /** Dice expression, e.g. "2d6+3". */
  formula: string;
  result: number;
  detail?: Record<string, unknown>;
  at: number;
}
