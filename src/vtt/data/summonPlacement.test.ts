import { describe, expect, it } from "vitest";
import cipherData from "../../game/data/ciphers.json";
import genusData from "../../game/data/genus.json";
import { parseAbilityEffects } from "../../game/abilityEffects";
import { newScene, type VttScene, type VttToken } from "../types/scene";
import { canOccupy } from "./occupancy";
import { MAX_VTT_SNAPSHOT_CHARS, vttSnapshotFits } from "../sync/wireBudget";
import { migrateLegacyCharacterTokens } from "./tokenRegistry";
import { resolveSummon, type CodexSummonEntry } from "./summonRoster";
import {
  MAX_SUMMON_BATCH,
  declaredSummons,
  packSummonCells,
  pageSummons,
  resolvePageSummons,
  dismissibleSummonBodies,
  duplicateSummonIds,
  summonBatchTokens,
  summonBodySize,
  summonPlan,
} from "./summonPlacement";

// NOT what ships. Eighteen shipped abilities DO carry a declared block, but no
// block anywhere in the corpus declares a `Summon:` — `Minion Conjuration`
// (src/rules/Stygians_Incepts.md:127) states its swarm in prose: "Once per
// scene, conjure 100 Lesser Stygian Minions from nearby shadows. Minions
// persist until dismissed, slain, or separated from you for more than 2 minutes
// of Passive Time." This fixture is what a table would write if it forked that
// incept into the declared grammar, and it is labelled a fork so nobody reads a
// test constant as a statement about the shipped setting.
const FORKED_MINION_CONJURATION = `
## Actions
- Cost: 40 SS
- Summon: 100 Lesser Stygian
- Ruling: minions persist until dismissed, slain, or separated for 2 minutes of Passive Time — Curator adjudicates
`;

function steps(block: string) {
  const parsed = parseAbilityEffects(block);
  expect(parsed.errors).toEqual([]);
  return parsed.steps;
}

const MINION: CodexSummonEntry = { name: "Lesser Stygian", hp: 14, cls: 1, size: 1, dr: 1 };

function sceneWith(tokens: VttToken[] = []): VttScene {
  const scene = newScene("campaign-1", "Shadowed Hall");
  scene.data.tokens = tokens;
  return scene;
}

function token(id: string, x: number, y: number, extra: Partial<VttToken> = {}): VttToken {
  return { id, name: id, x, y, size: 1, color: "#888", visible: true, ...extra };
}

const ORIGIN = { sourceAbilityId: "incept:minion-conjuration", sourceAbilityName: "Minion Conjuration" };

function ids(n: number, prefix = "tk"): string[] {
  return Array.from({ length: n }, (_, i) => `${prefix}-${i}`);
}

describe("declaredSummons", () => {
  it("reads the count and the creature the page named", () => {
    const found = declaredSummons(steps(FORKED_MINION_CONJURATION));
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ name: "Lesser Stygian", count: 100, on: "always" });
  });

  it("keeps a summon the caster makes, unlike a consequence aimed at a target", () => {
    // `consequencesFromSteps` drops every `who: "self"` step because the card
    // speaks for the target. A summon's DEFAULT selector is self — the caster
    // calls it — so filtering by `who` here would drop every summon there is.
    const [step] = steps("## Actions\n- Summon: Xryte");
    expect(step.who).toBe("self");
    expect(declaredSummons([step])).toHaveLength(1);
  });

  it("drops the branches no phase of the engine executes", () => {
    // Same line `consequencesFromSteps` and `recurringTicks` hold: min and tie
    // arm nothing anywhere, and treating them as failures would put bodies on
    // the map the page never promised.
    const found = declaredSummons(steps("## Actions\n- Min: Summon: 3 Xryte\n- Fail: Summon: 2 Xryte"));
    expect(found.map((s) => s.on)).toEqual(["fail"]);
  });

  it("does not place a threshold's bodies when the ability that moves the track resolves", () => {
    // `consequencesFromSteps` skips `at-threshold` at the top level because "At
    // 8: Damage: 1d100" must not land on the first point of Blight. A summon is
    // the same shape and shipped without the guard: this block put all hundred
    // bodies on the map the instant the ability was used. Nothing carries a
    // summon down to a crossing, so the honest count here is zero.
    const found = declaredSummons(
      steps("## Actions\n- Counter: Blight +1, cap 8\n- At 8: Summon: 100 Lesser Stygian")
    );
    expect(found).toEqual([]);
  });

  it("still places a per-round summon's first wave, which the page did promise", () => {
    // `Each round:` is a shortfall, not a lie — `recurringTicks` carries no
    // summon, so the repetition is the Curator's to repeat. Round one is a round
    // the page promised, and dropping it would place nothing at all.
    expect(declaredSummons(steps("## Actions\n- Each round: Summon: 1 Wisp"))).toHaveLength(1);
  });

  it("declares nothing for any ability the app actually ships", () => {
    // The corpus is NOT blockless — eighteen abilities carry a declared block
    // since P1, and a test asserting otherwise over a made-up prose string would
    // have proved nothing about them. This reads the real data: whatever those
    // blocks say, not one calls a creature, so every shipped ability reaches the
    // panel with no summon prompt attached.
    const blocks: string[] = [];
    for (const domain of Object.values(genusData as unknown as Record<string, { abilities: { actions?: string | null }[] }>)) {
      for (const ability of domain.abilities) if (ability.actions) blocks.push(ability.actions);
    }
    for (const paradigm of Object.values(cipherData as unknown as Record<string, { actions?: string | null }[]>)) {
      for (const ability of paradigm) if (ability.actions) blocks.push(ability.actions);
    }
    expect(blocks.length).toBeGreaterThan(10);
    expect(blocks.filter((block) => pageSummons(block).length > 0)).toEqual([]);
    expect(pageSummons(null)).toEqual([]);
    expect(pageSummons("The Vibra becomes locally real and acts on the concept it represents.")).toEqual([]);
  });
});

