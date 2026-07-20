// Quick creatures: stat blocks the Curator types straight into the Actors
// panel mid-session — no Codex page needed. Stored per campaign so they're
// there next session too. The merge logic is pure (unit-tested); localStorage
// wrappers live at the bottom (works in browser AND Tauri).

export interface QuickCreature {
  id: string;
  name: string;
  hp: number;
  dr?: number;
  /** Token diameter in grid cells (1–6). */
  size?: number;
  /** One-line trait summary — feeds the VTT ability roll parser like Codex traits. */
  traits?: string;
  desc?: string;
  /** Raw combat stats (OFF/DEF/SPD/WIL/PHY/INT), shown read-only in the inspector. */
  stats?: Record<string, number>;
}

/** Upsert by id; renames/edits replace in place, new entries go on top. */
export function mergeQuick(list: QuickCreature[], qc: QuickCreature): QuickCreature[] {
  if (!qc.id || !qc.name.trim()) return list;
  const dr = Math.max(0, Math.round(qc.dr || 0));
  const cleaned: QuickCreature = {
    ...qc,
    name: qc.name.trim(),
    hp: Math.max(1, Math.round(qc.hp || 1)),
    dr: dr > 0 ? dr : undefined,
    size: Math.max(1, Math.min(6, Math.round(qc.size || 1))),
  };
  const exists = list.some((c) => c.id === qc.id);
  return exists ? list.map((c) => (c.id === qc.id ? cleaned : c)) : [cleaned, ...list];
}

export function withoutQuick(list: QuickCreature[], id: string): QuickCreature[] {
  return list.filter((c) => c.id !== id);
}

// ── localStorage wrappers ────────────────────────────────────────────────────

const key = (campaignId: string) => `wte-quick-creatures:${campaignId}`;

export function listQuickCreatures(campaignId: string): QuickCreature[] {
  try {
    const raw = localStorage.getItem(key(campaignId));
    const list = raw ? (JSON.parse(raw) as QuickCreature[]) : [];
    return Array.isArray(list) ? list.filter((c) => c && typeof c.id === "string" && typeof c.name === "string") : [];
  } catch {
    return [];
  }
}

function write(campaignId: string, list: QuickCreature[]): QuickCreature[] {
  try {
    localStorage.setItem(key(campaignId), JSON.stringify(list.slice(0, 200)));
  } catch {
    /* storage unavailable — the creature just isn't remembered */
  }
  return list;
}

export function saveQuickCreature(campaignId: string, qc: QuickCreature): QuickCreature[] {
  return write(campaignId, mergeQuick(listQuickCreatures(campaignId), qc));
}

export function deleteQuickCreature(campaignId: string, id: string): QuickCreature[] {
  return write(campaignId, withoutQuick(listQuickCreatures(campaignId), id));
}
