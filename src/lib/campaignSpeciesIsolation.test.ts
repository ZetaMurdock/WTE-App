// @vitest-environment happy-dom
//
// Does a Curator's edit actually reach the game, and does it stay inside the
// campaign that made it?
//
// Every other test in this area checks one link of the chain. This one walks the
// whole thing the way the app does — fork a built-in rule, store it against a
// campaign, build that campaign's manifest, run the game-data loader, and read
// the species catalog the character creator reads. Then it does the same for a
// second table, and for no table at all, because a house rule that leaks is
// worse than one that never applied.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StoredCodexPage } from "./codexPageRepo";

vi.mock("./codexPageRepo", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./codexPageRepo")>();
  return { ...actual, listCodexPages: vi.fn() };
});
vi.mock("./repo", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./repo")>();
  return { ...actual, getActiveCampaignId: vi.fn() };
});

import { listCodexPages } from "./codexPageRepo";
import { getActiveCampaignId } from "./repo";
import { clearRoomCodex, invalidatePageFileCache } from "./campaignCodex";
import { findBakedCodexPage } from "./bakedCodexPages";
import { prepareCampaignCustomization } from "./codexMechanicScaffold";
import { customizePageForCampaign } from "./pageIdentity";
import { loadCodexGameData } from "./gameData";
import { getSpecies, registerCodexGameData, speciesInnate } from "../game/wte";

const TABLE_A = "ashen-sun";
const TABLE_B = "iron-wake";

/** The exact content CodexBrowser would put in the editor for a Customize. */
function fork(speciesId: string, campaignId: string): string {
  const page = findBakedCodexPage({ id: `wte.species.${speciesId}` })!;
  const prepared = prepareCampaignCustomization({
    stem: page.stem,
    content: page.content,
    label: page.label,
    kind: page.kind,
  });
  return customizePageForCampaign({
    content: prepared.content,
    stem: page.stem,
    campaignId,
    officialId: page.id,
  }).content;
}

function storedRow(stem: string, content: string, campaignId: string): StoredCodexPage {
  return {
    id: (content.match(/^\s*\|\s*ID\s*\|\s*([^|]+)\|/im)?.[1] ?? "").trim(),
    campaignId,
    stem,
    kind: "species",
    title: stem,
    content,
    visibility: "player",
    aliases: [],
    updatedAt: 1,
  };
}

/** Everything the app does between "Curator hits save" and "creator repaints". */
async function loadFor(campaignId: string, rows: StoredCodexPage[]): Promise<void> {
  vi.mocked(getActiveCampaignId).mockReturnValue(campaignId || null);
  vi.mocked(listCodexPages).mockImplementation(async (asked?: string | null) => {
    const owner = asked || "";
    return rows.filter((row) => row.campaignId === owner || row.campaignId === "");
  });
  invalidatePageFileCache();
  await loadCodexGameData();
}

beforeEach(() => {
  localStorage.clear();
  clearRoomCodex();
  delete window.__TAURI__;
  registerCodexGameData({});
});

afterEach(() => {
  clearRoomCodex();
  registerCodexGameData({});
  vi.restoreAllMocks();
});

describe("a saved campaign edit reaches character creation", () => {
  it("renames a lineage for the table that authored it", async () => {
    const md = fork("oriyu", TABLE_A).replace("| Name | Oriyu |", "| Name | Voidborn |");
    await loadFor(TABLE_A, [storedRow("species-oriyu", md, TABLE_A)]);
    expect(getSpecies("oriyu")?.name).toBe("Voidborn");
  });

  it("applies a bonus, a variant rename and an innate rename in one save", async () => {
    const md = fork("oriyu", TABLE_A)
      .replace("| Bonuses | None |", "| Bonuses | INT +3 |")
      .replace("### Qerran", "### Qerran Ascendant")
      .replace("- **Dyn Formn** —", "- **Dyn Formation** —");
    await loadFor(TABLE_A, [storedRow("species-oriyu", md, TABLE_A)]);

    const species = getSpecies("oriyu")!;
    expect(species.bonuses).toEqual({ int: 3 });
    expect(species.variants.map((v) => v.name)).toContain("Qerran Ascendant");
    expect(speciesInnate("oriyu").map((a) => a.name)).toContain("Dyn Formation");
  });

  it("picks up a second save over the same rule", async () => {
    const once = fork("oriyu", TABLE_A).replace("| Name | Oriyu |", "| Name | First |");
    await loadFor(TABLE_A, [storedRow("species-oriyu", once, TABLE_A)]);
    expect(getSpecies("oriyu")?.name).toBe("First");

    const twice = fork("oriyu", TABLE_A).replace("| Name | Oriyu |", "| Name | Second |");
    await loadFor(TABLE_A, [storedRow("species-oriyu", twice, TABLE_A)]);
    expect(getSpecies("oriyu")?.name).toBe("Second");
  });
});

