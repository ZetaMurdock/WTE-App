// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildCampaignCodexSnapshot, type CampaignCodexPage } from "../lib/campaignCodex";
import { OPEN_CODEX_PAGE, type OpenCodexPageDetail } from "../lib/openCodexPage";
import { CampaignCodexPanel } from "./CampaignCodexPanel";

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