describe("packSummonCells", () => {
  it("agrees with the engine's own occupancy rule for every body it places", () => {
    // The packer is a fast path around `nearestFreeCell`, and the ONLY thing
    // that makes a fast path safe is that it answers the same question. Every
    // position is re-checked against `canOccupy` with the bodies placed before
    // it, which is what the engine would have asked.
    const scene = sceneWith([token("blocker", 5 * 70 + 35, 5 * 70 + 35)]);
    const points = packSummonCells(scene.data.grid, scene.data.tokens, { x: 5 * 70 + 35, y: 5 * 70 + 35 }, 1, 100);
    expect(points).toHaveLength(100);
    const placed: VttToken[] = [];
    points.forEach((point, i) => {
      const body = token(`m-${i}`, point.x, point.y);
      const check = canOccupy(scene.data.grid, [...scene.data.tokens, ...placed], body);
      expect(check.ok, `body ${i} at ${point.x},${point.y}`).toBe(true);
      placed.push(body);
    });
  });

  it("never puts two bodies in one square", () => {
    const scene = sceneWith();
    const points = packSummonCells(scene.data.grid, scene.data.tokens, { x: 35, y: 35 }, 1, 100);
    expect(new Set(points.map((p) => `${p.x},${p.y}`)).size).toBe(100);
  });

  it("respects a larger body's whole footprint", () => {
    const scene = sceneWith();
    const points = packSummonCells(scene.data.grid, scene.data.tokens, { x: 10 * 70, y: 10 * 70 }, 2, 12);
    const placed: VttToken[] = [];
    points.forEach((point, i) => {
      const body = token(`big-${i}`, point.x, point.y, { size: 2 });
      expect(canOccupy(scene.data.grid, placed, body).ok).toBe(true);
      placed.push(body);
    });
  });

  it("returns what the map can hold rather than pretending", () => {
    // A 3x3 map has nine squares and one is already taken. Eight is the true
    // answer; reporting ten would be the packer lying about the map.
    const scene = sceneWith([token("blocker", 35, 35)]);
    scene.data.grid = { ...scene.data.grid, cols: 3, rows: 3 };
    expect(packSummonCells(scene.data.grid, scene.data.tokens, { x: 35, y: 35 }, 1, 10)).toHaveLength(8);
  });

  it("packs through scenery, which reserves nothing", () => {
    // Props are not bodies. `tokenBlocksMovement` already says so and the packer
    // must not invent a second, stricter answer.
    const scene = sceneWith([token("crate", 35, 35, { prop: true })]);
    scene.data.grid = { ...scene.data.grid, cols: 2, rows: 1 };
    expect(packSummonCells(scene.data.grid, scene.data.tokens, { x: 35, y: 35 }, 1, 2)).toHaveLength(2);
  });
});

