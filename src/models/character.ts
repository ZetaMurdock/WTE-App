import type { Attributes, Specialties, Background, EquipmentItem } from "../game/wte";

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
  /** Chosen species variant (lineage), by its display name — see Species.variants. */
  variantName?: string;
  /** Chosen variant option label (e.g. Annunaki head shape). */
  variantOption?: string;
  paradigmId?: string;
  /** Curator-managed rank 0..9. */
  rank?: number;
  /** Character portrait — a PNG data URL the player uploads. */
  portrait?: string;
  background?: Background;
  /** Size class key, or "auto" (default per species). */
  sizeId?: string;
  /** The Sector in which the Inquisitor joined their Paradigm (see The 16 Sectors). */
  sector?: string;
  /** Polarized Soul position 0..100 (0 = Process, 100 = Resonance). Default 50. */
  morality?: number;
  /** Eminence — System Alignment Index, −20 (liability) … +20 (asset). Default 0. */
  eminence?: number;
  equipment?: EquipmentItem[];
  /** Selected genus / cipher ability names (loadout, capped by rank slots). */
  genusLoadout?: string[];
  cipherLoadout?: string[];
  /** Equipped weapon / gear names from the baked Codex catalogs. */
  weaponLoadout?: string[];
  gearLoadout?: string[];
  /** Synaptic Space spent (current SS = derived SS − ssSpent); reset by Rest. */
  ssSpent?: number;
  notes?: string;
}
