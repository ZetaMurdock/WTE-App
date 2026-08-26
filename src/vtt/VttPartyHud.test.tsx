// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VttPartyHud } from "./VttPartyHud";
import { buildPartyHud, type PartyHudInput } from "./data/partyHud";
import type { VttToken } from "./types/scene";

const CELL = 50;

function token(over: Partial<VttToken> & { id: string }): VttToken {
  return { name: over.id, x: 0, y: 0, size: 1, color: "#fff", visible: true, ...over } as VttToken;
}

function hudFrom(over: Partial<PartyHudInput> = {}) {
  return buildPartyHud({
    tokens: [],
    roster: [],
    peers: [],
    selfId: "",
    hostId: "gm",
    selectedTokenId: null,
    cellPx: CELL,
    ...over,
  });
}

let host: HTMLDivElement;
let root: Root;

async function mount(node: React.ReactNode) {
  await act(async () => {
    root.render(node);
  });
}

function cards(): HTMLElement[] {
  return [...host.querySelectorAll<HTMLElement>(".vtt2-hud-card")];
}

function cardNamed(name: string): HTMLElement {
  const found = cards().find((c) => c.querySelector(".vtt2-hud-name")?.textContent === name);
  if (!found) throw new Error(`no card for ${name}; have ${cards().map((c) => c.textContent).join(" | ")}`);
  return found;
}

beforeEach(() => {
  document.body.innerHTML = "";
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
});

describe("VttPartyHud", () => {
  it("renders nothing at all when there is no party, rather than an empty frame over the map", async () => {
    await mount(<VttPartyHud hud={hudFrom()} />);
    expect(host.querySelector(".vtt2-hud")).toBeNull();
  });

  it("names the anchor so the distances have a stated origin", async () => {
    const hud = hudFrom({
      selfId: "gm",
      selectedTokenId: "g",
      tokens: [token({ id: "g", name: "Ghoul" }), token({ id: "k", name: "Kira", owner: "p1", x: CELL * 4 })],
    });
    await mount(<VttPartyHud hud={hud} />);
    expect(host.querySelector(".vtt2-hud-anchor")?.textContent).toContain("from Ghoul");
    expect(cardNamed("Kira").querySelector(".vtt2-hud-dist")?.textContent).toBe("20 ft");
  });

  it("says so instead of printing unlabelled numbers when nothing anchors the measurement", async () => {
    const hud = hudFrom({ selfId: "gm", tokens: [token({ id: "k", name: "Kira", owner: "p1" })] });
    await mount(<VttPartyHud hud={hud} />);
    expect(host.querySelector(".vtt2-hud-anchor")?.textContent).toContain("select a token");
    expect(cardNamed("Kira").querySelector(".vtt2-hud-dist")?.textContent).toBe("·");
  });

  it("shows damage taken and hides the figure entirely on an untouched member", async () => {
    const hud = hudFrom({
      tokens: [
        token({ id: "a", name: "Alia", owner: "p1", hp: 9, hpMax: 21 }),
        token({ id: "z", name: "Zara", owner: "p2", hp: 21, hpMax: 21 }),
      ],
    });
    await mount(<VttPartyHud hud={hud} />);
    expect(cardNamed("Alia").querySelector(".vtt2-hud-dmg")?.textContent).toBe("−12");
    expect(cardNamed("Alia").querySelector(".vtt2-hud-dmg")?.getAttribute("title")).toBe("9 / 21");
    expect(cardNamed("Zara").querySelector(".vtt2-hud-dmg")).toBeNull();
  });

  it("draws the wound bar from remaining vitality, banded", async () => {
    const hud = hudFrom({
      tokens: [
        token({ id: "a", name: "Alia", owner: "p1", hp: 5, hpMax: 20 }),
        token({ id: "z", name: "Zara", owner: "p2", hp: 20, hpMax: 20 }),
      ],
    });
    await mount(<VttPartyHud hud={hud} />);
    const alia = cardNamed("Alia").querySelector<HTMLElement>(".vtt2-hud-bar")!;
    expect(alia.className).toContain("bloodied");
    expect(alia.querySelector<HTMLElement>("i")!.style.width).toBe("25%");
    expect(cardNamed("Zara").querySelector(".vtt2-hud-bar")!.className).toContain("whole");
  });

  it("carries a pip per condition, uncoloured, with the Curator's own words in the tooltip", async () => {
    const hud = hudFrom({
      tokens: [token({ id: "a", name: "Alia", owner: "p1", statuses: ["Bleeding", "Prone"] })],
    });
    await mount(<VttPartyHud hud={hud} />);
    const pips = cardNamed("Alia").querySelector(".vtt2-hud-pips")!;
    expect(pips.querySelectorAll(".vtt2-hud-pip")).toHaveLength(2);
    expect(pips.getAttribute("title")).toBe("Bleeding, Prone");
  });

  it("caps the pips and counts the overflow rather than growing the card", async () => {
    const hud = hudFrom({
      tokens: [token({ id: "a", name: "Alia", owner: "p1", statuses: ["a", "b", "c", "d", "e", "f"] })],
    });
    await mount(<VttPartyHud hud={hud} />);
    const pips = cardNamed("Alia").querySelector(".vtt2-hud-pips")!;
    expect(pips.querySelectorAll(".vtt2-hud-pip")).toHaveLength(4);
    expect(pips.querySelector(".vtt2-hud-pipmore")?.textContent).toBe("+2");
  });

  it("marks an off-scene member and reads no vitals or distance off them", async () => {
    const hud = hudFrom({
      selfId: "gm",
      selectedTokenId: "k",
      tokens: [token({ id: "k", name: "Kira", owner: "p1", characterId: "c-kira", hp: 4, hpMax: 10 })],
      roster: [
        { charId: "c-kira", name: "Kira", ownerName: "Ada" },
        { charId: "c-bram", name: "Bram", ownerName: "Sam" },
      ],
    });
    await mount(<VttPartyHud hud={hud} />);
    const bram = cardNamed("Bram");
    expect(bram.className).toContain("off");
    expect(bram.querySelector(".vtt2-hud-noverit")?.textContent).toBe("off scene");
    expect(bram.querySelector(".vtt2-hud-dist")?.textContent).toBe("—");
    expect(bram.querySelector(".vtt2-hud-bar")).toBeNull();
  });
});

