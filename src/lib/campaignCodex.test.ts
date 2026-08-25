// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { RuleLayer } from "../game/ruleLayers";
import {
  BACKGROUNDS,
  bakedCiphers,
  ciphersForParadigm,
  getGenusDomain,
  getParadigm,
  getSpecies,
  registerCodexGameData,
  usableCiphers,
} from "../game/wte";
import { codexCtx, usableGenusResolved } from "../game/resolvedGenus";
import { findBakedCodexPage } from "./bakedCodexPages";
import { customizePageForCampaign } from "./pageIdentity";
import { getWeapon, listCreatures, setCodexCatalog, setCodexRuntimeEntries } from "./codex";
import {
  activeRoomCodex,
  campaignCodexRevision,
  clearRoomCodex,
  installRoomCodex,
  markRoomCodexReady,
  parseCampaignCodexSnapshot,
  resolveCampaignCodexPages,
  roomCodexState,
  type CampaignCodexPage,
  type CampaignCodexSnapshot,
} from "./campaignCodex";
import { DEFAULT_RULES, loadRules, type CampaignRules } from "./campaignRules";
import { loadCodexGameData } from "./gameData";
import { listRuleLayers } from "./ruleLayerRepo";

const CAMPAIGN_ID = "campaign-alpha";

function page(overrides: Partial<CampaignCodexPage> = {}): CampaignCodexPage {
  return {
    id: "wte.page.field-guide",
    stem: "field-guide",
    title: "Field Guide",
    kind: "page",
    content: "# Field Guide\n\nShared table lore.",
    visibility: "player",
    pulled: false,
    source: "official",
    ...overrides,
  };
}

function snapshot(options: {
  pages?: CampaignCodexPage[];
  rules?: CampaignRules;
  ruleLayers?: RuleLayer[];
  campaignId?: string;
} = {}): CampaignCodexSnapshot {
  const pages = options.pages ?? [page()];
  const rules = options.rules ?? { ...DEFAULT_RULES };
  const ruleLayers = options.ruleLayers ?? [];
  const campaignId = options.campaignId ?? CAMPAIGN_ID;
  return {
    schema: 1,
    campaignId,
    campaignName: "Alpha Table",
    revision: campaignCodexRevision(pages, rules, ruleLayers),
    generatedAt: 123_456,
    rules,
    ruleLayers,
    pages,
  };
}

beforeEach(() => {
  localStorage.clear();
  clearRoomCodex();
  delete window.__TAURI__;
});

afterEach(() => {
  clearRoomCodex();
  registerCodexGameData({});
  setCodexCatalog([], []);
  setCodexRuntimeEntries([]);
  delete window.__TAURI__;
});

describe("campaign Codex wire validation", () => {
  it("accepts a well-formed player-visible snapshot for the expected campaign", () => {
    const raw = snapshot();

    expect(parseCampaignCodexSnapshot(raw, CAMPAIGN_ID)).toEqual(raw);
  });

  it("rejects a snapshot for another campaign and content with a tampered revision", () => {
    const raw = snapshot();
    expect(parseCampaignCodexSnapshot(raw, "campaign-beta")).toBeNull();

    const tampered = structuredClone(raw);
    tampered.pages[0].content += "\nChanged after hashing.";
    expect(parseCampaignCodexSnapshot(tampered, CAMPAIGN_ID)).toBeNull();
  });

  it("rejects curator-only content even when the sender recomputes its revision", () => {
    const curatorPage = page({ visibility: "curator", content: "# Curator Notes\n\nSecret." });
    const raw = snapshot({ pages: [curatorPage] });

    expect(parseCampaignCodexSnapshot(raw, CAMPAIGN_ID)).toBeNull();
  });

  it("rejects malformed rules and campaign pages owned by another table", () => {
    const malformed = { ...snapshot(), rules: { attrBudget: "yes" } };
    expect(parseCampaignCodexSnapshot(malformed, CAMPAIGN_ID)).toBeNull();

    const foreign = page({
      id: "campaign.campaign-beta.page.field-guide",
      source: "campaign",
      ownerId: "campaign-beta",
    });
    expect(parseCampaignCodexSnapshot(snapshot({ pages: [foreign] }), CAMPAIGN_ID)).toBeNull();
  });

  it("resolves a campaign customization over its official page without hiding unrelated pages", () => {
    const official = page({ id: "wte.page.field-guide" });
    const other = page({ id: "wte.page.other", stem: "other", title: "Other" });
    const customized = page({
      id: "campaign.campaign-alpha.page.field-guide",
      source: "campaign",
      ownerId: CAMPAIGN_ID,
      overrides: official.id,
      content: "# Field Guide\n\nCampaign version.",
    });

    expect(resolveCampaignCodexPages([official, other, customized])).toEqual([other, customized]);
  });

  it("uses valid official ids for generic lore so a campaign fork can name what it replaces", () => {
    const official = page({ id: "wte.page.field-guide" });
    const customized = page({
      id: "campaign.campaign-alpha.page.field-guide",
      source: "campaign",
      ownerId: CAMPAIGN_ID,
      overrides: "wte.page.field-guide",
    });

    expect(resolveCampaignCodexPages([official, customized])).toEqual([customized]);
  });
});

