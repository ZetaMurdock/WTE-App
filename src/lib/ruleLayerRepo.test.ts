// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RuleLayer } from "../game/ruleLayers";

let rows: Record<string, unknown>[] = [];
let tableExists = true;

const fakeDb = {
  select: async <T>(sql: string, args: unknown[] = []): Promise<T> => {
    if (/sqlite_master/.test(sql)) return (tableExists ? [{ name: "rule_layers" }] : []) as unknown as T;
    if (/campaign_id = \$1 OR campaign_id IS NULL/.test(sql)) {
      return rows.filter((r) => r.campaign_id === args[0] || r.campaign_id === null) as unknown as T;
    }
    return rows as unknown as T;
  },
  execute: async (sql: string, args: unknown[] = []) => {
    if (/^DELETE/i.test(sql)) {
      rows = rows.filter((r) => r.id !== args[0]);
      return { rowsAffected: 1, lastInsertId: 0 };
    }
    if (/^UPDATE/i.test(sql)) {
      const r = rows.find((x) => x.id === args[2]);
      if (r) r.enabled = args[0];
      return { rowsAffected: 1, lastInsertId: 0 };
    }
    const row = {
      id: args[0], campaign_id: args[1], target_id: args[2], layer_scope: args[3], owner: args[4],
      op: args[5], value: args[6], note: args[7], enabled: args[8], order_index: args[9], updated_at: args[10],
    };
    const i = rows.findIndex((x) => x.id === row.id);
    if (i >= 0) rows[i] = row; else rows.push(row);
    return { rowsAffected: 1, lastInsertId: 0 };
  },
};

vi.mock("./db", () => ({ getDb: async () => fakeDb, sqlAvailable: () => true }));

const {
  listRuleLayers, saveRuleLayer, deleteRuleLayer, setRuleLayerEnabled,
  countRuleLayers, ruleLayersReady, rowToLayer, OwnerlessLayerError, __resetRuleLayerCache,
} = await import("./ruleLayerRepo");

const layer = (over: Partial<RuleLayer> = {}): RuleLayer => ({
  id: "l1", targetId: "wte.stat.focus", scope: "campaign", owner: "c-ashen",
  op: "add", value: 4, ...over,
});

beforeEach(() => { rows = []; tableExists = true; __resetRuleLayerCache(); });

describe("rule layers round-trip", () => {
  it("saves and reads back every field", async () => {
    await saveRuleLayer(layer({ note: "Ashen Sun override", order: 2 }), "c-ashen");
    const [l] = await listRuleLayers("c-ashen");
    expect(l).toMatchObject({ id: "l1", targetId: "wte.stat.focus", scope: "campaign", op: "add", value: 4, note: "Ashen Sun override", order: 2, enabled: true });
  });

  it("counts them for diagnostics", async () => {
    await saveRuleLayer(layer(), "c-ashen");
    await saveRuleLayer(layer({ id: "l2" }), "c-ashen");
    expect(await countRuleLayers("c-ashen")).toBe(2);
  });

  it("disables without deleting, so a retired house rule can come back", async () => {
    await saveRuleLayer(layer(), "c-ashen");
    await setRuleLayerEnabled("l1", false);
    expect((await listRuleLayers("c-ashen"))[0].enabled).toBe(false);
    await setRuleLayerEnabled("l1", true);
    expect((await listRuleLayers("c-ashen"))[0].enabled).toBe(true);
  });

  it("deletes", async () => {
    await saveRuleLayer(layer(), "c-ashen");
    await deleteRuleLayer("l1");
    expect(await listRuleLayers("c-ashen")).toEqual([]);
  });
});

describe("it refuses to write a rule that could never apply", () => {
  it("rejects an owned scope with no owner", async () => {
    // layersFor treats an unowned owned-scope layer as belonging to nobody, so
    // storing one would create a rule that silently never fires.
    for (const scope of ["pack", "campaign", "character", "session"] as const) {
      await expect(saveRuleLayer(layer({ scope, owner: undefined }))).rejects.toBeInstanceOf(OwnerlessLayerError);
    }
  });

  it("allows an official layer with no owner", async () => {
    await expect(saveRuleLayer(layer({ scope: "wte", owner: undefined }))).resolves.toBeUndefined();
  });
});

describe("unreadable rows are dropped, never guessed at", () => {
  const base = { id: "x", campaign_id: null, target_id: "t", owner: null, note: null, enabled: 1, order_index: null, updated_at: 0 };

  it("drops an unrecognised scope rather than defaulting it", () => {
    expect(rowToLayer({ ...base, layer_scope: "nonsense", op: "add", value: "1" } as never)).toBeNull();
  });

  it("drops an unrecognised op — a rule nobody can interpret must not become an add", () => {
    expect(rowToLayer({ ...base, layer_scope: "wte", op: "frobnicate", value: "1" } as never)).toBeNull();
  });

  it("drops a non-numeric value", () => {
    expect(rowToLayer({ ...base, layer_scope: "wte", op: "add", value: "abc" } as never)).toBeNull();
  });

  it("keeps a well-formed row", () => {
    expect(rowToLayer({ ...base, layer_scope: "wte", op: "add", value: "3" } as never)).toMatchObject({ op: "add", value: 3 });
  });
});

describe("without the table it ships inert", () => {
  it("reports not ready and no-ops rather than throwing", async () => {
    tableExists = false;
    __resetRuleLayerCache();
    expect(await ruleLayersReady()).toBe(false);
    expect(await listRuleLayers("c1")).toEqual([]);
    expect(await countRuleLayers("c1")).toBe(0);
    await expect(saveRuleLayer(layer(), "c1")).resolves.toBeUndefined();
  });
});
