// Legacy character import: the old sheet (public/sheet.html) saves a flat
// collectAll() dump — every input by element id, plus __equipment/__stage
// blobs. This module maps that into a modern CharacterSheet. Everything that
// can't be mapped structurally (varna paths, asymmetries, backstory pages,
// unmatched abilities) lands in the notes as a readable "imported" block, so
// NOTHING is lost. The legacy iframes share this app's localStorage, so old
// characters can also be pulled straight from storage — no file needed.
import {
  ATTR_KEYS,
  SPEC_KEYS,
  SPECIES,
  PARADIGMS,
  genusForParadigm,
  ciphersForParadigm,
  type AttrKey,
  type Attributes,
  type EquipmentItem,
  type Specialties,
  type WeightKey,
} from "../game/wte";
import type { CharacterSheet } from "../models/character";

type LegacyData = Record<string, unknown>;

const WEIGHTS: WeightKey[] = ["minute", "light", "standard", "heavy", "massive", "titanic"];

function str(d: LegacyData, key: string): string {
  const v = d[key];
  return typeof v === "string" ? v.trim() : "";
}
function num(d: LegacyData, key: string): number {
  const v = d[key];
  const n = typeof v === "number" ? v : parseFloat(String(v ?? ""));
  return Number.isFinite(n) ? n : 0;
}
function eqId(): string {
  return "eq-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
}
const norm = (s: string) => s.trim().toLowerCase();

/** Every legacy key like `gn-name-3` / `c2` / `vs-a1` / `as-name-2`, in row order. */
function rowValues(d: LegacyData, re: RegExp): string[] {
  return Object.keys(d)
    .map((k) => ({ k, m: k.match(re) }))
    .filter((x) => x.m)
    .sort((a, b) => parseInt(a.m![1], 10) - parseInt(b.m![1], 10))
    .map((x) => str(d, x.k))
    .filter(Boolean);
}

export interface LegacyImportResult {
  name: string;
  sheet: CharacterSheet;
}

