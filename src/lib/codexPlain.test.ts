import { describe, expect, it } from "vitest";
import { codexPlainSource, isVisualDocPage } from "./codexPlain";
import { parseParadigmPage, parseSpeciesDefinitionPage } from "./gameData";
import { customizePageForCampaign, pinPageIdentity, readField, storedPageFor } from "./pageIdentity";
import visualDocParadigm from "./__fixtures__/visualDocParadigm.txt?raw";

// The fixture is a REAL page, lifted from a Curator's database after they forked
// the built-in Cognition paradigm, renamed it in the Visual Engine, and saved.
// Only the campaign id and the new name are substituted; every byte of
// structure — the loose identity row, the doc comment, the generated HTML — is
// exactly what the editor wrote, because the structure is what broke.
// It looked saved, it was listed, it was badged Pulled — and character creation
// went on showing "Cognition", because the visual editor had replaced the field
// table with HTML and a JSON comment that no parser read.

describe("a page written in the Visual Engine", () => {
  it("is recognised as one", () => {
    expect(isVisualDocPage(visualDocParadigm)).toBe(true);
    expect(isVisualDocPage("# Plain\n\n| Type | Species |")).toBe(false);
  });

  it("yields the field table the parsers read", () => {
    const plain = codexPlainSource(visualDocParadigm);
    expect(plain).toContain("| Type | Paradigm |");
    expect(plain).toContain("| Name | Insight |");
    expect(plain).toContain("| Overrides | wte.paradigm.cognition |");
    expect(plain).toContain("| Group | Esoteric & Survival |");
  });

  it("parses as the paradigm it is, under the Curator's new name", () => {
    const paradigm = parseParadigmPage(visualDocParadigm, "paradigm-cognition");
    expect(paradigm).not.toBeNull();
    // The rename the Curator made and could not see anywhere in the game.
    expect(paradigm!.name).toBe("Insight");
    // Still keyed to the official rule, so it overrides rather than adding a
    // seventh paradigm next to the one it was forked from.
    expect(paradigm!.id).toBe("cognition");
    expect(paradigm!.domains).toEqual(["Eldritch", "Null"]);
    expect(paradigm!.weapons).toEqual(["Energy", "Exotic", "Hybrid"]);
  });

  it("declares a Type, so it is filed as a rule and not as lore", () => {
    // Saved as `…page.cognition` with no Overrides, because readField could not
    // see the Type row. That is what demoted a paradigm to a generic page.
    expect(readField(visualDocParadigm, "Type")).toBe("Paradigm");
    expect(readField(visualDocParadigm, "Overrides")).toBe("wte.paradigm.cognition");
  });

  it("re-forks as a paradigm, and keeps pointing at the rule it replaces", () => {
    const fork = customizePageForCampaign({
      content: visualDocParadigm,
      stem: "paradigm-cognition",
      campaignId: "table-one",
      officialId: "wte.paradigm.cognition",
    });
    // The page id follows the page's title — it is provenance for THIS page.
    // `Overrides` is the gameplay link, and it must not drift with a rename.
    expect(fork.id).toBe("campaign.table-one.paradigm.insight");
    expect(fork.overrides).toBe("wte.paradigm.cognition");
    // Which is what keeps the rule attached to characters already saved with it.
    expect(parseParadigmPage(fork.content, "paradigm-cognition")!.id).toBe("cognition");
  });
});

describe("flattening the semantic tree", () => {
  const doc = (children: unknown[]): string =>
    `<!--wte-doc ${JSON.stringify({ v: 1, children })}-->\n<div>ignored html</div>`;

  it("turns headings back into Markdown headings", () => {
    const plain = codexPlainSource(doc([{ type: "heading", level: 2, text: "Variants" }]));
    expect(plain).toContain("## Variants");
  });

  it("reads a table nested inside a container or a column", () => {
    const table = { type: "table", rows: [["Type", "Species"], ["Name", "Oriyu"]] };
    expect(codexPlainSource(doc([{ type: "container", children: [table] }]))).toContain("| Name | Oriyu |");
    expect(codexPlainSource(doc([{ type: "columns", cols: [[table]] }]))).toContain("| Name | Oriyu |");
  });

  it("treats a spoiler's title as a heading, so variant blocks survive", () => {
    const plain = codexPlainSource(
      doc([{ type: "spoiler", title: "Qerran", children: [{ type: "text", html: "<b>Note</b> here" }] }])
    );
    expect(plain).toContain("### Qerran");
    expect(plain).toContain("Note here");
  });

  it("keeps one ability per line instead of collapsing them", () => {
    const plain = codexPlainSource(
      doc([{ type: "text", html: "- <b>Alpha</b> — first<br>- <b>Beta</b> — second" }])
    );
    expect(plain.split("\n").filter((l) => l.includes("Alpha"))).toHaveLength(1);
    expect(plain).toContain("- Alpha — first");
    expect(plain).toContain("- Beta — second");
  });

  it("keeps the loose identity rows written outside the doc comment", () => {
    const source = `| Field | Value |\n|---|---|\n| ID | campaign.t.species.oriyu |\n${doc([
      { type: "table", rows: [["Type", "Species"], ["Name", "Oriyu"]] },
    ])}`;
    expect(codexPlainSource(source)).toContain("| ID | campaign.t.species.oriyu |");
  });

  it("falls back to the generated HTML when the comment is damaged", () => {
    const broken = `<!--wte-doc {not json-->\n<table><tr><td>Type</td><td>Species</td></tr></table>`;
    expect(codexPlainSource(broken)).toContain("Species");
  });

  it("decodes entities so an ampersand in a group name survives", () => {
    const plain = codexPlainSource(doc([{ type: "table", rows: [["Group", "Esoteric &amp; Survival"]] }]));
    expect(plain).toContain("| Group | Esoteric & Survival |");
  });
});

