// @vitest-environment happy-dom
//
// Universal lookup: select a term anywhere, ask what it means here.
//
// The mouse plumbing is uninteresting; what matters is WHEN the offer appears.
// It has to be silent for ordinary prose, and — the one that would be a real
// leak — it must not appear for a player who selects the name of something only
// the Curator can see. A chip saying "Look up 'Warden's Gambit'" tells a player
// that Warden's Gambit exists, which is exactly what visibility is for.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { applyCodexPages, noCodexPages, __resetCodexService } from "../../game/codexService";
import { GENUS_DOMAIN_NAMES, getGenusDomain } from "../../game/wte";
import { LookUpSelection } from "./LookUpSelection";

const CAMPAIGN = "8a93a397-4c21-4a6e-9d0b-1f2e3a4b5c6d";
const first = getGenusDomain(GENUS_DOMAIN_NAMES[0])!.abilities[0];
const empty = { officialMirrors: [], campaignPages: [], campaignId: CAMPAIGN, skipped: [] };

let host: HTMLDivElement;

/** Pretend the user selected `text` and released the mouse. */
async function selectText(text: string) {
  vi.spyOn(window, "getSelection").mockReturnValue({
    toString: () => text,
    removeAllRanges: () => {},
  } as unknown as Selection);
  await act(async () => {
    document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, clientX: 10, clientY: 10 }));
  });
}

async function mount(curator: boolean) {
  localStorage.setItem("wte-curator", curator ? "1" : "0");
  host = document.createElement("div");
  document.body.appendChild(host);
  await act(async () => {
    createRoot(host).render(<LookUpSelection campaignId={CAMPAIGN} />);
  });
}

const chip = () => document.querySelector(".codex-lookup-chip");

beforeEach(() => {
  __resetCodexService();
  noCodexPages();
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("the offer appears only when there is an answer", () => {
  it("offers a lookup for a real ability name", async () => {
    await mount(true);
    await selectText(first.name);
    expect(chip()).not.toBeNull();
    expect(chip()!.textContent).toContain(first.name);
  });

  it("stays silent for ordinary prose", async () => {
    await mount(true);
    await selectText("the quick brown fox jumped over something");
    expect(chip()).toBeNull();
  });

  it("stays silent for a fragment too short to mean anything", async () => {
    await mount(true);
    await selectText("a");
    expect(chip()).toBeNull();
  });

  it("stays silent for a whole paragraph, even one containing a real term", async () => {
    await mount(true);
    await selectText(`${first.name} is an ability that appears in a long passage of prose which the reader has selected wholesale, and which is plainly not a term`);
    expect(chip()).toBeNull();
  });

  it("ignores trailing whitespace rather than treating it as length", async () => {
    await mount(true);
    await selectText(`  ${first.name}  `);
    expect(chip()).not.toBeNull();
  });

  it("finds an ability by its stable id too", async () => {
    await mount(true);
    await selectText(first.id!);
    expect(chip()).not.toBeNull();
  });
});

describe("it never tells a player what they may not see", () => {
  const secret = {
    ...empty,
    campaignPages: [{ stem: "Secret", title: "Warden's Gambit", visibility: "curator", data: { ss: 3 } }],
  };

  it("offers the lookup to a Curator", async () => {
    applyCodexPages(secret);
    await mount(true);
    await selectText("Warden's Gambit");
    expect(chip()).not.toBeNull();
  });

  it("offers NOTHING to a player — not even the chip", async () => {
    // The chip alone would reveal that the ability exists.
    applyCodexPages(secret);
    await mount(false);
    await selectText("Warden's Gambit");
    expect(chip(), "the chip leaked a Curator-only ability to a player").toBeNull();
  });
});

describe("the offer follows the campaign", () => {
  it("resolves a house rule for the campaign that owns it", async () => {
    applyCodexPages({
      ...empty,
      campaignPages: [{ stem: "H", title: "House Lark", overrides: first.id!, data: { ss: 1 } }],
    });
    await mount(true);
    await selectText("House Lark");
    expect(chip()).not.toBeNull();
  });

  it("does not resolve it for a different campaign", async () => {
    applyCodexPages({
      ...empty,
      campaignPages: [{ stem: "H", title: "House Lark", overrides: first.id!, data: { ss: 1 } }],
    });
    localStorage.setItem("wte-curator", "1");
    host = document.createElement("div");
    document.body.appendChild(host);
    await act(async () => {
      createRoot(host).render(<LookUpSelection campaignId="e25cc744-1111-2222-3333-444455556666" />);
    });
    await selectText("House Lark");
    expect(chip()).toBeNull();
  });
});

describe("card conventions", () => {
  it("contains no emoji or pictographs", async () => {
    await mount(true);
    await selectText(first.name);
    expect(chip()!.textContent).not.toMatch(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/u);
  });

  it("truncates a long selection rather than stretching off screen", async () => {
    // A term can be long; the chip should still be a chip.
    await mount(true);
    await selectText(first.name);
    expect(chip()!.textContent!.length).toBeLessThan(60);
  });
});
