// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildCampaignCodexSnapshot, type CampaignCodexPage } from "../lib/campaignCodex";
import { OPEN_CODEX_PAGE, type OpenCodexPageDetail } from "../lib/openCodexPage";
import { CampaignCodexPanel, groupCampaignCodexPages } from "./CampaignCodexPanel";

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
    // Someone uploaded the actual Oriyu article. That is the better record, and
    // showing both would be one lineage listed twice.
    const uploaded: CampaignCodexPage = { ...builtIn, builtIn: undefined, content: "# Oriyu (uploaded)", pulled: true };
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