/** Map a legacy collectAll() dump to a modern character. Throws on non-objects. */
export function parseLegacySheet(data: unknown): LegacyImportResult {
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("Not a legacy character export.");
  const d = data as LegacyData;
  const name = str(d, "f-name") || "Imported Character";

  // attributes — the legacy sheet called Charisma "CON" (a-con slot).
  const attributes = {} as Attributes;
  for (const k of ATTR_KEYS) attributes[k] = 0;
  for (const k of ATTR_KEYS) {
    const legacyKey = k === "cha" ? "a-con" : "a-" + k;
    attributes[k as AttrKey] = num(d, legacyKey);
  }
  const specialties = {} as Specialties;
  for (const k of SPEC_KEYS) specialties[k] = num(d, "s-" + k);

  // identity — free text matched against the baked catalogs by name.
  const speciesName = str(d, "f-species");
  const species = SPECIES.find((s) => norm(s.name) === norm(speciesName));
  const paradigmName = str(d, "f-paradigm");
  const paradigm = PARADIGMS.find((p) => norm(p.name) === norm(paradigmName));
  const variantName = str(d, "f-variant") || undefined;

  // rank: the legacy "stage"; fall back to digits in the level field.
  const stage = num(d, "__stage") || parseInt(str(d, "f-level").replace(/\D+/g, ""), 10) || 0;

  // equipment: the structured __equipment list + the four weapon rows.
  const equipment: EquipmentItem[] = [];
  const legacyEq = Array.isArray(d.__equipment) ? (d.__equipment as LegacyData[]) : [];
  for (const e of legacyEq) {
    const eName = typeof e.name === "string" ? e.name.trim() : "";
    if (!eName) continue;
    const wcat = typeof e.wcat === "string" && WEIGHTS.includes(e.wcat as WeightKey) ? (e.wcat as WeightKey) : "standard";
    const extra = [e.fx, e.notes, e.slot ? `slot: ${String(e.slot)}` : ""].filter((x) => typeof x === "string" && x.trim()).join(" · ");
    equipment.push({ id: eqId(), name: eName, weight: wcat, equipped: e.equipped !== false, mods: typeof e.modText === "string" ? e.modText : "", notes: extra || undefined });
  }
  for (let i = 1; i <= 4; i++) {
    const wName = str(d, `w${i}-name`);
    if (!wName) continue;
    const detail = [str(d, `w${i}-type`), str(d, `w${i}-dmg`)].filter(Boolean).join(" · ");
    equipment.push({ id: eqId(), name: wName, weight: "standard", equipped: true, mods: "", notes: detail ? "weapon · " + detail : "weapon" });
  }

  // abilities: names that match the paradigm's standard sets become the loadout;
  // everything else is preserved in the notes block below.
  const genusNames = rowValues(d, /^gn-name-(\d+)$/);
  const cipherNames = rowValues(d, /^c(\d+)$/);
  const stdGenus = new Set(genusForParadigm(paradigm?.id).flatMap((g) => g.abilities.map((a) => norm(a.name))));
  const stdCipher = new Set(ciphersForParadigm(paradigm?.id).map((c) => norm(c.name)));
  const genusLoadout = genusNames.filter((n) => stdGenus.has(norm(n)));
  const cipherLoadout = cipherNames.filter((n) => stdCipher.has(norm(n)));

  // the "nothing is lost" block
  const leftovers: string[] = [];
  const keep = (label: string, v: string) => v && leftovers.push(`${label}: ${v}`);
  keep("Player", str(d, "f-player"));
  if (!species) keep("Species (unmatched)", speciesName);
  if (!paradigm) keep("Paradigm (unmatched)", paradigmName);
  keep("Family", str(d, "f-family"));
  keep("CAS", str(d, "f-cas"));
  keep("Size (legacy)", str(d, "f-size"));
  keep("Level (legacy)", str(d, "f-level"));
  for (const g of genusNames) if (!stdGenus.has(norm(g))) keep("Genus", g);
  for (const c of cipherNames) if (!stdCipher.has(norm(c))) keep("Cipher", c);
  for (const v of rowValues(d, /^vs-a(\d+)$/)) keep("Varna ability", v);
  keep("Varna path", str(d, "vs-path"));
  for (const a of rowValues(d, /^as-name-(\d+)$/)) keep("Asymmetry", a);
  for (const b of rowValues(d, /^bg-b(\d+)$/)) keep("Backstory", b);
  const notes = leftovers.length ? "— Imported from legacy sheet —\n" + leftovers.join("\n") : undefined;

  const sheet: CharacterSheet = {
    attributes,
    specialties,
    speciesId: species?.id,
    variantName,
    paradigmId: paradigm?.id,
    rank: Math.max(0, Math.min(9, stage)),
    background: str(d, "f-background") ? { name: str(d, "f-background"), mode: "standard", assign: [] } : undefined,
    sizeId: "auto",
    equipment: equipment.length ? equipment : undefined,
    genusLoadout: genusLoadout.length ? genusLoadout : undefined,
    cipherLoadout: cipherLoadout.length ? cipherLoadout : undefined,
    notes,
  };
  return { name, sheet };
}

export interface LegacyStoredChar {
  /** localStorage key holding the raw data (for display/debug). */
  key: string;
  name: string;
  data: LegacyData;
}

/** Characters the OLD sheet left in localStorage (same origin as this app):
 *  the roster (`wte-chardata-<id>`) plus the pre-roster single-sheet autosave. */
export function scanLegacyStorage(store: Pick<Storage, "length" | "key" | "getItem">): LegacyStoredChar[] {
  const out: LegacyStoredChar[] = [];
  const seen = new Set<string>();
  const tryAdd = (key: string) => {
    if (seen.has(key)) return;
    seen.add(key);
    try {
      const data = JSON.parse(store.getItem(key) || "null") as LegacyData | null;
      if (!data || typeof data !== "object") return;
      const name = typeof data["f-name"] === "string" && (data["f-name"] as string).trim() ? (data["f-name"] as string).trim() : "Unnamed";
      out.push({ key, name, data });
    } catch {
      /* not JSON — skip */
    }
  };
  for (let i = 0; i < store.length; i++) {
    const k = store.key(i);
    if (k && k.startsWith("wte-chardata-")) tryAdd(k);
  }
  // the pre-roster autosave — the roster migration usually copied it into a
  // wte-chardata-* row, so skip it when a same-named character already showed up
  const rosterNames = new Set(out.map((c) => c.name));
  tryAdd("wte-sheet-v6");
  return out.filter((c) => c.key !== "wte-sheet-v6" || !rosterNames.has(c.name));
}
