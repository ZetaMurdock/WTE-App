import { afterEach, describe, expect, it } from "vitest";
import { bakedSpeciesPageContent, findBakedCodexPage } from "./bakedCodexPages";
import { prepareCampaignCustomization } from "./codexMechanicScaffold";
import { customizePageForCampaign } from "./pageIdentity";
import { parseSpeciesDefinitionPage } from "./gameData";
import {
  SPECIES,
  bakedSpecies,
  getSpecies,
  registerCodexGameData,
  speciesInnate,
  inceptSeeds,
} from "../game/wte";

// The whole point of a built-in page: fork it, edit it, and see the edit in
// character creation and on the sheet. This walks that path end to end — the
// exact sequence CodexBrowser.openEditPage runs — because every individual
// piece passing says nothing about whether a Curator's rename actually lands.
function fork(speciesId: string, campaignId = "table-one"): string {
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

/** Install an edited fork the way loadCodexGameData would. */
function install(md: string): void {
  const parsed = parseSpeciesDefinitionPage(md, "forked");
  expect(parsed).not.toBeNull();
  registerCodexGameData({ species: [parsed!] });
}

describe("forking a built-in species", () => {
  afterEach(() => registerCodexGameData({}));

  it("is left byte-for-byte alone by the scaffolder", () => {
    // The page already declares `Type: Species`, so there is nothing to infer
    // and nothing to append. A second mechanics table would be authored chaos.
    const page = findBakedCodexPage({ id: "wte.species.hyomen" })!;
    const prepared = prepareCampaignCustomization({
      stem: page.stem,
      content: page.content,
      label: page.label,
      kind: page.kind,
    });
    expect(prepared.scaffolded).toBe(false);
    expect(prepared.content).toBe(page.content);
    expect(prepared.kind).toBe("Species");
  });

  it("takes a campaign identity and names the official rule it replaces", () => {
    const md = fork("hyomen");
    expect(md).toContain("| ID | campaign.table-one.species.hyomen |");
    expect(md).toContain("| Overrides | wte.species.hyomen |");
    // One identity row, not two — the built-in page already had an ID row.
    expect(md.match(/^\s*\|\s*ID\s*\|/gim)).toHaveLength(1);
  });

  it("still resolves to the gameplay slug saved on existing characters", () => {
    expect(parseSpeciesDefinitionPage(fork("hyomen"), "forked")!.species.id).toBe("hyomen");
  });
});

describe("a Curator's edits reach the game", () => {
  afterEach(() => registerCodexGameData({}));

  it("renames a lineage without orphaning saved characters", () => {
    install(fork("hyomen").replace("| Name | Hyomen |", "| Name | Ascendant |"));
    const species = getSpecies("hyomen");
    expect(species?.name).toBe("Ascendant");
    // Renaming is a display change. The id is what every saved sheet stores.
    expect(species?.id).toBe("hyomen");
    expect(SPECIES.filter((s) => s.id === "hyomen")).toHaveLength(1);
  });

  it("changes attribute bonuses", () => {
    install(fork("voaulton").replace("| Bonuses | STR +2, END +2 |", "| Bonuses | INT +3, WIS +1 |"));
    expect(getSpecies("voaulton")?.bonuses).toEqual({ int: 3, wis: 1 });
  });

  it("changes Dominance, Recessiveness and Eminence", () => {
    install(
      fork("stygians")
        .replace("| Dominance | 20 |", "| Dominance | 55 |")
        .replace("| Eminence | Feral +20 |", "| Eminence | Civilized +5 |")
    );
    const species = getSpecies("stygians");
    expect(species?.dom).toBe(55);
    expect(species?.eminence).toBe("Civilized +5");
    expect(species?.rec).toBe(35); // untouched rows keep inheriting
  });

  it("renames an innate and the creator's picker follows", () => {
    install(fork("seraph").replace("- **Thi Voth** —", "- **Void Pinions** —"));
    const names = speciesInnate("seraph").map((a) => a.name);
    expect(names).toContain("Void Pinions");
    expect(names).not.toContain("Thi Voth");
    // The renamed innate keeps the effect the Curator can see and edit on the page.
    expect(speciesInnate("seraph").find((a) => a.name === "Void Pinions")?.effect).toBeTruthy();
    // And the unselected pair still seeds the Incept Pool under the new name.
    expect(inceptSeeds("seraph", ["Rapture"]).map((a) => a.name)).toContain("Void Pinions");
  });

  it("gives a brand-new innate real effect text", () => {
    const md = fork("mirga").replace(
      "- **Perfect Mimicry** —",
      "- **Borrowed Face** — Copy a creature you have touched this Scene.\n- **Perfect Mimicry** —"
    );
    install(md);
    const borrowed = speciesInnate("mirga").find((a) => a.name === "Borrowed Face");
    expect(borrowed?.effect).toBe("Copy a creature you have touched this Scene.");
    expect(getSpecies("mirga")?.innate).toContain("Borrowed Face");
  });
});

describe("the variants that had no page", () => {
  afterEach(() => registerCodexGameData({}));

  const cases = [
    { speciesId: "subdermin", variant: "Salaris" },
    { speciesId: "subdermin", variant: "Trevant" },
    { speciesId: "oriyu", variant: "Qerran" },
  ];

  for (const { speciesId, variant } of cases) {
    it(`${variant} can be renamed from Campaign Settings`, () => {
      const before = bakedSpecies().find((s) => s.id === speciesId)!;
      expect(before.variants.map((v) => v.name)).toContain(variant);

      install(fork(speciesId).replace(`### ${variant}`, `### ${variant} Reborn`));
      const names = getSpecies(speciesId)!.variants.map((v) => v.name);
      expect(names).toContain(`${variant} Reborn`);
      expect(names).not.toContain(variant);
      // Renaming one variant must not cost the others — the section is authored
      // whole, so a lossy generator would silently delete the rest of a lineage.
      expect(names).toHaveLength(before.variants.length);
    });
  }

  it("keeps a variant's abilities, note and options through the fork", () => {
    const before = bakedSpecies().find((s) => s.id === "stygians")!;
    const annunaki = before.variants.find((v) => v.name === "Annunaki")!;
    expect(annunaki.options?.length).toBeGreaterThan(0);

    install(fork("stygians"));
    const after = getSpecies("stygians")!.variants.find((v) => v.name === "Annunaki")!;
    expect(after.abilities).toEqual(annunaki.abilities);
    expect(after.options).toEqual(annunaki.options);
    expect(after.note).toBe(annunaki.note);
  });

  it("adds a variant that was never in the compiled data", () => {
    const md = `${fork("oriyu").trimEnd()}\n\n### Housebound\nA lineage invented at this table.\n- **Anchor Step** — Never displaced against your will.\n`;
    install(md);
    const added = getSpecies("oriyu")!.variants.find((v) => v.name === "Housebound");
    expect(added?.abilities).toEqual([{ name: "Anchor Step", effect: "Never displaced against your will." }]);
    expect(added?.note).toBe("A lineage invented at this table.");
  });
});

describe("built-in data is never mutated by a campaign", () => {
  afterEach(() => registerCodexGameData({}));

  it("keeps the built-in page showing the official rule after a fork", () => {
    install(fork("hyomen").replace("| Name | Hyomen |", "| Name | Ascendant |"));
    expect(getSpecies("hyomen")?.name).toBe("Ascendant");
    // The page a Curator forks must still describe the OFFICIAL rule, or the
    // next campaign to fork it would inherit the last campaign's house rules.
    expect(findBakedCodexPage({ id: "wte.species.hyomen" })!.content).toContain("| Name | Hyomen |");
    expect(bakedSpeciesPageContent(bakedSpecies().find((s) => s.id === "hyomen")!)).toContain("| Name | Hyomen |");
  });

  it("reverts cleanly when the campaign page goes away", () => {
    install(fork("hyomen").replace("| Name | Hyomen |", "| Name | Ascendant |"));
    registerCodexGameData({});
    expect(getSpecies("hyomen")?.name).toBe("Hyomen");
  });
});
