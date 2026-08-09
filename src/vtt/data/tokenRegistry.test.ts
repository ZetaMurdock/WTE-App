import { describe, expect, it } from "vitest";
import { defaultSceneData, type VttScene, type VttToken } from "../types/scene";
import {
  TOKEN_REGISTRY_KEY,
  customizeCanonicalCharacterToken,
  emptyTokenRegistry,
  ensureCanonicalCharacterToken,
  findNearestAvailableTokenPosition,
  loadTokenRegistry,
  migrateLegacyCharacterTokens,
  remapTokenRegistryForCampaignCopy,
  saveTokenRegistry,
  tokenProfileId,
  transferCanonicalCharacterToken,
  type TokenRegistryState,
  type TokenRegistryStorage,
} from "./tokenRegistry";

const campaignId = "campaign-1";

function token(id: string, characterId?: string, patch: Partial<VttToken> = {}): VttToken {
  return {
    id,
    name: id,
    x: 50,
    y: 50,
    size: 1,
    color: "#123456",
    visible: true,
    ...(characterId ? { characterId, actorKind: "character" as const } : {}),
    ...patch,
  };
}

function scene(id: string, tokens: VttToken[], patch: Partial<VttScene> = {}): VttScene {
  return {
    id,
    campaignId,
    name: id,
    active: false,
    data: { ...defaultSceneData(), grid: { ...defaultSceneData().grid, size: 100, cols: 4, rows: 4 }, tokens },
    createdAt: 1,
    updatedAt: 1,
    ...patch,
  };
}

describe("legacy character-token migration", () => {
  it("keeps one deterministic active presence, recovers custom art, and archives every removed copy", () => {
    const old = token("old-token", "char-a", {
      x: 150,
      img: "data:image/png;base64,old-custom-art",
      hp: 99,
      statuses: ["old"],
    });
    const live = token("live-token", "char-a", {
      x: 250,
      img: null,
      hp: 3,
      hpMax: 20,
      statuses: ["bleeding"],
      owner: "player-principal",
    });
    const unlinked = token("crate", undefined, { prop: true });
    const suspicious = token("portrait-prop", "char-a", { prop: true, img: "prop.png" });
    const input = [
      scene("old-scene", [old, unlinked], { updatedAt: 20 }),
      scene("active-scene", [live, suspicious], { active: true, updatedAt: 10 }),
    ];

    const result = migrateLegacyCharacterTokens(campaignId, input, undefined, 1000);

    expect(result.state.profiles["char-a"]).toMatchObject({
      id: tokenProfileId("char-a"),
      controllerId: "player-principal",
      appearance: { img: "data:image/png;base64,old-custom-art" },
    });
    expect(result.state.presences["char-a"]).toMatchObject({ tokenId: "live-token", sceneId: "active-scene", revision: 0 });
    expect(result.scenes[0].data.tokens.map((t) => t.id)).toEqual(["crate"]);
    expect(result.scenes[1].data.tokens.map((t) => t.id)).toEqual(["live-token", "portrait-prop"]);
    expect(result.scenes[1].data.tokens[0]).toMatchObject({
      id: "live-token",
      img: "data:image/png;base64,old-custom-art",
      hp: 3,
      hpMax: 20,
      statuses: ["bleeding"],
    });
    expect(result.state.retired).toHaveLength(1);
    expect(result.state.retired[0]).toMatchObject({ sceneId: "old-scene", token: { id: "old-token", hp: 99 } });
    expect(result.report.skipped).toEqual([{ sceneId: "active-scene", tokenId: "portrait-prop", reason: "linked-prop" }]);

    // The caller can inspect/report before committing; input bytes stay untouched.
    expect(input[0].data.tokens.map((t) => t.id)).toEqual(["old-token", "crate"]);
    expect(input[1].data.tokens[0].img).toBeNull();
    expect(migrateLegacyCharacterTokens(campaignId, input, result.state, 2000).state.retired).toHaveLength(1);
  });

  it("keeps an existing registry presence stable and handles multiple characters in one scene without stale indexes", () => {
    const previous = emptyTokenRegistry(campaignId);
    previous.profiles.a = {
      id: tokenProfileId("a"),
      campaignId,
      sourceKind: "character",
      sourceId: "a",
      appearance: { name: "Saved A", color: "#aaa", size: 1, img: "saved.png" },
      controllerId: "durable-user",
      updatedAt: 1,
    };
    previous.presences.a = { profileId: tokenProfileId("a"), tokenId: "a-keep", sceneId: "room", revision: 7, updatedAt: 1 };
    previous.profiles.gone = {
      ...previous.profiles.a,
      id: tokenProfileId("gone"),
      sourceId: "gone",
      appearance: { ...previous.profiles.a.appearance, name: "Absent but customized" },
    };
    previous.presences.gone = { profileId: tokenProfileId("gone"), tokenId: "missing-token", sceneId: "missing-scene", revision: 3, updatedAt: 1 };
    const input = [
      scene("room", [token("a-drop", "a"), token("b-drop", "b"), token("a-keep", "a"), token("b-keep", "b")], {
        active: true,
      }),
    ];

    const result = migrateLegacyCharacterTokens(campaignId, input, previous, 50);
    expect(result.scenes[0].data.tokens.map((t) => t.id)).toEqual(["b-drop", "a-keep"]);
    expect(result.state.presences.a).toMatchObject({ tokenId: "a-keep", revision: 7 });
    expect(result.state.presences.gone).toBeUndefined();
    expect(result.state.profiles.gone.appearance.name).toBe("Absent but customized");
    expect(result.report.clearedStalePresences).toEqual(["gone"]);
    expect(result.state.profiles.a).toMatchObject({ controllerId: "durable-user", appearance: { name: "Saved A", img: "saved.png" } });
    expect(result.state.retired.map((r) => r.token.id).sort()).toEqual(["a-drop", "b-keep"]);
  });

  it("normalizes legacy ownerPeer onto the canonical owner field", () => {
    const result = migrateLegacyCharacterTokens(
      campaignId,
      [scene("room", [token("legacy", "hero", { ownerPeer: "player-install" })])],
      undefined,
      10
    );
    expect(result.scenes[0].data.tokens[0]).toMatchObject({ owner: "player-install" });
    expect(result.scenes[0].data.tokens[0].ownerPeer).toBeUndefined();
    expect(result.state.profiles.hero.controllerId).toBe("player-install");
  });
});

