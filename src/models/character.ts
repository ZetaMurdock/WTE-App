export interface Character {
  id: string;
  campaignId: string | null;
  name: string;
  /** Serialized sheet fields — a bridge until the Phase 5 sheet rebuild models them fully. */
  data?: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
}
