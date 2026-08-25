import type { Attributes, Specialties, Background, DerivedKey, EquipmentItem } from "../game/wte";

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
  /** The 2 (of 4) species innate abilities chosen ACTIVE at creation, by name.
   *  The 2 unselected become Incept-pool seeds. Empty/undefined = all active
   *  (legacy characters made before the choose-2-of-4 rule). */
  innateChoice?: string[];
  paradigmId?: string;
  /** Curator-managed rank 0..9. */
  rank?: number;
  /** Remnant's Field Affinity Selection: the player-chosen additional Favored
   *  Attribute / Specialty (attr/spec keys). Only meaningful when the active
   *  paradigm declares a choice slot; Quick Hack may retune them mid-scene. */
  favoredAttr?: string;
  favoredSpec?: string;
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
  /** Pressure Engine — current PE/BP 0..200 (default 50). */
  pressure?: number;
  /** Negotiation Engine — the client currently across the table. */
  negotiation?: { client?: string; resistance?: number; eminenceReq?: number };
  equipment?: EquipmentItem[];
  /** Cipher ability names (loadout, capped by rank slots).
   *  genusLoadout is LEGACY as of the Synaptic Focus rework — focusSpend.genus is
   *  now the source of truth for which genus a character knows. It is retained so
   *  pre-Focus sheets migrate cleanly and nothing silently loses data. */
  genusLoadout?: string[];
  cipherLoadout?: string[];
  /** Player-defined bio fields — age, favourite food, a tally of something. */
  bioFields?: { id: string; label: string; value: string; kind: "text" | "number" | "counter" }[];
  /** Synaptic Focus spend: genus name → Focus 1…4, plus unlocked Incept names.
   *  Focus IS access — see game/synapticFocus.ts. */
  focusSpend?: { genus: Record<string, number>; incepts: string[] };
  /** Extra Synaptic Focus banked by Hyomen's Talent Holder — one point per
   *  rank-up where a d100 landed on 50 or better. Rolled once, then kept. */
  focusBonus?: number;
  /** Ranks already rolled for Talent Holder, so dropping and re-raising rank
   *  cannot farm the bonus. */
  focusBonusRank?: number;
  /** Equipped weapon / gear names from the baked Codex catalogs. */
  weaponLoadout?: string[];
  gearLoadout?: string[];
  /** Synaptic Space spent (current SS = derived SS − ssSpent); reset by Rest. */
  ssSpent?: number;
  /** Damage taken to HP (current HP = hpMax − hpDamage). */
  hpDamage?: number;
  /** Damage taken to DHP (current DHP = dhpMax − dhpDamage). */
  dhpDamage?: number;
  /** Curator switch: may this character's stats be hand-edited/overridden? */
  allowOverrides?: boolean;
  /** Manual derived-stat overrides (Curator-sanctioned) — replace computed values. */
  derivedOverrides?: Partial<Record<DerivedKey, number>> & { hpMax?: number; ncMod?: number };
  notes?: string;
  // ── Vault organization ──────────────────────────────────────────────────────
  /** Which vault folder this entry lives in (null/undefined = the vault root). */
  folderId?: string | null;
  /** Free-form tags — the player/Curator names them (NPC, Creature, Boss, Ally…). */
  tags?: string[];
  /** Full-Markdown notes attached to the character (lore, session log, secrets). */
  notesMd?: string;
}