describe("VttPartyHud clicks", () => {
  const hud = () =>
    hudFrom({
      selfId: "p1",
      tokens: [
        token({ id: "k", name: "Kira", owner: "p1", characterId: "c-kira" }),
        token({ id: "b", name: "Bram", owner: "p2", characterId: "c-bram", x: CELL * 3 }),
      ],
    });

  it("gives a player camera focus and nothing else — no reach into another player's sheet", async () => {
    const onFocusToken = vi.fn();
    await mount(<VttPartyHud hud={hud()} onFocusToken={onFocusToken} />);
    await act(async () => {
      cardNamed("Bram").click();
    });
    expect(onFocusToken).toHaveBeenCalledWith("b");
  });

  it("opens the synopsis for the Curator, who is the only caller handed that callback", async () => {
    const onOpenSynopsis = vi.fn();
    const onFocusToken = vi.fn();
    await mount(<VttPartyHud hud={hud()} onOpenSynopsis={onOpenSynopsis} onFocusToken={onFocusToken} />);
    await act(async () => {
      cardNamed("Bram").click();
    });
    expect(onOpenSynopsis).toHaveBeenCalledWith("c-bram");
    expect(onFocusToken).toHaveBeenCalledWith("b");
  });

  it("focuses an off-scene member's absent body on nobody", async () => {
    const onOpenSynopsis = vi.fn();
    const onFocusToken = vi.fn();
    const offScene = hudFrom({ roster: [{ charId: "c-bram", name: "Bram", ownerName: "Sam" }] });
    await mount(<VttPartyHud hud={offScene} onOpenSynopsis={onOpenSynopsis} onFocusToken={onFocusToken} />);
    await act(async () => {
      cardNamed("Bram").click();
    });
    expect(onFocusToken).not.toHaveBeenCalled();
    expect(onOpenSynopsis).toHaveBeenCalledWith("c-bram");
  });

  it("renders a card with nothing to do as a plain element, so no dead buttons reach a player", async () => {
    const offScene = hudFrom({ roster: [{ charId: "c-bram", name: "Bram", ownerName: "Sam" }] });
    await mount(<VttPartyHud hud={offScene} />);
    expect(cardNamed("Bram").tagName).toBe("DIV");
    expect(cardNamed("Bram").className).toContain("inert");
  });
});