describe("canonical spawn and transfer", () => {
  it("focuses an existing same-scene token instead of making a duplicate", () => {
    const existing = token("hero-token", "hero", { x: 250, y: 250 });
    const scenes = [scene("room", [existing])];
    const result = ensureCanonicalCharacterToken(
      emptyTokenRegistry(campaignId),
      scenes,
      "room",
      token("new-token-that-must-not-land", "hero"),
      { x: 50, y: 50 },
      10
    );
    expect(result).toMatchObject({ ok: true, action: "focused", token: { id: "hero-token", x: 250, y: 250 } });
    if (result.ok) {
      expect(result.scenes[0].data.tokens).toHaveLength(1);
      expect(result.state.presences.hero).toMatchObject({ tokenId: "hero-token", sceneId: "room", revision: 0 });
    }
  });

  it("transfers the same full token and finds the nearest legal destination", () => {
    const hero = token("hero-token", "hero", {
      x: 50,
      y: 50,
      img: "hero.png",
      hp: 4,
      hpMax: 17,
      statuses: ["marked"],
      owner: "hero-user",
      meta: { stats: { control: 6 } },
    });
    const blocker = token("blocker", undefined, { x: 50, y: 50 });
    const migrated = migrateLegacyCharacterTokens(campaignId, [scene("source", [hero]), scene("target", [blocker])], undefined, 10);
    const result = transferCanonicalCharacterToken(migrated.state, migrated.scenes, "hero", "target", { x: 50, y: 50 }, 20);

    expect(result).toMatchObject({
      ok: true,
      action: "transferred",
      token: { id: "hero-token", x: 150, y: 50, img: "hero.png", hp: 4, hpMax: 17, statuses: ["marked"], owner: "hero-user" },
    });
    if (!result.ok) throw new Error(result.reason);
    expect(result.scenes[0].data.tokens).toHaveLength(0);
    expect(result.scenes[1].data.tokens.map((t) => t.id)).toEqual(["blocker", "hero-token"]);
    expect(result.state.presences.hero).toMatchObject({ sceneId: "target", tokenId: "hero-token", revision: 1 });
  });

  it("refuses an ambiguous legacy duplicate without mutating either scene", () => {
    const scenes = [scene("a", [token("one", "hero")]), scene("b", [token("two", "hero")])];
    const result = transferCanonicalCharacterToken(emptyTokenRegistry(campaignId), scenes, "hero", "b", { x: 50, y: 50 });
    expect(result).toMatchObject({ ok: false, reason: "ambiguous-presence" });
    expect(scenes[0].data.tokens[0].id).toBe("one");
    expect(scenes[1].data.tokens[0].id).toBe("two");
  });

  it("updates profile customisation and the active token together", () => {
    const migrated = migrateLegacyCharacterTokens(campaignId, [scene("room", [token("hero-token", "hero")])], undefined, 1);
    const result = customizeCanonicalCharacterToken(migrated.state, migrated.scenes, "hero", { img: "new.png", color: "#fedcba", size: 2 }, 2);
    expect(result?.state.profiles.hero.appearance).toMatchObject({ img: "new.png", color: "#fedcba", size: 2 });
    expect(result?.scenes[0].data.tokens[0]).toMatchObject({ img: "new.png", color: "#fedcba", size: 2 });
    expect(migrated.scenes[0].data.tokens[0].img).toBeUndefined();
  });

  it("returns null when no token footprint fits", () => {
    const full = scene(
      "full",
      [
        token("a", undefined, { x: 50, y: 50 }),
        token("b", undefined, { x: 150, y: 50 }),
        token("c", undefined, { x: 50, y: 150 }),
        token("d", undefined, { x: 150, y: 150 }),
      ],
      { data: { ...defaultSceneData(), grid: { ...defaultSceneData().grid, size: 100, cols: 2, rows: 2 }, tokens: [] } }
    );
    // The patch above replaces data, so restore the four blockers explicitly.
    full.data.tokens = [
      token("a", undefined, { x: 50, y: 50 }),
      token("b", undefined, { x: 150, y: 50 }),
      token("c", undefined, { x: 50, y: 150 }),
      token("d", undefined, { x: 150, y: 150 }),
    ];
    expect(findNearestAvailableTokenPosition(full, { id: "new", size: 1 }, { x: 50, y: 50 })).toBeNull();
  });
});