describe("summonPlan", () => {
  const base = (scene: VttScene, count = 100) => ({
    summon: { id: "sum-0", name: "Lesser Stygian", count, on: "always" as const },
    resolution: resolveSummon("Lesser Stygian", { codex: [MINION] }),
    scene,
    anchor: { x: 10 * 70 + 35, y: 10 * 70 + 35 },
    origin: ORIGIN,
    batchId: "sm-1",
    tokenIds: ids(count),
  });

  it("puts a hundred bodies on the map with the statline the page's name resolved to", () => {
    const plan = summonPlan(base(sceneWith()));
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.placed).toBe(100);
    expect(plan.shortfall).toBe(0);
    expect(plan.unstatted).toBe(false);
    expect(plan.tokens.every((t) => t.hp === 14 && t.hpMax === 14)).toBe(true);
    expect(plan.tokens.every((t) => t.actorKind === "creature")).toBe(true);
  });

  it("mutates nothing — the scene it was handed is untouched until the caller commits", () => {
    const scene = sceneWith([token("caster", 35, 35)]);
    const before = JSON.stringify(scene);
    summonPlan(base(scene));
    expect(JSON.stringify(scene)).toBe(before);
  });

  it("stamps every body with one batch, so dismissal is one act and not a hundred", () => {
    const plan = summonPlan(base(sceneWith()));
    if (!plan.ok) return;
    expect(new Set(plan.tokens.map((t) => t.meta?.summon?.batchId))).toEqual(new Set(["sm-1"]));
    expect(summonBatchTokens(plan.tokens, "sm-1")).toHaveLength(100);
    expect(summonBatchTokens(plan.tokens, "sm-nope")).toHaveLength(0);
  });

  it("keeps the page's word for the creature on the token", () => {
    // The incept conjures "Lesser Stygian Minions"; a bestiary page names the
    // singular. The statline is the page's, but the NAME on the map is the
    // ability's — that is the word the Curator is looking for after the roll.
    const singular: CodexSummonEntry = { ...MINION, name: "Lesser Stygian Minion" };
    const plan = summonPlan({
      ...base(sceneWith(), 3),
      summon: { id: "sum-0", name: "Lesser Stygian Minions", count: 3, on: "always" },
      resolution: resolveSummon("Lesser Stygian Minions", { codex: [singular] }),
      tokenIds: ids(3),
    });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.tokens.every((t) => t.name === "Lesser Stygian Minions")).toBe(true);
    expect(plan.tokens.every((t) => t.hp === 14)).toBe(true);
  });

  it("places an unstatted body as a named marker and NOTHING else", () => {
    // The Kirkndomou case. Its prose gives 75 HP; nothing resolved by name, so
    // the bodies arrive carrying no numbers at all. A default HP here — 1, 10,
    // or the 75 the prose states — would be a compiled rule no page could edit.
    const plan = summonPlan({
      ...base(sceneWith(), 1),
      summon: { id: "sum-0", name: "Kirkndomou", count: 1, on: "always" },
      resolution: resolveSummon("Kirkndomou", { codex: [MINION] }),
      tokenIds: ids(1),
    });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.unstatted).toBe(true);
    expect(plan.tokens[0].hp).toBeUndefined();
    expect(plan.tokens[0].hpMax).toBeUndefined();
    expect(plan.tokens[0].meta?.stats).toBeUndefined();
    expect(plan.tokens[0].name).toBe("Kirkndomou");
  });

  it("refuses a name two entries answer to rather than picking one", () => {
    const plan = summonPlan({
      ...base(sceneWith(), 2),
      resolution: resolveSummon("Lesser Stygian", { codex: [MINION, { ...MINION, hp: 900 }] }),
      tokenIds: ids(2),
    });
    expect(plan.ok).toBe(false);
    if (plan.ok) return;
    expect(plan.reason).toBe("ambiguous-statline");
  });

  it("reports a shortfall instead of quietly placing fewer than the page promised", () => {
    const scene = sceneWith();
    scene.data.grid = { ...scene.data.grid, cols: 5, rows: 5 };
    const plan = summonPlan({ ...base(scene), anchor: { x: 35, y: 35 } });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.placed).toBe(25);
    expect(plan.requested).toBe(100);
    expect(plan.shortfall).toBe(75);
  });

  it("refuses outright when there is nowhere at all to stand", () => {
    const scene = sceneWith([token("hog", 35, 35)]);
    scene.data.grid = { ...scene.data.grid, cols: 1, rows: 1 };
    const plan = summonPlan({ ...base(scene, 4), anchor: { x: 35, y: 35 }, tokenIds: ids(4) });
    expect(plan.ok).toBe(false);
    if (plan.ok) return;
    expect(plan.reason).toBe("no-room");
  });

  it("refuses a count past the cap and names the cap", () => {
    const plan = summonPlan({ ...base(sceneWith(), MAX_SUMMON_BATCH + 1), tokenIds: ids(1) });
    expect(plan.ok).toBe(false);
    if (plan.ok) return;
    expect(plan.reason).toBe("over-cap");
    expect(plan.detail).toContain(String(MAX_SUMMON_BATCH));
  });

  it("truncates to the ids it was given rather than minting a duplicate", () => {
    // Two tokens sharing an id is a scene `applyOp` silently refuses to grow and
    // a registry that can never be reconciled. Running short is recoverable.
    const plan = summonPlan({ ...base(sceneWith()), tokenIds: ids(4) });
    if (!plan.ok) return;
    expect(plan.placed).toBe(4);
    expect(new Set(plan.tokens.map((t) => t.id)).size).toBe(4);
  });
});

