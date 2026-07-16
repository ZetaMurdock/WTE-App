// Effect-text reader — ported from the legacy VTT (public/vtt.html `parseEffectMeta`).
// Reads a free-text ability description into structured targeting metadata so the
// VTT can auto-SUGGEST an area-of-effect template (which the player then edits on
// the fly). Kept faithful to the legacy regexes so behaviour matches the old tool.

export type AoeUnit = "cells" | "ft" | "m";
export type AoePattern = "circle" | "cone" | "line" | "ring" | "cross" | "wall";

export interface EffectValue {
  type: "damage" | "heal";
  expr?: string;
  amount?: number;
}

export interface EffectMeta {
  /** Number of targets, "all", or null when unspecified. */
  targets: number | "all" | null;
  /** How far it reaches from the caster. */
  range: { value: number; unit: AoeUnit } | null;
  /** Declared area ("15 ft radius", "cone"), size 0 when only a shape word appears. */
  area: { shape: string; size: number; unit: AoeUnit } | null;
  /** Richer hitbox shape read from the wording (wins over `area.shape`). */
  pattern: AoePattern | null;
  /** Lingering duration in rounds. */
  duration: number | null;
  /** Does the effect follow the caster ("self") or land on a target? */
  attach: "self" | "target" | null;
  /** Damage / heal dice or flat amounts found in the text. */
  values: EffectValue[];
}

export function normUnit(u: string | undefined): AoeUnit {
  const s = (u || "").toLowerCase();
  if (/^m|met/.test(s)) return "m";
  if (/^f/.test(s)) return "ft";
  return "cells";
}

export function parseEffectMeta(text: string | null | undefined): EffectMeta {
  const meta: EffectMeta = { targets: null, range: null, area: null, values: [], pattern: null, duration: null, attach: null };
  if (!text) return meta;
  const t = " " + text + " ";

  // TARGETS
  if (/\b(all|each|every)\s+(enem|target|creature|all(y|ies)|individual|foe|hostile)/i.test(t)) {
    meta.targets = "all";
  } else {
    const words: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 };
    const mt = t.match(/\b(?:up to|targets?|hits?|strikes?|affects?)\s*(\d+)/i) || t.match(/\b(\d+)\s+(?:targets?|creatures?|enemies|individuals?|foes?|allies|figures?)\b/i);
    if (mt) meta.targets = parseInt(mt[1], 10);
    else {
      const mw = t.match(/\b(one|two|three|four|five|six)\s+(?:targets?|creatures?|enemies|individuals?|foes?|allies)\b/i);
      if (mw) meta.targets = words[mw[1].toLowerCase()];
      else if (/\bsingle\s+target\b/i.test(t)) meta.targets = 1;
    }
  }

  // RANGE
  const mr = t.match(/\b(?:range|within|reach|up to|out to)\s*(\d+)\s*(cells?|squares?|tiles?|m\b|meters?|metres?|ft\b|feet|foot)/i);
  if (mr) meta.range = { value: parseInt(mr[1], 10), unit: normUnit(mr[2]) };

  // AREA
  const ma =
    t.match(/(\d+)\s*[- ]?(cells?|squares?|tiles?|m\b|meters?|metres?|ft\b|feet|foot)?\s*(radius|cone|line|burst|blast|sphere|aoe|cube)/i) ||
    t.match(/\b(radius|cone|line|burst|blast|sphere|aoe|cube)\b/i);
  if (ma) {
    if (ma.length === 4) meta.area = { shape: ma[3].toLowerCase(), size: parseInt(ma[1], 10) || 0, unit: normUnit(ma[2] || "cells") };
    else meta.area = { shape: ma[1].toLowerCase(), size: 0, unit: "cells" };
  }

  // DURATION
  const md = t.match(/\b(?:for|lasts?|over|during)\s+(\d+)\s*(?:rounds?|turns?)/i) || t.match(/\b(\d+)[- ]?(?:round|turn)s?\b/i);
  if (md) meta.duration = parseInt(md[1], 10);

  // ATTACH
  if (/\b(on yourself|on self|around you|self-?buff|you gain|grants you|surround[a-z]* you|centered on you|follows you|\baura\b)\b/i.test(t)) meta.attach = "self";
  else if (/\b(on (?:the|a|each|your) target|marks? the target|attached to the target|follows (?:the )?target|sticks to)\b/i.test(t)) meta.attach = "target";

  // HITBOX PATTERN
  let pat: AoePattern | null = null;
  if (/\b(ring|annulus|halo)\b/i.test(t)) pat = "ring";
  else if (/\b(cross|plus[- ]?shaped|cardinal)\b/i.test(t)) pat = "cross";
  else if (/\b(wall|barrier)\b/i.test(t)) pat = "wall";
  else if (/\b(cone|spray|fan)\b/i.test(t)) pat = "cone";
  else if (/\b(beam|ray|lance)\b/i.test(t) || /\bline\b/i.test(t)) pat = "line";
  else if (/\b(nova|burst|blast|explos|sphere)\b/i.test(t)) pat = "circle";
  if (pat) meta.pattern = pat;

  // VALUES (dice + flat heal)
  const seen = new Set<string>();
  const dre = /\b(\d*)d(\d+)([+-]\d+)?\b/gi;
  let m: RegExpExecArray | null;
  while ((m = dre.exec(text))) {
    const expr = (m[1] || "1") + "d" + m[2] + (m[3] || "");
    if (seen.has(expr)) continue;
    seen.add(expr);
    const ctx = text.slice(Math.max(0, m.index - 14), m.index).toLowerCase();
    meta.values.push({ type: /heal|restore|regen|mend|repair/.test(ctx) ? "heal" : "damage", expr });
  }
  const mh = text.match(/\bheal(?:s|ing)?\s*(?:for\s*)?(\d+)\b(?!\s*d)/i);
  if (mh) meta.values.push({ type: "heal", amount: parseInt(mh[1], 10) });

  return meta;
}

/** Convert a range/area size + unit into world-space pixels using the grid. */
export function metaToPixels(value: number, unit: AoeUnit, gridSize: number): number {
  if (!value) return 0;
  if (unit === "m") return (value / 1.5) * gridSize;
  if (unit === "ft") return (value / 5) * gridSize;
  return value * gridSize; // cells
}

/** Does this ability imply an area template worth prompting the player to place? */
export function hasAoe(meta: EffectMeta): boolean {
  return !!(meta.pattern || meta.area);
}

/** The VTT effect kind (circle | cone | zone) best matching the parsed meta, plus
 *  a suggested radius in CELLS. Line/ring/cross fall back to the nearest built-in
 *  shape until the engine grows those primitives. */
export function suggestedTemplate(meta: EffectMeta): { kind: "circle" | "cone" | "zone"; cells: number } {
  const pat = meta.pattern;
  const kind: "circle" | "cone" | "zone" = pat === "cone" ? "cone" : pat === "line" || pat === "wall" ? "zone" : "circle";
  const raw = meta.area?.size || 0;
  const unit = meta.area?.unit || "cells";
  const cells = raw ? (unit === "ft" ? Math.max(1, Math.round(raw / 5)) : unit === "m" ? Math.max(1, Math.round(raw / 1.5)) : raw) : 2;
  return { kind, cells };
}
