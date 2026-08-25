// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildCampaignCodexSnapshot, type CampaignCodexPage } from "../lib/campaignCodex";
import { OPEN_CODEX_PAGE, type OpenCodexPageDetail } from "../lib/openCodexPage";
import { CampaignCodexPanel, campaignCodexSectionTree, effectiveCampaignCodexView, groupCampaignCodexPages } from "./CampaignCodexPanel";

vi.mock("../lib/campaignCodex", async (loadOriginal) => {
  const original = await loadOriginal<typeof import("../lib/campaignCodex")>();
  return { ...original, buildCampaignCodexSnapshot: vi.fn() };
});

const CAMPAIGN = "ashen-sun";
const official: CampaignCodexPage = {
  id: "wte.background.courier",
  stem: "Courier",
  title: "Courier",
  kind: "background",
  label: "Background",
  content: "# Courier",
  visibility: "player",
  pulled: true,
  source: "official",
};
const campaign: CampaignCodexPage = {
  id: "campaign.ashen-sun.roll-formula.evasion",
  stem: "Ashen_Evasion",
  title: "Ashen Evasion",
  kind: "roll-formula",
  content: "# Ashen Evasion",
  visibility: "curator",
  pulled: false,
  source: "campaign",
  ownerId: CAMPAIGN,
  overrides: "wte.roll-formula.evasion",
};
const constructorPage: CampaignCodexPage = {
  id: "wte.page.constructor",
  stem: "Constructor",
  title: "Constructor",
  kind: "page",
  content: "# Constructor",
  visibility: "player",
  pulled: true,
  source: "official",
};

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  document.body.innerHTML = "";
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  vi.mocked(buildCampaignCodexSnapshot).mockReset().mockResolvedValue({
    schema: 1,
    campaignId: CAMPAIGN,
    campaignName: "Ashen Sun",
    revision: "c2-test",
    generatedAt: 1,
    rules: {} as never,
    ruleLayers: [],
    pages: [campaign, official, constructorPage],
  });
});

async function mount(curator = true) {
  await act(async () => {
    root.render(<CampaignCodexPanel campaignId={CAMPAIGN} campaignName="Ashen Sun" curator={curator} />);
    await Promise.resolve();
    await Promise.resolve();
  });
}

function button(label: string): HTMLButtonElement | undefined {
  return [...host.querySelectorAll<HTMLButtonElement>("button")].find((candidate) => candidate.textContent?.trim() === label);
}

describe("the Curator's campaign Codex panel", () => {
  it("is absent for players and does not read Curator content", async () => {
    await mount(false);
    expect(host.querySelector(".campaign-codex")).toBeNull();
    expect(buildCampaignCodexSnapshot).not.toHaveBeenCalled();
  });

  it("groups arbitrary kinds and exposes source, visibility, and pull status", async () => {
    await mount();
    const text = host.textContent ?? "";
    expect(text).toContain("Campaign Settings");
    expect(text).not.toContain("Rules in force");
    expect(text).toContain("Background");
    expect(text).toContain("Constructor");
    expect(text).toContain("Roll formula");
    expect(text).toContain("Official");
    expect(text).toContain("Campaign");
    expect(text).toContain("Players");
    expect(text).toContain("Curator only");
    expect(text).toContain("Pulled");
    expect(text).toContain("Not pulled");
    expect(text).toContain("revision c2-test");
  });

  it("requests customization for official pages and editing for owned pages", async () => {
    const events: OpenCodexPageDetail[] = [];
    window.addEventListener(OPEN_CODEX_PAGE, (event) => events.push((event as CustomEvent<OpenCodexPageDetail>).detail));
    await mount();

    await act(async () => button("Customize")!.click());
    await act(async () => button("Edit")!.click());

    expect(events).toEqual([
      { stem: official.stem, anchor: undefined, intent: "customize", campaignId: CAMPAIGN, pageId: official.id },
      { stem: campaign.stem, anchor: undefined, intent: "edit", campaignId: CAMPAIGN, pageId: campaign.id },
    ]);
  });
});

