import type { Attributes, Specialties } from "../game/wte";

/** DB-row metadata for a character (the `data` column holds the CharacterSheet JSON). */
export interface Character {
  id: string;
  campaignId: string | null;
  name: string;
  data?: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
}

/** The structured character payload serialized into Character.data.
 *  Derived stats are NOT stored — they are computed from these via computeDerived(). */
export interface CharacterSheet {
  attributes: Attributes;
  specialties: Specialties;
  speciesId?: string;
  paradigmId?: string;
  notes?: string;
}