describe("registry persistence and package-copy remapping", () => {
  it("distinguishes damaged persisted state from a missing registry", async () => {
    let raw: unknown | null = { version: 1, campaignId, profiles: "bad", presences: {}, retired: [] };
    const storage: TokenRegistryStorage = {
      load: async () => raw,
      save: async (_campaignId, state) => {
        raw = state;
      },
    };
    expect(await loadTokenRegistry(campaignId, storage)).toMatchObject({ status: "corrupt", state: { campaignId } });
    const valid = emptyTokenRegistry(campaignId);
    await saveTokenRegistry(valid, storage);
    expect(await loadTokenRegistry(campaignId, storage)).toEqual({ status: "loaded", state: valid });
    raw = null;
    expect(await loadTokenRegistry(campaignId, storage)).toMatchObject({ status: "missing" });
    expect(TOKEN_REGISTRY_KEY).toBe("vtt-token-registry-v1");
  });

  it("remaps campaign, character, scene and archived blob references while preserving live token ids", () => {
    const migrated = migrateLegacyCharacterTokens(
      campaignId,
      [scene("scene-old", [token("live-token", "char-old", { img: "wte-blob:blob-old" })])],
      undefined,
      5
    );
    const state: TokenRegistryState = {
      ...migrated.state,
      retired: [
        {
          profileId: tokenProfileId("char-old"),
          sourceId: "char-old",
          sceneId: "scene-old",
          originalIndex: 1,
          token: token("retired-token", "char-old", { img: "wte-blob:blob-old" }),
          reason: "legacy-duplicate",
          retiredAt: 5,
        },
      ],
    };
    const remap = (id: string) => `${id}-copy`;
    const copied = remapTokenRegistryForCampaignCopy(state, campaignId, "campaign-copy", remap) as TokenRegistryState;

    expect(copied.campaignId).toBe("campaign-copy");
    expect(copied.profiles["char-old-copy"]).toMatchObject({
      id: tokenProfileId("char-old-copy"),
      sourceId: "char-old-copy",
      campaignId: "campaign-copy",
    });
    expect(copied.presences["char-old-copy"]).toMatchObject({ tokenId: "live-token", sceneId: "scene-old-copy" });
    expect(copied.retired[0]).toMatchObject({
      sourceId: "char-old-copy",
      sceneId: "scene-old-copy",
      token: { id: "retired-token", characterId: "char-old-copy", img: "wte-blob:blob-old-copy" },
    });
  });
});