describe("a hundred bodies at once", () => {
  it("still fits the wire — the whole point of measuring the batch, not the token", () => {
    const scene = sceneWith();
    const plan = summonPlan({
      summon: { id: "sum-0", name: "Lesser Stygian", count: 100, on: "always" },
      resolution: resolveSummon("Lesser Stygian", { codex: [MINION] }),
      scene,
      anchor: { x: 700, y: 700 },
      origin: ORIGIN,
      batchId: "sm-1",
      tokenIds: ids(100),
    });
    if (!plan.ok) return;
    const after: VttScene = { ...scene, data: { ...scene.data, tokens: [...scene.data.tokens, ...plan.tokens] } };
    expect(vttSnapshotFits(after)).toBe(true);
  });

  it("still fits the wire at the batch cap", () => {
    // The cap is only a safe number if a scene carrying a full batch is
    // transportable at all — the same reason MAX_CONDITION_CLOCKS is measured.
    const scene = sceneWith();
    scene.data.grid = { ...scene.data.grid, cols: 40, rows: 40 };
    const plan = summonPlan({
      summon: { id: "sum-0", name: "Lesser Stygian", count: MAX_SUMMON_BATCH, on: "always" },
      resolution: resolveSummon("Lesser Stygian", { codex: [MINION] }),
      scene,
      anchor: { x: 20 * 70, y: 20 * 70 },
      origin: ORIGIN,
      batchId: "sm-1",
      tokenIds: ids(MAX_SUMMON_BATCH),
    });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.placed).toBe(MAX_SUMMON_BATCH);
    const after: VttScene = { ...scene, data: { ...scene.data, tokens: plan.tokens } };
    expect(vttSnapshotFits(after)).toBe(true);
  });

  it("refuses a batch that would not reach the players at all", () => {
    // The refusal the whole "measure the batch, not the token" design exists to
    // produce, and nothing was proving it fired: deleting the check left the
    // suite green. `creatureToTokenSpec` copies a creature's lore onto EVERY
    // body, so a well-written Codex page and a big enough count is all it takes
    // — and a scene past the cap is one no player can be sent, so the honest
    // answer is to place none rather than to strand the table on a map only the
    // Curator can see.
    // A map image already spends most of the budget; the bodies are what tips
    // it. Sized off the real cap so the test cannot go quietly true if the cap
    // moves, and kept to ONE large string — measuring a 500-body swarm of a
    // wordy creature would allocate the overflow several times over inside a
    // parallel worker.
    const wordy: CodexSummonEntry = { ...MINION, desc: "shadow".repeat(2_000) };
    const scene = sceneWith();
    scene.data.background = { ...scene.data.background, src: "d".repeat(MAX_VTT_SNAPSHOT_CHARS - 40_000) };
    const plan = summonPlan({
      summon: { id: "sum-0", name: "Lesser Stygian", count: 8, on: "always" },
      resolution: resolveSummon("Lesser Stygian", { codex: [wordy] }),
      scene,
      anchor: { x: 700, y: 700 },
      origin: ORIGIN,
      batchId: "sm-1",
      tokenIds: ids(8),
    });
    expect(plan.ok).toBe(false);
    if (plan.ok) return;
    expect(plan.reason).toBe("too-large-for-wire");
    expect(plan.detail).toContain("Lesser Stygian");
  });

  it("leaves the canonical token registry completely alone", () => {
    // `tokenRegistry` gives each linked CHARACTER exactly one live token. A
    // swarm is 100 bodies of one creature, and if they registered, the caster's
    // own presence would go "ambiguous" and every later transfer would fail.
    // They do not register, because a summon carries no characterId.
    const scene = sceneWith([token("caster", 35, 35, { characterId: "char-1", actorKind: "character" })]);
    const plan = summonPlan({
      summon: { id: "sum-0", name: "Lesser Stygian", count: 100, on: "always" },
      resolution: resolveSummon("Lesser Stygian", { codex: [MINION] }),
      scene,
      anchor: { x: 700, y: 700 },
      origin: ORIGIN,
      batchId: "sm-1",
      tokenIds: ids(100),
    });
    if (!plan.ok) return;
    const after: VttScene = { ...scene, data: { ...scene.data, tokens: [...scene.data.tokens, ...plan.tokens] } };
    const migration = migrateLegacyCharacterTokens("campaign-1", [after]);
    expect(Object.keys(migration.state.profiles)).toEqual(["char-1"]);
    expect(migration.report.deduplicated).toEqual([]);
    expect(migration.scenes[0].data.tokens).toHaveLength(101);
  });

  it("gives every body its own meta rather than a hundred aliases of one", () => {
    // One profile produced all hundred. Sharing its `stats` record between them
    // means an in-place edit anywhere rewrites the whole swarm at once.
    const plan = summonPlan({
      summon: { id: "sum-0", name: "Lesser Stygian", count: 100, on: "always" },
      resolution: resolveSummon("Lesser Stygian", { codex: [{ ...MINION, stats: { OFF: 4, DEF: 3 }, flags: ["Shadowborn"] }] }),
      scene: sceneWith(),
      anchor: { x: 700, y: 700 },
      origin: ORIGIN,
      batchId: "sm-1",
      tokenIds: ids(100),
    });
    if (!plan.ok) return;
    const first = plan.tokens[0].meta!;
    for (const other of plan.tokens.slice(1)) {
      expect(other.meta).not.toBe(first);
      expect(other.meta!.stats).not.toBe(first.stats);
      expect(other.meta!.flags).not.toBe(first.flags);
      expect(other.meta!.summon).not.toBe(first.summon);
    }
    expect(plan.tokens[99].meta!.stats).toEqual({ OFF: 4, DEF: 3 });
  });

  it("carries only wire-safe residue on every body", () => {
    // A token rides a scene snapshot to every peer. Anything that is not JSON
    // must not have come along in `meta.summon`.
    const plan = summonPlan({
      summon: { id: "sum-0", name: "Lesser Stygian", count: 3, on: "always" },
      resolution: resolveSummon("Lesser Stygian", { codex: [MINION] }),
      scene: sceneWith(),
      anchor: { x: 700, y: 700 },
      origin: { ...ORIGIN, casterCharacterId: "char-1", casterTokenId: "tk-caster", bornRound: 4 },
      batchId: "sm-1",
      tokenIds: ids(3),
    });
    if (!plan.ok) return;
    expect(JSON.parse(JSON.stringify(plan.tokens))).toEqual(plan.tokens);
  });
});

