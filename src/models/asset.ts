export type AssetKind = "map" | "token" | "music" | "handout" | "image" | "other";

export interface Asset {
  id: string;
  campaignId: string | null;
  kind: AssetKind;
  name: string;
  /** File path or URL to the asset. */
  uri: string;
  createdAt: number;
}