describe("installed room authority", () => {
  it("installs and clears the Curator's campaign rules and numeric layers in memory", async () => {
    const rules: CampaignRules = {
      ...DEFAULT_RULES,
      attrBudget: true,
      attrBudgetPoints: 64,
      specTotal: 180,
      poolCompensation: true,
    };
    const layer: RuleLayer = {
      id: "campaign-alpha-evasion",
      targetId: "wte.stat.evasion",
      scope: "campaign",
      owner: CAMPAIGN_ID,
      op: "add",
      value: -2,
      enabled: true,
      order: 3,
    };
    const parsed = parseCampaignCodexSnapshot(snapshot({ rules, ruleLayers: [layer] }), CAMPAIGN_ID);
    expect(parsed).not.toBeNull();

    expect(installRoomCodex(parsed!)).toBe(true);
    expect(activeRoomCodex()?.campaignId).toBe(CAMPAIGN_ID);
    expect(roomCodexState()).toEqual({ status: "syncing", campaignId: CAMPAIGN_ID });
    expect(loadRules(CAMPAIGN_ID)).toEqual(rules);
    expect(await listRuleLayers(CAMPAIGN_ID)).toEqual([layer]);
    expect(await listRuleLayers("campaign-beta")).toEqual([]);

    expect(markRoomCodexReady(CAMPAIGN_ID, parsed!.revision)).toBe(true);
    expect(roomCodexState()).toMatchObject({ status: "ready", campaignId: CAMPAIGN_ID, pageCount: 1 });

    expect(clearRoomCodex()).toBe(true);
    expect(activeRoomCodex()).toBeNull();
    expect(roomCodexState()).toEqual({ status: "idle" });
    expect(loadRules(CAMPAIGN_ID)).toEqual(DEFAULT_RULES);
    expect(await listRuleLayers(CAMPAIGN_ID)).toEqual([]);
  });

  it("rejects private notes, duplicate layers, and identities whose scope contradicts their source", () => {
    const baseLayer: RuleLayer = {
      id: "campaign-alpha-evasion",
      targetId: "wte.stat.evasion",
      scope: "campaign",
      owner: CAMPAIGN_ID,
      op: "add",
      value: -2,
    };
    expect(parseCampaignCodexSnapshot(snapshot({
      ruleLayers: [{ ...baseLayer, note: "Curator-only intent" }],
    }), CAMPAIGN_ID)).toBeNull();
    expect(parseCampaignCodexSnapshot(snapshot({
      ruleLayers: [baseLayer, { ...baseLayer }],
    }), CAMPAIGN_ID)).toBeNull();
    expect(parseCampaignCodexSnapshot(snapshot({
      pages: [page({ id: "campaign.campaign-alpha.page.field-guide" })],
    }), CAMPAIGN_ID)).toBeNull();
    expect(parseCampaignCodexSnapshot(snapshot({
      ruleLayers: [{ ...baseLayer, value: 1_000_001 }],
    }), CAMPAIGN_ID)).toBeNull();
  });
});

