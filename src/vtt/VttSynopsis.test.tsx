// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VttSynopsis } from "./VttSynopsis";
import { buildSynopsis, type SynopsisView } from "./data/synopsis";
import { emptySheet } from "../lib/sheetCodec";
import type { CharacterRecord } from "../lib/characters";
import type { CharacterSheet } from "../models/character";
import type { VttToken } from "./types/scene";

function viewOf(
  sheet: Partial<CharacterSheet> = {},
  token: Partial<VttToken> | null = { id: "t1" },
  net: { peerId?: string | null; purseShrives?: number | null } = { peerId: "peer-7" }
): SynopsisView {
  const rec: CharacterRecord = {
    id: "ch-1",
    campaignId: "camp-1",
    name: "Vex",
    createdAt: 1,
    updatedAt: 2,
    sheet: { ...emptySheet(), ...sheet },
  };
  const built = buildSynopsis({
    role: "host",
    record: rec,
    token: token ? ({ name: "Vex", x: 0, y: 0, size: 1, color: "#fff", visible: true, ...token } as VttToken) : null,
    ownerName: "Ada",
    ...net,
  });
  if (!built) throw new Error("the fixture must produce a view");
  return built;
}

const handlers = () => ({
  onGiveMoney: vi.fn(),
  onGiveItem: vi.fn(),
  onGiveHandout: vi.fn(),
  onTakeBackHandout: vi.fn(),
  onAddStatus: vi.fn(),
  onRemoveStatus: vi.fn(),
  onVision: vi.fn(),
  onOpenSheet: vi.fn(),
  onClose: vi.fn(),
});

let host: HTMLDivElement;
let root: Root;

async function mount(node: React.ReactNode) {
  await act(async () => {
    root.render(node);
  });
}

function q<T extends HTMLElement = HTMLElement>(sel: string): T {
  const el = host.querySelector<T>(sel);
  if (!el) throw new Error(`no ${sel} in ${host.innerHTML.slice(0, 400)}`);
  return el;
}

function byText(sel: string, text: string): HTMLElement {
  const found = [...host.querySelectorAll<HTMLElement>(sel)].find((e) => e.textContent?.trim().startsWith(text));
  if (!found) throw new Error(`no ${sel} reading "${text}"`);
  return found;
}