describe("Markdown pages are untouched", () => {
  it("returns the source byte for byte", () => {
    const md = "# Oriyu\n\n| Type | Species |\n| Name | Oriyu |\n\n## Variants\n### Qerran\n- **A** — b\n";
    expect(codexPlainSource(md)).toBe(md);
  });

  it("still parses exactly as before", () => {
    const md = "# Oriyu\n\n| Type | Species |\n| ID | wte.species.oriyu |\n| Name | Oriyu |\n";
    expect(parseSpeciesDefinitionPage(md, "oriyu")!.species.name).toBe("Oriyu");
  });
});

describe("a page carrying two disagreeing identity rows", () => {
  it("lets the authored table win, and says so only once", () => {
    // Exactly the state the Curator's saved page was left in: the visual editor
    // held the real `…paradigm.cognition` id, while a prepended row claimed the
    // `…page.paradigm-cognition` it had been misfiled as. First-match and
    // last-match readers disagreed about which rule the page even was.
    const source =
      "| Field | Value |\n|---|---|\n| ID | campaign.t.page.paradigm-cognition |\n" +
      `<!--wte-doc ${JSON.stringify({
        v: 1,
        children: [{ type: "table", rows: [["Type", "Paradigm"], ["ID", "campaign.t.paradigm.cognition"], ["Name", "Cognition"]] }],
      })}-->`;
    const plain = codexPlainSource(source);
    expect(plain).toContain("| ID | campaign.t.paradigm.cognition |");
    expect(plain).not.toContain("page.paradigm-cognition");
    expect(plain.match(/^\s*\|\s*ID\s*\|/gim)).toHaveLength(1);
    expect(readField(source, "ID")).toBe("campaign.t.paradigm.cognition");
  });

  it("still keeps a prepended row the table never mentions", () => {
    const source =
      "| Visibility | gm |\n" +
      `<!--wte-doc ${JSON.stringify({ v: 1, children: [{ type: "table", rows: [["Type", "Species"]] }] })}-->`;
    expect(readField(source, "Visibility")).toBe("gm");
    expect(readField(source, "Type")).toBe("Species");
  });
});

describe("saving a Visual Engine page", () => {
  const CAMPAIGN = "demo-table";

  it("keeps the identity it already has instead of assigning a new one", () => {
    const pinned = pinPageIdentity({
      content: visualDocParadigm,
      stem: "paradigm-cognition",
      campaignId: CAMPAIGN,
    });
    expect(pinned).not.toBeNull();
    expect(pinned!.assigned).toBe(false);
    expect(pinned!.id).toBe(`campaign.${CAMPAIGN}.paradigm.cognition`);
  });

  it("becomes an owned row of the right kind", () => {
    // storedPageFor returning null is what makes "Save changes" throw
    // "This page does not carry an id owned by the active campaign".
    const owned = storedPageFor("paradigm-cognition", visualDocParadigm, CAMPAIGN);
    expect(owned).not.toBeNull();
    expect(owned!.kind).toBe("paradigm");
    expect(owned!.campaignId).toBe(CAMPAIGN);
    expect(owned!.overrides).toBe("wte.paradigm.cognition");
    expect(owned!.title).toBe("Insight");
  });

  it("refuses to save into a campaign that does not own it", () => {
    expect(storedPageFor("paradigm-cognition", visualDocParadigm, "someone-else")).toBeNull();
  });
});
