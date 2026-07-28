// Persistence for layered rules.
//
// The table existed from the Phase 2 schema but had no way in or out, so the
// provenance engine had nothing real to resolve. This connects it: CRUD, export,
// and the diagnostics count.
//
// Two things it deliberately does NOT do:
//
//  - It does not invent an owner. A layer whose scope is owned (pack, campaign,
//    character, session) must say whose it is, because layersFor treats an
//    unowned one as belonging to nobody. Writing one without an owner would
//    create a rule that silently never applies.
//  - It does not renumber `order`. Same-scope sequencing is the author's decision;
//    a repository quietly reordering rows is exactly how database order ends up
//    deciding mechanics.
import { getDb, sqlAvailable } from "./db";
import { ID_SCOPES, type IdScope } from "../game/codexId";
import type { LayerOp, RuleLayer } from "../game/ruleLayers";

interface Row {
  id: string;
  campaign_id: string | null;
  target_id: string;
  layer_scope: string;
  owner: string | null;
  op: string;
  value: string;
  note: string | null;
  enabled: number;
  order_index: number | null;
  updated_at: number;
}

const OPS: LayerOp[] = ["set", "add", "multiply", "min", "max"];

let tablePresent: boolean | null = null;

async function haveTable(): Promise<boolean> {
  if (tablePresent !== null) return tablePresent;
  if (!sqlAvailable()) return false;
  try {
    const db = await getDb();
    const rows = await db.select<{ name: string }[]>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'rule_layers'"
    );
    tablePresent = rows.length > 0;
  } catch {
    return false; // transient; do not cache a failure as "absent"
  }
  return tablePresent;
}

export function __resetRuleLayerCache(): void {
  tablePresent = null;
}

/** Coerce a stored row. A row with an unrecognised scope or op is DROPPED rather
 *  than guessed at — a rule nobody can interpret must not quietly become an `add`. */
export function rowToLayer(r: Row): RuleLayer | null {
  const scope = r.layer_scope as IdScope;
  if (!ID_SCOPES.includes(scope)) return null;
  const op = r.op as LayerOp;
  if (!OPS.includes(op)) return null;
  const value = Number(r.value);
  if (!Number.isFinite(value)) return null;
  return {
    id: r.id,
    targetId: r.target_id,
    scope,
    owner: r.owner ?? undefined,
    op,
    value,
    note: r.note ?? undefined,
    enabled: r.enabled !== 0,
    order: r.order_index ?? undefined,
  };
}

export class OwnerlessLayerError extends Error {
  constructor(scope: IdScope) {
    super(
      `A ${scope}-scoped rule layer needs an owner id. Without one it belongs to nobody and would never apply.`
    );
    this.name = "OwnerlessLayerError";
  }
}

function assertOwner(l: RuleLayer): void {
  if (l.scope !== "wte" && !l.owner) throw new OwnerlessLayerError(l.scope);
}

/** Every layer for a campaign, plus the official (unowned) ones. */
export async function listRuleLayers(campaignId?: string | null): Promise<RuleLayer[]> {
  if (!(await haveTable())) return [];
  const db = await getDb();
  const rows = campaignId
    ? await db.select<Row[]>(
        "SELECT * FROM rule_layers WHERE campaign_id = $1 OR campaign_id IS NULL ORDER BY target_id, order_index, updated_at",
        [campaignId]
      )
    : await db.select<Row[]>("SELECT * FROM rule_layers ORDER BY target_id, order_index, updated_at");
  return rows.map(rowToLayer).filter((l): l is RuleLayer => l !== null);
}

/** Layers affecting one concept. */
export async function layersForTarget(targetId: string, campaignId?: string | null): Promise<RuleLayer[]> {
  return (await listRuleLayers(campaignId)).filter((l) => l.targetId === targetId);
}

export async function saveRuleLayer(l: RuleLayer, campaignId?: string | null): Promise<void> {
  if (!(await haveTable())) return;
  assertOwner(l);
  const db = await getDb();
  await db.execute(
    `INSERT OR REPLACE INTO rule_layers
       (id, campaign_id, target_id, layer_scope, owner, op, value, note, enabled, order_index, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [
      l.id,
      campaignId ?? null,
      l.targetId,
      l.scope,
      l.owner ?? null,
      l.op,
      String(l.value),
      l.note ?? null,
      l.enabled === false ? 0 : 1,
      l.order ?? null,
      Date.now(),
    ]
  );
}

export async function deleteRuleLayer(id: string): Promise<void> {
  if (!(await haveTable())) return;
  const db = await getDb();
  await db.execute("DELETE FROM rule_layers WHERE id = $1", [id]);
}

/** Switch a layer off without losing it — a Curator retiring a house rule should
 *  be able to bring it back. */
export async function setRuleLayerEnabled(id: string, enabled: boolean): Promise<void> {
  if (!(await haveTable())) return;
  const db = await getDb();
  await db.execute("UPDATE rule_layers SET enabled = $1, updated_at = $2 WHERE id = $3", [
    enabled ? 1 : 0,
    Date.now(),
    id,
  ]);
}

export async function countRuleLayers(campaignId?: string | null): Promise<number> {
  if (!(await haveTable())) return 0;
  return (await listRuleLayers(campaignId)).length;
}

/** Whether layered rules can be stored yet — for the diagnostics screen. */
export async function ruleLayersReady(): Promise<boolean> {
  return haveTable();
}

export function newLayerId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return "rl-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
}