async function click(el: HTMLElement) {
  await act(async () => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

async function type(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")!.set!;
  await act(async () => {
    setter.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
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

describe("VttSynopsis", () => {
  it("hands over information with the title and body the Curator typed", async () => {
    const h = handlers();
    await mount(<VttSynopsis view={viewOf()} {...h} />);
    const inputs = [...host.querySelectorAll<HTMLInputElement>(".vtt2-syn-give input")];
    await type(inputs[0], "Torn ledger page");
    await type(q<HTMLTextAreaElement>(".vtt2-syn-text"), "…paid in Scrap.");
    await click(byText("button", "Hand it over"));
    expect(h.onGiveHandout).toHaveBeenCalledWith("Torn ledger page", "…paid in Scrap.");
  });

  it("gives an item with its count and weight", async () => {
    const h = handlers();
    await mount(<VttSynopsis view={viewOf()} {...h} />);
    await click(byText("button.chip", "Item"));
    await type(q<HTMLInputElement>(".vtt2-syn-give input"), "Torch");
    await type(q<HTMLInputElement>(".vtt2-syn-qty"), "3");
    await click(byText("button", "Give item"));
    expect(h.onGiveItem).toHaveBeenCalledWith({ name: "Torch", qty: 3, weight: "standard" });
  });

  it("gives money in the words a Curator says them, and a minus takes it back", async () => {
    const h = handlers();
    await mount(<VttSynopsis view={viewOf()} {...h} />);
    await click(byText("button.chip", "Money"));
    await type(q<HTMLInputElement>(".vtt2-syn-give input"), "2 Credits");
    await click(byText("button", "Give money"));
    expect(h.onGiveMoney).toHaveBeenCalledWith(
      expect.objectContaining({ ok: true, peerId: "peer-7", shrives: 20_000 })
    );
    await type(q<HTMLInputElement>(".vtt2-syn-give input"), "-500 sh");
    await click(byText("button", "Give money"));
    expect(h.onGiveMoney).toHaveBeenLastCalledWith(expect.objectContaining({ ok: true, shrives: -500 }));
  });

  it("shows the purse in W.T.E's own denominations, and says when it has none to show", async () => {
    const h = handlers();
    await mount(<VttSynopsis view={viewOf({}, { id: "t1" }, { peerId: "peer-7", purseShrives: 20_500 })} {...h} />);
    expect(byText(".vtt2-syn-coin", "2 Cr").textContent).toContain("500 Sh");
    // Null is not zero: an unheard-from device must not read as an empty purse.
    await mount(<VttSynopsis view={viewOf()} {...h} />);
    expect(host.textContent).toContain("not announced from their device");
  });

  it("will not take a money gift for a player who is not connected, and says why", async () => {
    // The grant is applied by the player's own client. With nobody there, an
    // enabled button would publish into an empty room and look like a payment.
    const h = handlers();
    await mount(<VttSynopsis view={viewOf({}, { id: "t1" }, { peerId: null })} {...h} />);
    await click(byText("button.chip", "Money"));
    expect(q<HTMLInputElement>(".vtt2-syn-give input").disabled).toBe(true);
    expect(byText("button", "Give money").hasAttribute("disabled")).toBe(true);
    expect(host.textContent).toContain("nobody is holding it at this table");
  });

  it("refuses to report a gift the Curator has not filled in", async () => {
    const h = handlers();
    await mount(<VttSynopsis view={viewOf()} {...h} />);
    await click(byText("button", "Hand it over"));
    expect(h.onGiveHandout).not.toHaveBeenCalled();
    await click(byText("button.chip", "Money"));
    await type(q<HTMLInputElement>(".vtt2-syn-give input"), "a fistful");
    await click(byText("button", "Give money"));
    // Money DOES report — the Curator is told what was wrong with the amount —
    // but it must never report a gift as sent.
    expect(h.onGiveMoney).toHaveBeenCalledWith({ ok: false, reason: expect.stringContaining("Type an amount") });
  });

  it("applies and removes a condition", async () => {
    const h = handlers();
    await mount(<VttSynopsis view={viewOf({}, { id: "t1", statuses: ["Bleeding"] })} {...h} />);
    await click(byText(".vtt2-syn-tag", "Bleeding"));
    expect(h.onRemoveStatus).toHaveBeenCalledWith("Bleeding");
    const field = [...host.querySelectorAll<HTMLInputElement>("input")].find((i) => i.placeholder.startsWith("Apply"))!;
    await type(field, "Dazzled");
    await click(byText("button", "Apply"));
    expect(h.onAddStatus).toHaveBeenCalledWith("Dazzled");
  });

  it("writes a vision radius once, on commit, clamped to the inspector's range", async () => {
    // Per-keystroke would make "12" two adjudications, two toasts and two undo
    // entries for one decision.
    const h = handlers();
    await mount(<VttSynopsis view={viewOf({}, { id: "t1", vision: 6 })} {...h} />);
    const field = q<HTMLInputElement>(".vtt2-syn-vision");
    await type(field, "1");
    await type(field, "12");
    expect(h.onVision).not.toHaveBeenCalled();
    await act(async () => {
      // React listens for focusout, not the non-bubbling blur event.
      field.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    });
    expect(h.onVision).toHaveBeenCalledTimes(1);
    expect(h.onVision).toHaveBeenCalledWith(12);
  });

  it("clamps a vision radius to the range the inspector allows", async () => {
    const h = handlers();
    await mount(<VttSynopsis view={viewOf({}, { id: "t1", vision: 6 })} {...h} />);
    const field = q<HTMLInputElement>(".vtt2-syn-vision");
    await type(field, "999");
    await act(async () => {
      field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    expect(h.onVision).toHaveBeenCalledWith(30);
  });

  it("disables the body's controls for a member who is not on this scene, and says why", async () => {
    // Statuses and vision live on a token. Gifts do not, which is the point: a
    // note can be handed to a player who has not even connected.
    const h = handlers();
    await mount(<VttSynopsis view={viewOf({}, null)} {...h} />);
    expect(host.textContent).toContain("Not on this scene");
    const field = [...host.querySelectorAll<HTMLInputElement>("input")].find((i) =>
      i.placeholder.startsWith("Needs a body")
    )!;
    expect(field.disabled).toBe(true);
    expect(q<HTMLInputElement>(".vtt2-syn-vision").disabled).toBe(true);
    const inputs = [...host.querySelectorAll<HTMLInputElement>(".vtt2-syn-give input")];
    await type(inputs[0], "A rumour");
    await click(byText("button", "Hand it over"));
    expect(h.onGiveHandout).toHaveBeenCalledWith("A rumour", "");
  });

  it("shows what they are carrying", async () => {
    const h = handlers();
    const view = viewOf({
      weaponLoadout: ["Paradigm Rifle"],
      equipment: [{ id: "e1", name: "Torch", weight: "light", equipped: false, mods: "", qty: 2 }],
    });
    await mount(<VttSynopsis view={view} {...h} />);
    expect(byText(".vtt2-syn-carry", "Paradigm Rifle")).toBeTruthy();
    expect(byText(".vtt2-syn-carry", "Torch").textContent).toContain("×2");
  });

  it("takes a handout back by identity", async () => {
    const h = handlers();
    const view = viewOf({ handouts: [{ id: "h1", title: "Torn ledger page", text: "", by: "The Curator", at: 1 }] });
    await mount(<VttSynopsis view={view} {...h} />);
    await click(byText(".vtt2-syn-tag", "Torn ledger page"));
    expect(h.onTakeBackHandout).toHaveBeenCalledWith("h1");
  });

  it("sends anything longer to the sheet instead of restating it", async () => {
    const h = handlers();
    await mount(<VttSynopsis view={viewOf()} {...h} />);
    await click(byText("button", "Open full sheet"));
    expect(h.onOpenSheet).toHaveBeenCalled();
  });
});
