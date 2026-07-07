export interface Scene {
  id: string;
  campaignId: string;
  name: string;
  /** Whether this is the campaign's current active scene. */
  active?: boolean;
  /** Background map asset id, grid config, fog, etc. */
  data?: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
}