describe("built-in rules in the panel", () => {
  const builtIn: CampaignCodexPage = {
    id: "wte.species.oriyu",
    stem: "species-oriyu",
    title: "Oriyu",
    kind: "species",
    label: "Species",
    content: "# Oriyu\n\n| Type | Species |\n\n## Variants\n### Qerran",
    visibility: "player",
    pulled: false,
    source: "official",
    builtIn: true,
  };

  async function mountWith(builtInPages: CampaignCodexPage[], pages = [campaign, official]) {
    vi.mocked(buildCampaignCodexSnapshot).mockResolvedValue({
      schema: 1,
      campaignId: CAMPAIGN,
      campaignName: "Ashen Sun",
      revision: "c2-test",
      generatedAt: 1,
      rules: {} as never,
      ruleLayers: [],
      pages,
      builtIn: builtInPages,
    });
    await mount();
  }

  it("lists a compiled lineage the Curator has never uploaded", async () => {
    await mountWith([builtIn]);
    const text = host.textContent ?? "";
    expect(text).toContain("Oriyu");
    expect(text).toContain("Built-in");
    // "Not pulled" would read as broken; a built-in rule is already in force.
    expect(text).toContain("In force");
    expect(text).toContain("1 built-in");
  });

  it("offers Customize on it, carrying the official id to fork", async () => {
    const events: OpenCodexPageDetail[] = [];
    window.addEventListener(OPEN_CODEX_PAGE, (event) => events.push((event as CustomEvent<OpenCodexPageDetail>).detail));
    await mountWith([builtIn], []);

    await act(async () => button("Customize")!.click());
    expect(events).toEqual([
      { stem: "species-oriyu", anchor: undefined, intent: "customize", campaignId: CAMPAIGN, pageId: "wte.species.oriyu" },
    ]);
  });

  it("steps aside for a real page describing the same rule", async () => {
    // Someone uploaded the actual Oriyu MECHANICS page — pulled, typed, feeding
    // the catalogs. That is what creation reads, so it replaces the stand-in.
    // (Bare prose with the same id would NOT: live rules beat lore.)
    const uploaded: CampaignCodexPage = { ...builtIn, builtIn: undefined, content: "# Oriyu\n\n| Type | Species |", pulled: true };
    await mountWith([builtIn], [uploaded]);
    expect(host.querySelectorAll(".campaign-codex-page")).toHaveLength(1);
    expect(host.textContent).not.toContain("Built-in");
  });

  it("still says the Codex is empty when there is nothing at all", async () => {
    await mountWith([], []);
    expect(host.textContent).toContain("No Codex pages are connected");
  });
});

describe("quick links and section memory", () => {
  beforeEach(() => localStorage.clear());

  /** The pin toggle on a named row — groups are sorted, so "the first star" is
   *  whichever rule happens to sort first, not the one under test. */
  function star(title: string): HTMLButtonElement {
    const row = [...host.querySelectorAll(".campaign-codex-page")].find((article) =>
      article.querySelector(".campaign-codex-page-title")?.textContent?.trim() === title
    );
    return [...row!.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.trim() === "☆")!;
  }

  /** React tracks an input's value, so assigning `.value` and dispatching does
   *  nothing. Go through the native setter it patched. */
  function type(input: HTMLInputElement, value: string): void {
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }

  it("pins a rule onto the quick-link rail", async () => {
    await mount();
    expect(host.querySelector(".campaign-codex-pinned")).toBeNull();

    await act(async () => star("Ashen Evasion").click());
    const rail = host.querySelector(".campaign-codex-pinned");
    expect(rail?.textContent).toContain("Quick links");
    expect(rail?.textContent).toContain("Ashen Evasion");
  });

  it("opens a pinned rule straight into its editor", async () => {
    const events: OpenCodexPageDetail[] = [];
    window.addEventListener(OPEN_CODEX_PAGE, (event) => events.push((event as CustomEvent<OpenCodexPageDetail>).detail));
    await mount();
    await act(async () => star("Ashen Evasion").click());

    const pin = host.querySelector<HTMLButtonElement>(".campaign-codex-pin-open")!;
    await act(async () => pin.click());
    // The point of a quick link: one click to edit, not read-then-edit.
    expect(events[events.length - 1]).toMatchObject({ intent: "edit", pageId: campaign.id });
  });

  it("keeps pins across a remount", async () => {
    await mount();
    await act(async () => star("Ashen Evasion").click());
    await act(async () => root.unmount());

    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    await mount();
    expect(host.querySelector(".campaign-codex-pinned")?.textContent).toContain("Ashen Evasion");
  });

  it("remembers which sections were expanded", async () => {
    await mount();
    const group = host.querySelector<HTMLDetailsElement>(".campaign-codex-group")!;
    expect(group.open).toBe(false);

    await act(async () => {
      group.open = true;
      group.dispatchEvent(new Event("toggle"));
    });
    await act(async () => root.unmount());

    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    await mount();
    expect(host.querySelector<HTMLDetailsElement>(".campaign-codex-group")!.open).toBe(true);
  });

  it("expands everything while a filter is active", async () => {
    // A search that hides its own matches inside collapsed sections is useless.
    await mount();
    const input = host.querySelector<HTMLInputElement>(".campaign-codex-filter")!;
    await act(async () => type(input, "courier"));
    expect([...host.querySelectorAll<HTMLDetailsElement>(".campaign-codex-group")].every((d) => d.open)).toBe(true);
  });
});