describe("summonBodySize", () => {
  it("gives the preview and the plan the same answer", () => {
    // The prompt tells the Curator the map has room for 63. If it measured
    // size-1 bodies while the plan placed size-2 ones, the number they
    // confirmed against was never real.
    const resolution = resolveSummon("Fracture", { codex: [{ name: "Fracture", hp: 60, size: 2 }] });
    expect(summonBodySize(resolution)).toBe(2);
    const plan = summonPlan({
      summon: { id: "sum-0", name: "Fracture", count: 6, on: "always" },
      resolution,
      scene: sceneWith(),
      anchor: { x: 700, y: 700 },
      origin: ORIGIN,
      batchId: "sm-1",
      tokenIds: ids(6),
    });
    if (!plan.ok) return;
    expect(plan.tokens.every((t) => t.size === summonBodySize(resolution))).toBe(true);
    expect(plan.placed).toBe(
      packSummonCells(sceneWith().data.grid, [], { x: 700, y: 700 }, summonBodySize(resolution), 6).length
    );
  });

  it("stands an unstatted body in one square rather than guessing at its bulk", () => {
    expect(summonBodySize(resolveSummon("Kirkndomou", {}))).toBe(1);
  });
});

describe("committing a batch", () => {
  it("names the collision that must drop the whole batch", () => {
    // `applyOp` silently refuses a `token.add` whose id already exists. A batch
    // with one collision would land 99 bodies while the Curator was told 100
    // arrived — a swarm nobody can recount. The engine's commit is all-or-
    // nothing on this answer.
    const standing = [token("tk-7", 0, 0)];
    const batch = [token("tk-1", 70, 0), token("tk-7", 140, 0)];
    expect(duplicateSummonIds(standing, batch)).toEqual(["tk-7"]);
  });

  it("catches a collision inside the batch itself, not only against the scene", () => {
    expect(duplicateSummonIds([], [token("tk-1", 0, 0), token("tk-1", 70, 0)])).toEqual(["tk-1"]);
  });

  it("passes a clean hundred", () => {
    const plan = summonPlan({
      summon: { id: "sum-0", name: "Lesser Stygian", count: 100, on: "always" },
      resolution: resolveSummon("Lesser Stygian", { codex: [MINION] }),
      scene: sceneWith([token("caster", 35, 35)]),
      anchor: { x: 700, y: 700 },
      origin: ORIGIN,
      batchId: "sm-1",
      tokenIds: ids(100),
    });
    if (!plan.ok) return;
    expect(duplicateSummonIds([token("caster", 35, 35)], plan.tokens)).toEqual([]);
  });
});

