// Slice 8: turn linked actors into token specs. Two sources:
//  - vault characters (SQLite): derive HP/size from the sheet like the sheet does.
//  - Codex creatures: the legacy `wte-spawn-creature` localStorage payload.
import type { CharacterRecord } from "../../lib/characters";
import {
  aggregateEquip,
  mergeMods,
  computeDerived,
  sizeOf,
  bgBonuses,
} from "../../game/wte";
import { loadoutMods } from "../../lib/codex";
import { TOKEN_COLORS, type VttToken } from "../types/scene";

/** WTE size class → token diameter in grid cells. */
const SIZE_TO_CELLS: Record<string, number> = {
  tiny: 1,
  small: 1,
  moderate: 1,
  large: 2,
  huge: 3,
  colossal: 4,
};

/** Stable per-id colour so a character keeps the same token tint across spawns. */
function colorFor(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return TOKEN_COLORS[h % TOKEN_COLORS.length];
}

/** Derive a linked token spec from a vault character record. */
export function characterToTokenSpec(rec: CharacterRecord): Partial<VttToken> {
  const sheet = rec.sheet;
  const equip = mergeMods(
    aggregateEquip(sheet.equipment ?? []),
    loadoutMods(sheet.weaponLoadout ?? [], sheet.gearLoadout ?? [])
  );
  const size = sizeOf(sheet.sizeId, sheet.speciesId);
  const derived = computeDerived(sheet.attributes, sheet.specialties, {
    speciesId: sheet.speciesId,
    rank: sheet.rank ?? 0,
    bgBonuses: bgBonuses(sheet.background),
    equip,
    sizeMove: size.move,
    overrides: sheet.derivedOverrides,
  });
  const hpMax = Math.max(1, derived.hpMax);
  return {
    name: rec.name,
    characterId: rec.id,
    actorKind: "character",
    hp: hpMax,
    hpMax,
    size: SIZE_TO_CELLS[size.key] ?? 1,
    color: colorFor(rec.id),
    vision: 5,
    meta: { cls: sheet.rank ?? 0, stats: { ...sheet.attributes } },
  };
}

/** The `wte-spawn-creature` payload the Codex "Spawn in VTT" button writes. */
export interface CreatureSpawnPayload {
  name: string;
  cls?: number;
  hp?: number;
  dr?: number;
  size?: number;
  color?: string;
  flags?: string[];
  stats?: Record<string, number>;
  traits?: string;
  desc?: string;
  ts?: number;
}

const SPAWN_FRESH_MS = 20000; // match the legacy VTT's staleness guard

/** Parse + freshness-check a raw spawn payload (string or already-parsed detail). */
export function parseSpawnPayload(raw: unknown): CreatureSpawnPayload | null {
  let p: CreatureSpawnPayload | null = null;
  try {
    p = typeof raw === "string" ? (JSON.parse(raw) as CreatureSpawnPayload) : (raw as CreatureSpawnPayload);
  } catch {
    return null;
  }
  if (!p || !p.name) return null;
  if (p.ts && Date.now() - p.ts > SPAWN_FRESH_MS) return null;
  return p;
}

/** Derive a linked token spec from a Codex creature spawn payload. */
export function creatureToTokenSpec(p: CreatureSpawnPayload): Partial<VttToken> {
  const hpMax = Math.max(1, p.hp ?? 1);
  return {
    name: p.name,
    actorId: `cr-${p.ts ?? Date.now()}`,
    actorKind: "creature",
    hp: hpMax,
    hpMax,
    size: Math.max(1, Math.min(6, p.size ?? 1)),
    color: p.color || "#a1584a",
    meta: {
      dr: p.dr,
      cls: p.cls,
      traits: p.traits,
      desc: p.desc,
      flags: p.flags,
      stats: p.stats,
    },
  };
}