describe("section ordering", () => {
  const page = (id: string, kind: string, label: string, title: string): CampaignCodexPage => ({
    id, stem: title, title, kind, label, content: `# ${title}`,
    visibility: "player", pulled: true, source: "official",
  });

  it("puts the rules a character is built from above everything else", () => {
    const groups = groupCampaignCodexPages([
      page("wte.page.a", "page", "Lore", "A History"),
      page("wte.cipher.b", "cipher", "Cipher", "Ashfall"),
      page("wte.species.c", "species", "Species", "Oriyu"),
      page("wte.paradigm.d", "paradigm", "Paradigm", "Warfare"),
      page("wte.background.e", "background", "Background", "Courier"),
    ]);
    expect(groups.map((g) => g.label)).toEqual(["Species", "Paradigm", "Background", "Cipher", "Lore"]);
  });

  it("sorts unknown labels alphabetically between the rules and the prose", () => {
    const groups = groupCampaignCodexPages([
      page("wte.page.a", "page", "Lore", "A History"),
      page("wte.page.z", "page", "Zephyr Rites", "Zephyr"),
      page("wte.page.m", "page", "Maps", "Atlas"),
      page("wte.species.c", "species", "Species", "Oriyu"),
    ]);
    expect(groups.map((g) => g.label)).toEqual(["Species", "Maps", "Zephyr Rites", "Lore"]);
  });

  it("keeps every rule of one kind in a single section", () => {
    // The whole point of dividers: one Species block, not species scattered
    // across sections because their pages were authored differently.
    const groups = groupCampaignCodexPages([
      page("wte.species.a", "species", "Species", "Oriyu"),
      page("campaign.t.species.b", "species", "Species", "Hyomen"),
      page("wte.species.c", "species", "Species", "Seraph"),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].pages).toHaveLength(3);
  });
});

describe("effective-only view — one entry per rule", () => {
  const builtInCognition: CampaignCodexPage = {
    id: "wte.paradigm.cognition",
    stem: "paradigm-cognition",
    title: "Cognition",
    kind: "paradigm",
    label: "Paradigm",
    content: "# Cognition\n\n| Type | Paradigm |",
    visibility: "player",
    pulled: false,
    source: "official",
    builtIn: true,
  };
  const article: CampaignCodexPage = {
    id: "wte.page.cognition",
    stem: "Cognition",
    title: "Cognition",
    kind: "page",
    label: "Paradigm",
    content: "# Cognition\n\nLore article about the paradigm.",
    visibility: "player",
    pulled: true,
    source: "official",
  };
  const fork: CampaignCodexPage = {
    id: `campaign.${CAMPAIGN}.paradigm.cognition`,
    stem: "paradigm-cognition",
    title: "Cognition",
    kind: "paradigm",
    content: "# Cognition\n\n| Type | Paradigm |\n| Name | Insight |",
    visibility: "player",
    pulled: true,
    source: "campaign",
    ownerId: CAMPAIGN,
    overrides: "wte.paradigm.cognition",
  };

  it("shows only the campaign fork when one exists", () => {
    const view = effectiveCampaignCodexView([article, fork], [builtInCognition]);
    const cognitions = view.filter((page) => page.title === "Cognition");
    expect(cognitions).toHaveLength(1);
    expect(cognitions[0].source).toBe("campaign");
  });

  it("shows the BUILT-IN over the article when there is no fork", () => {
    // The built-in is generated from the live catalog — its rows are exactly
    // what character creation offers. After the Seraph rework, showing the
    // article here meant Campaign Settings displayed pre-rework prose while
    // the creator offered the new innates and variants.
    const view = effectiveCampaignCodexView([article], [builtInCognition]);
    const cognitions = view.filter((page) => page.title === "Cognition");
    expect(cognitions).toHaveLength(1);
    expect(cognitions[0].id).toBe("wte.paradigm.cognition");
    expect(cognitions[0].builtIn).toBe(true);
  });

  it("shows the built-in when nothing else describes the rule", () => {
    const view = effectiveCampaignCodexView([], [builtInCognition]);
    expect(view).toEqual([builtInCognition]);
  });
});