describe("a campaign edit stays inside its campaign", () => {
  it("does not follow the Curator to another table", async () => {
    const rows = [storedRow("species-oriyu", fork("oriyu", TABLE_A).replace("| Name | Oriyu |", "| Name | Voidborn |"), TABLE_A)];

    await loadFor(TABLE_A, rows);
    expect(getSpecies("oriyu")?.name).toBe("Voidborn");

    // Same installation, same stored rows, different campaign.
    await loadFor(TABLE_B, rows);
    expect(getSpecies("oriyu")?.name).toBe("Oriyu");
  });

  it("does not apply with no campaign selected", async () => {
    const rows = [storedRow("species-oriyu", fork("oriyu", TABLE_A).replace("| Name | Oriyu |", "| Name | Voidborn |"), TABLE_A)];
    await loadFor("", rows);
    expect(getSpecies("oriyu")?.name).toBe("Oriyu");
  });

  it("keeps two tables' versions of one lineage apart", async () => {
    const rows = [
      storedRow("species-oriyu", fork("oriyu", TABLE_A).replace("| Dominance | 40 |", "| Dominance | 10 |"), TABLE_A),
      storedRow("species-oriyu", fork("oriyu", TABLE_B).replace("| Dominance | 40 |", "| Dominance | 99 |"), TABLE_B),
    ];
    await loadFor(TABLE_A, rows);
    expect(getSpecies("oriyu")?.dom).toBe(10);
    await loadFor(TABLE_B, rows);
    expect(getSpecies("oriyu")?.dom).toBe(99);
    // And back again — a stale registry from the previous table is the failure
    // mode that makes a house rule look like it "sometimes" applies.
    await loadFor(TABLE_A, rows);
    expect(getSpecies("oriyu")?.dom).toBe(10);
  });

  it("reverts the moment the campaign page is removed", async () => {
    const rows = [storedRow("species-oriyu", fork("oriyu", TABLE_A).replace("| Name | Oriyu |", "| Name | Voidborn |"), TABLE_A)];
    await loadFor(TABLE_A, rows);
    expect(getSpecies("oriyu")?.name).toBe("Voidborn");
    await loadFor(TABLE_A, []);
    expect(getSpecies("oriyu")?.name).toBe("Oriyu");
  });

  it("leaves every other lineage untouched", async () => {
    const md = fork("oriyu", TABLE_A).replace("| Name | Oriyu |", "| Name | Voidborn |");
    await loadFor(TABLE_A, [storedRow("species-oriyu", md, TABLE_A)]);
    expect(getSpecies("hyomen")?.name).toBe("Hyomen");
    expect(getSpecies("seraph")?.name).toBe("Seraph");
  });
});

describe("a page that is not pulled", () => {
  it("does not change the game", async () => {
    // The Engineer pull flag still governs. A Curator who turned it off has said
    // "keep this page as a note, not as a rule".
    localStorage.setItem(
      "wte-page-meta",
      JSON.stringify({ "species-oriyu": { pulled: false, visibility: "player" } })
    );
    const md = fork("oriyu", TABLE_A).replace("| Name | Oriyu |", "| Name | Voidborn |");
    await loadFor(TABLE_A, [storedRow("species-oriyu", md, TABLE_A)]);
    expect(getSpecies("oriyu")?.name).toBe("Oriyu");
  });
});

describe("a paradigm edit reaches character creation", () => {
  function forkParadigm(paradigmId: string, campaignId: string): string {
    const page = findBakedCodexPage({ id: `wte.paradigm.${paradigmId}` })!;
    const prepared = prepareCampaignCustomization({
      stem: page.stem,
      content: page.content,
      label: page.label,
      kind: page.kind,
    });
    return customizePageForCampaign({
      content: prepared.content,
      stem: page.stem,
      campaignId,
      officialId: page.id,
    }).content;
  }

  function row(content: string, campaignId: string): StoredCodexPage {
    return { ...storedRow("paradigm-cognition", content, campaignId), kind: "paradigm" };
  }

  it("renames Cognition", async () => {
    const md = forkParadigm("cognition", TABLE_A).replace("| Name | Cognition |", "| Name | Insight |");
    await loadFor(TABLE_A, [row(md, TABLE_A)]);
    const { PARADIGMS } = await import("../game/wte");
    expect(PARADIGMS.find((p) => p.id === "cognition")?.name).toBe("Insight");
  });

  it("keeps it in the creator's list exactly once, in place", async () => {
    const md = forkParadigm("cognition", TABLE_A).replace("| Name | Cognition |", "| Name | Insight |");
    await loadFor(TABLE_A, [row(md, TABLE_A)]);
    const { PARADIGMS } = await import("../game/wte");
    expect(PARADIGMS.filter((p) => p.name === "Insight")).toHaveLength(1);
    expect(PARADIGMS.map((p) => p.id)).toEqual([
      "science", "simulation", "remnant", "cognition", "evolution", "warfare",
    ]);
  });

  it("changes its domains and weapons", async () => {
    const md = forkParadigm("cognition", TABLE_A)
      .replace("| Domains | Eldritch, Null |", "| Domains | Photonic |")
      .replace("| Weapons | Energy, Exotic, Hybrid |", "| Weapons | Kinetic |");
    await loadFor(TABLE_A, [row(md, TABLE_A)]);
    const { getParadigm } = await import("../game/wte");
    expect(getParadigm("cognition")?.domains).toEqual(["Photonic"]);
    expect(getParadigm("cognition")?.weapons).toEqual(["Kinetic"]);
  });

  it("does not leak to another table", async () => {
    const rows = [row(forkParadigm("cognition", TABLE_A).replace("| Name | Cognition |", "| Name | Insight |"), TABLE_A)];
    await loadFor(TABLE_A, rows);
    await loadFor(TABLE_B, rows);
    const { getParadigm } = await import("../game/wte");
    expect(getParadigm("cognition")?.name).toBe("Cognition");
  });
});
