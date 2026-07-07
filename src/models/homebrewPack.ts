/** A bundle of community/homebrew content (rules, actors, assets) that can be
 *  shared and layered onto a campaign. */
export interface HomebrewPack {
  id: string;
  campaignId?: string | null;
  name: string;
  version?: string;
  data?: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
}