describe("genus and cipher galleries group by domain and paradigm", () => {
  const genusPage = (name: string, domain: string): CampaignCodexPage => ({
    id: `wte.genus.${name.toLowerCase()}`,
    stem: `genus-${name.toLowerCase()}`,
    title: name,
    kind: "genus",
    label: "Genus",
    content: `# ${name}\n\n| Type | Genus |\n| Domain | ${domain} |`,
    visibility: "player",
    pulled: false,
    source: "official",
    builtIn: true,
  });
  const cipherPage = (name: string, paradigm: string): CampaignCodexPage => ({
    id: `wte.cipher.${name.toLowerCase()}`,
    stem: `cipher-${name.toLowerCase()}`,
    title: name,
    kind: "cipher",
    label: "Cipher",
    content: `# ${name}\n\n| Type | Cipher |\n| Paradigm | ${paradigm} |`,
    visibility: "player",
    pulled: false,
    source: "official",
    builtIn: true,
  });

  it("puts Neutral genus with Neutral, Photonic with Photonic", () => {
    const groups = groupCampaignCodexPages([
      genusPage("Hearth", "Neutral"),
      genusPage("Blitz", "Photonic"),
      genusPage("Deus", "Neutral"),
    ]);
    const labels = groups.map((group) => group.label);
    expect(labels).toContain("Genus · Neutral");
    expect(labels).toContain("Genus · Photonic");
    const neutral = groups.find((group) => group.label === "Genus · Neutral")!;
    expect(neutral.pages.map((page) => page.title).sort()).toEqual(["Deus", "Hearth"]);
  });

  it("puts each cipher suite under its paradigm", () => {
    const groups = groupCampaignCodexPages([
      cipherPage("SPYDER", "remnant"),
      cipherPage("MIND TWEAK", "cognition"),
    ]);
    expect(groups.map((group) => group.label)).toEqual(
      expect.arrayContaining(["Ciphers · Remnant", "Ciphers · Cognition"])
    );
  });

  it("nests incepts under one Incepts parent, one child per species pool", () => {
    const incept = (name: string, speciesId: string): CampaignCodexPage => ({
      id: `wte.incept.${speciesId}-${name.toLowerCase()}`,
      stem: `incept-${speciesId}-${name.toLowerCase()}`,
      title: name,
      kind: "incept",
      label: "Incept",
      content: `# ${name}

| Type | Incept |
| Species | ${speciesId} |`,
      visibility: "player",
      pulled: false,
      source: "official",
      builtIn: true,
    });
    const tree = campaignCodexSectionTree(
      groupCampaignCodexPages([incept("Sanction", "hyomen"), incept("Prodigy", "hyomen"), incept("Eldritch Mind", "inderi")])
    );
    const parent = tree.find((section) => section.label === "Incepts")!;
    expect(parent.count).toBe(3);
    expect(parent.children!.map((child) => child.label).sort()).toEqual(["Incepts · Hyomen", "Incepts · Inderi"]);
  });

  it("nests domains under one Genus parent and paradigms under one Ciphers parent", () => {
    const tree = campaignCodexSectionTree(
      groupCampaignCodexPages([
        genusPage("Hearth", "Neutral"),
        genusPage("Blitz", "Photonic"),
        cipherPage("SPYDER", "remnant"),
      ])
    );
    const genusParent = tree.find((section) => section.label === "Genus")!;
    expect(genusParent.count).toBe(2);
    expect(genusParent.children!.map((child) => child.label).sort()).toEqual(["Genus · Neutral", "Genus · Photonic"]);
    const cipherParent = tree.find((section) => section.label === "Ciphers")!;
    expect(cipherParent.children![0].label).toBe("Ciphers · Remnant");
    // No stray flat sections for the nested kinds.
    expect(tree.filter((section) => section.label.includes("·"))).toHaveLength(0);
  });

  it("a campaign fork of a genus groups with its domain, not in a separate bucket", () => {
    const forked: CampaignCodexPage = {
      ...genusPage("Hearth", "Neutral"),
      id: `campaign.${CAMPAIGN}.genus.hearth`,
      source: "campaign",
      builtIn: undefined,
      ownerId: CAMPAIGN,
      overrides: "wte.genus.hearth",
    };
    const groups = groupCampaignCodexPages([forked, genusPage("Deus", "Neutral")]);
    expect(groups).toHaveLength(1);
    expect(groups[0].label).toBe("Genus · Neutral");
    expect(groups[0].pages).toHaveLength(2);
  });
});