describe("room snapshot game-data compilation", () => {
  it("populates character creation, equipment, and bestiary data from the joined table", async () => {
    const pages = [
      page({
        id: "campaign.campaign-alpha.species.roomling",
        stem: "roomling",
        title: "Roomling",
        kind: "species",
        source: "campaign",
        ownerId: CAMPAIGN_ID,
        pulled: true,
        content: `# Roomling

| Type | Species |
| Name | Roomling |
| ID | roomling |
| Family | Humanity |
| Bonuses | STR +2, DEX -1 |
| Size | moderate |`,
      }),
      page({
        id: "campaign.campaign-alpha.paradigm.room-seer",
        stem: "room-seer",
        title: "Room Seer",
        kind: "paradigm",
        source: "campaign",
        ownerId: CAMPAIGN_ID,
        pulled: true,
        content: `# Room Seer

| Type | Paradigm |
| Name | Room Seer |
| ID | room-seer |
| Group | Campaign |
| Weapons | Energy, Hybrid |
| Domains | Null, Neutral |`,
      }),
      page({
        id: "campaign.campaign-alpha.background.table-scout",
        stem: "table-scout",
        title: "Table Scout",
        kind: "background",
        source: "campaign",
        ownerId: CAMPAIGN_ID,
        pulled: true,
        content: `# Table Scout

| Type | Background |
| Name | Table Scout |
| Mode | Standard |
| Bonuses | +2 Strength, +2 Wisdom, +1 Balance, +1 Control |`,
      }),
      page({
        id: "campaign.campaign-alpha.weapon.room-lance",
        stem: "room-lance",
        title: "Room Lance",
        kind: "weapon",
        source: "campaign",
        ownerId: CAMPAIGN_ID,
        pulled: true,
        content: `# Room Lance

| Type | Weapon |
| Category | Energy |
| Weight | Light |
| NC Cost | 3 |
| Damage | 2d6 Radiant |
| Range | 30 ft |`,
      }),
      page({
        id: "campaign.campaign-alpha.creature.room-wisp",
        stem: "room-wisp",
        title: "Room Wisp",
        kind: "creature",
        source: "campaign",
        ownerId: CAMPAIGN_ID,
        pulled: true,
        content: `# Room Wisp

| Type | Creature |
| Class | 1 |
| Rank | Grunt |
| OFF | 8 |
| DEF | 6 |
| SPD | 10 |
| WIL | 4 |`,
      }),
    ];
    const parsed = parseCampaignCodexSnapshot(snapshot({ pages }), CAMPAIGN_ID);
    expect(parsed).not.toBeNull();
    installRoomCodex(parsed!);

    await loadCodexGameData();

    expect(getSpecies("roomling")).toMatchObject({ name: "Roomling", bonuses: { phy: 2, dex: -1 } });
    expect(getParadigm("room-seer")).toMatchObject({ name: "Room Seer", domains: ["Null", "Neutral"] });
    expect(BACKGROUNDS).toContainEqual(expect.objectContaining({ name: "Table Scout", mode: "standard" }));
    expect(getWeapon("Room Lance")).toMatchObject({ damage: "2d6 Radiant", range: "30 ft", ncCost: 3 });

    // listCreatures is intentionally desktop-gated; in the app the joined room
    // runs under Tauri, where it must use the runtime entries just compiled above.
    window.__TAURI__ = { core: { invoke: async () => [] } };
    expect(await listCreatures()).toContainEqual(expect.objectContaining({ name: "Room Wisp", cls: 1 }));
  });

  it("compiles a customized built-in cipher: the Name row keeps the override landing, deleted rows inherit", async () => {
    const official = bakedCiphers()["science"].find((cipher) => cipher.name === "LIGHT WEIGHT")!;
    const baked = findBakedCodexPage({ id: "wte.cipher.light-weight" })!;
    const fork = customizePageForCampaign({
      content: baked.content,
      stem: baked.stem,
      campaignId: CAMPAIGN_ID,
      officialId: baked.id,
    });
    const content = fork.content
      .replace(/^# .+$/m, "# House Light Weight") // retitled — the Name row is the identity
      .replace(/^\| SS \| .+ \|$/m, "| SS | 9 |")
      .replace(/^\| Activation \| .+ \|\n/m, ""); // deleted row must inherit, not blank
    const pages = [
      page({
        id: fork.id,
        stem: baked.stem,
        title: "House Light Weight",
        kind: "cipher",
        source: "campaign",
        ownerId: CAMPAIGN_ID,
        pulled: true,
        content,
      }),
    ];
    installRoomCodex(parseCampaignCodexSnapshot(snapshot({ pages }), CAMPAIGN_ID)!);

    await loadCodexGameData();

    const merged = ciphersForParadigm("science").filter((cipher) => cipher.name === "LIGHT WEIGHT");
    expect(merged).toHaveLength(1);
    expect(merged[0].ss).toBe(9);
    expect(merged[0].type).toBe(official.type);
    expect(merged[0].tier).toBe(official.tier);
    // Byte-identical effect: the Rank/Component rows reassembled into the header.
    expect(merged[0].effect).toBe(official.effect);
    // The fork's ID row names the CAMPAIGN layer; identity stays the official
    // concept. Filing an outcome under the layer id would orphan it the moment
    // the table drops the override.
    expect(merged[0].id).toBe(official.id);
    expect(usableCiphers("science", ["LIGHT WEIGHT"])[0]).toMatchObject({
      name: "LIGHT WEIGHT",
      id: official.id,
      ss: 9,
    });
  });

  // pageIdentity writes the previous name into an Aliases row on every rename,
  // and a player's stored loadout still holds that name. The compile step is the
  // only place the row can reach the cipher record, so a table that renames its
  // own cipher must not cost every character who took it a blank 0-SS row.
  it("carries a renamed campaign cipher's former name onto the compiled record", async () => {
    const content = [
      "# WYRM STATIC",
      "",
      "| Field | Value |",
      "|---|---|",
      "| Type | Cipher |",
      "| ID | campaign.campaign-alpha.cipher.wyrm-static |",
      "| Name | WYRM STATIC |",
      "| Aliases | STATIC WYRM |",
      "| Paradigm | science |",
      "| Tier | online |",
      "| SS | 14 |",
      "| Activation | Bonus Action |",
      "",
      "## Effect",
      "",
      "Crackles.",
      "",
    ].join("\n");
    const pages = [
      page({
        id: "campaign.campaign-alpha.cipher.wyrm-static",
        stem: "cipher-wyrm-static",
        title: "WYRM STATIC",
        kind: "cipher",
        source: "campaign",
        ownerId: CAMPAIGN_ID,
        pulled: true,
        content,
      }),
    ];
    installRoomCodex(parseCampaignCodexSnapshot(snapshot({ pages }), CAMPAIGN_ID)!);

    await loadCodexGameData();

    const compiled = ciphersForParadigm("science").find((cipher) => cipher.name === "WYRM STATIC")!;
    expect(compiled.aliases).toEqual(["STATIC WYRM"]);
    expect(usableCiphers("science", ["STATIC WYRM"])[0]).toMatchObject({ name: "WYRM STATIC", ss: 14 });
  });

  it("inherits the official cipher rule text when a fork deletes the Effect body or the Rank row", async () => {
    const official = bakedCiphers()["science"].find((cipher) => cipher.name === "LIGHT WEIGHT")!;
    const baked = findBakedCodexPage({ id: "wte.cipher.light-weight" })!;
    const fork = customizePageForCampaign({
      content: baked.content,
      stem: baked.stem,
      campaignId: CAMPAIGN_ID,
      officialId: baked.id,
    });
    // Delete the whole ## Effect section AND the Rank row — only SS changes.
    const content = fork.content
      .replace(/\n## Effect[\s\S]*$/, "\n")
      .replace(/^\| Rank \| .+ \|\n/m, "")
      .replace(/^\| SS \| .+ \|$/m, "| SS | 7 |");
    const pages = [
      page({
        id: fork.id,
        stem: baked.stem,
        title: "LIGHT WEIGHT",
        kind: "cipher",
        source: "campaign",
        ownerId: CAMPAIGN_ID,
        pulled: true,
        content,
      }),
    ];
    installRoomCodex(parseCampaignCodexSnapshot(snapshot({ pages }), CAMPAIGN_ID)!);

    await loadCodexGameData();

    const merged = ciphersForParadigm("science").find((cipher) => cipher.name === "LIGHT WEIGHT")!;
    expect(merged.ss).toBe(7);
    // The full official rule — Rank gate, Component, and body — survives.
    expect(merged.effect).toBe(official.effect);
  });

  it("compiles a customized built-in Genus ability into the campaign override layer", async () => {
    const ability = getGenusDomain("Eldritch")!.abilities.find(
      (candidate) => typeof candidate.ss === "number" && candidate.effect && candidate.id
    )!;
    const baked = findBakedCodexPage({ id: ability.id! })!;
    const fork = customizePageForCampaign({
      content: baked.content,
      stem: baked.stem,
      campaignId: CAMPAIGN_ID,
      officialId: baked.id,
    });
    const content = fork.content.replace(/^\| SS \| .+ \|$/m, "| SS | 11 |");
    const pages = [
      page({
        id: fork.id,
        stem: baked.stem,
        title: ability.name,
        kind: "genus",
        source: "campaign",
        ownerId: CAMPAIGN_ID,
        pulled: true,
        content,
      }),
    ];
    installRoomCodex(parseCampaignCodexSnapshot(snapshot({ pages }), CAMPAIGN_ID)!);

    await loadCodexGameData();

    const resolved = usableGenusResolved([ability.name], codexCtx(CAMPAIGN_ID), {}, []);
    expect(resolved[0]).toMatchObject({ name: ability.name, ss: 11 });
    // Fields the fork restated identically still read as the official values.
    expect(resolved[0].effect).toBe(ability.effect);
  });
});