describe("dismissing a batch", () => {
  const origin = { batchId: "sm-1", name: "Lesser Stygian", sourceAbilityName: "Minion Conjuration" };
  const swarm = [
    token("a", 0, 0, { meta: { summon: origin } }),
    token("b", 70, 0, { meta: { summon: origin, } }),
    token("c", 140, 0, { meta: { summon: { ...origin, batchId: "sm-2" } } }),
    token("d", 210, 0),
  ];

  it("leaves a body the Curator handed to a player standing", () => {
    // `deleteSelected` refuses to remove a token assigned to a player, and a
    // batch handle that ignored the same rule would be a way to delete a
    // player's token by having summoned it. The refusal is reported, not
    // swallowed, so the caller can say which minions stayed.
    const owned = [...swarm, token("e", 280, 0, { owner: "peer-2", meta: { summon: origin } })];
    const split = dismissibleSummonBodies(owned, "sm-1", (t) => !t.owner);
    expect(split.going.map((t) => t.id)).toEqual(["a", "b"]);
    expect(split.refused.map((t) => t.id)).toEqual(["e"]);
  });

  it("touches nothing outside its own batch", () => {
    const split = dismissibleSummonBodies(swarm, "sm-1", () => true);
    expect(split.going.map((t) => t.id)).toEqual(["a", "b"]);
    expect(split.refused).toEqual([]);
  });
});

describe("what happens to the bodies afterwards", () => {
  it("keeps a swarm findable after its summoner is gone", () => {
    // Minion Conjuration: "Minions persist until dismissed, slain, or separated
    // from you for more than 2 minutes of Passive Time." Nothing in the engine
    // keys their removal on the caster, and this holds that line: identity is
    // the batch id alone, so losing the summoner does not make the swarm
    // unfindable — and therefore undismissable — even though its
    // `casterTokenId` now points at nobody.
    const origin = { batchId: "sm-1", name: "Lesser Stygian", sourceAbilityName: "Minion Conjuration", casterTokenId: "tk-caster" };
    const withCaster = [
      token("tk-caster", 0, 0, { characterId: "char-1" }),
      token("a", 70, 0, { meta: { summon: origin } }),
      token("b", 140, 0, { meta: { summon: origin } }),
    ];
    expect(summonBatchTokens(withCaster, "sm-1")).toHaveLength(2);
    const casterGone = withCaster.filter((t) => t.id !== "tk-caster");
    expect(summonBatchTokens(casterGone, "sm-1")).toHaveLength(2);
  });

  it("finds a body that has since wandered off", () => {
    // Dismissal that only found the ones still standing where they arrived
    // would leave the strays behind for the Curator to hunt one at a time.
    const origin = { batchId: "sm-1", name: "Lesser Stygian", sourceAbilityName: "Minion Conjuration" };
    const bodies = [token("a", 0, 0, { meta: { summon: origin } })];
    bodies[0] = { ...bodies[0], x: 39 * 70, y: 25 * 70 };
    expect(summonBatchTokens(bodies, "sm-1")).toHaveLength(1);
  });
});

describe("resolvePageSummons", () => {
  it("reads a page once and answers with both the declaration and its statline", () => {
    const rows = resolvePageSummons(FORKED_MINION_CONJURATION, { codex: [MINION] });
    expect(rows).toHaveLength(1);
    expect(rows[0].summon.count).toBe(100);
    expect(rows[0].resolution.status).toBe("resolved");
  });
});
