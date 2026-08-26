// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { VttRollPrompt, type RollPromptSource } from "./VttRollPrompt";
import type { RollLock } from "./rollCommit";
import type { RollMode } from "../game/wte";

let root: Root | null = null;
let host: HTMLDivElement | null = null;

beforeEach(() => {
  document.body.innerHTML = "";
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root?.unmount());
  vi.useRealTimers();
  host?.remove();
  root = null;
  host = null;
});

type Handlers = {
  onRoll: ReturnType<typeof vi.fn<(lock: RollLock, source: RollPromptSource | null, mode: RollMode) => void>>;
  onDismiss: ReturnType<typeof vi.fn<(lock: RollLock) => void>>;
  onDrop: ReturnType<typeof vi.fn<(lock: RollLock) => void>>;
  onOpenTray: ReturnType<typeof vi.fn<() => void>>;
};

function handlers(): Handlers {
  return { onRoll: vi.fn(), onDismiss: vi.fn(), onDrop: vi.fn(), onOpenTray: vi.fn() };
}

async function mount(requests: RollLock[], h: Handlers) {
  await act(async () => {
    root?.render(<VttRollPrompt requests={requests} {...h} />);
  });
}

const cards = () => [...host!.querySelectorAll<HTMLElement>(".vtt2-rollprompt")];
const rollButtons = (card: HTMLElement) =>
  [...card.querySelectorAll<HTMLButtonElement>(".vtt2-rollprompt-choices button, .vtt2-rollprompt-go")];

const axisRequest: RollLock = {
  label: "Gravitic Snare — Physical Save",
  requestId: "req-axis",
  requestedBy: "Curator",
  dc: 18,
  choices: [
    { label: "Dexterity", expr: "1d20-1", detail: "DEX +2 + EV -3 = -1" },
    { label: "Balance", expr: "1d40+29", detail: "Balance +32 + EV -3 = +29" },
  ],
};

describe("VttRollPrompt", () => {
  it("shows nothing at all when no request is outstanding", async () => {
    const h = handlers();
    await mount([], h);
    expect(host!.querySelector(".vtt2-rollprompts")).toBeNull();
  });

  it("offers BOTH Roll Axis sources, and the source choice is itself the roll", async () => {
    const h = handlers();
    await mount([axisRequest], h);

    const buttons = rollButtons(cards()[0]);
    expect(buttons.map((button) => button.textContent)).toEqual([
      "Roll DexterityDEX +2 + EV -3 = -1",
      "Roll BalanceBalance +32 + EV -3 = +29",
    ]);

    // One press: no "select the source, now press Roll" second step exists.
    await act(async () => buttons[1].click());
    expect(h.onRoll).toHaveBeenCalledTimes(1);
    expect(h.onRoll.mock.calls[0][0].requestId).toBe("req-axis");
    expect(h.onRoll.mock.calls[0][1]).toEqual(axisRequest.choices![1]);
    expect(h.onRoll.mock.calls[0][2]).toBe("normal");
  });

  it("shows the DV being rolled against", async () => {
    const h = handlers();
    await mount([axisRequest], h);
    expect(cards()[0].querySelector(".vtt2-rollprompt-dv")!.textContent).toBe("vs DV 18");
  });

  it("keeps every outstanding request answerable, not only the newest", async () => {
    const h = handlers();
    const queue: RollLock[] = [
      { label: "Second ask", expr: "1d20+4", requestId: "req-2", requestedBy: "Curator" },
      { label: "First ask", expr: "1d20+1", requestId: "req-1", requestedBy: "Curator" },
      { label: "Third ask", expr: "1d20+7", requestId: "req-3", requestedBy: "Curator" },
    ];
    await mount(queue, h);

    expect(cards()).toHaveLength(3);
    expect(host!.querySelector(".vtt2-rollprompt-count")!.textContent).toBe("3 rolls are waiting on you");

    // The middle card answers ITS OWN request, not the head of the queue.
    await act(async () => rollButtons(cards()[1])[0].click());
    expect(h.onRoll.mock.calls[0][0].requestId).toBe("req-1");
  });

  it("ignores an ability-armed lock: only a request is a question", async () => {
    const h = handlers();
    await mount([{ label: "Power Check", expr: "1d20+4" }], h);
    expect(host!.querySelector(".vtt2-rollprompts")).toBeNull();
  });

  it("names the body a Curator is answering for instead of pretending someone asked", async () => {
    const h = handlers();
    await mount(
      [{ label: "Warden — Physical Save", expr: "1d20+3", requestId: "req-local", actor: { name: "Warden" } }],
      h
    );
    expect(cards()[0].querySelector(".vtt2-rollprompt-from")!.textContent).toBe("You are rolling for Warden");
  });

  it("dismissal hides the card WITHOUT discarding the request", async () => {
    const h = handlers();
    const queue: RollLock[] = [axisRequest, { label: "Other ask", expr: "1d20", requestId: "req-other" }];
    await mount(queue, h);

    const close = cards()[0].querySelector<HTMLButtonElement>(".cdx-tab-x")!;
    await act(async () => close.click());

    expect(h.onDismiss).toHaveBeenCalledTimes(1);
    // onDrop is what actually removes a lock from the queue; dismissal is not
    // allowed to reach for it, or a closed prompt would lose the roll.
    expect(h.onDrop).not.toHaveBeenCalled();

    // Still in `requests` — the dice tray keeps it — but off the prompt stack,
    // and the sibling request is untouched.
    await mount(queue, h);
    expect(cards()).toHaveLength(1);
    expect(cards()[0].querySelector(".vtt2-rollprompt-label")!.textContent).toBe("Other ask");

    const tray = host!.querySelector<HTMLButtonElement>(".vtt2-rollprompt-tray")!;
    await act(async () => tray.click());
    expect(h.onOpenTray).toHaveBeenCalledTimes(1);
  });

  it("says an expired request expired rather than offering dice nobody reads", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    const h = handlers();
    const expiring: RollLock = {
      label: "Reflex — Evasion",
      expr: "1d20+2",
      requestId: "req-expiring",
      requestedBy: "Curator",
      expiresAt: 1_000_000 + 3_000,
    };
    await mount([expiring], h);

    expect(cards()[0].className).not.toContain("expired");
    expect(cards()[0].querySelector(".vtt2-rollprompt-clock")!.textContent).toBe("0:03 left");

    await act(async () => {
      vi.advanceTimersByTime(4_000);
    });

    const card = cards()[0];
    expect(card.className).toContain("expired");
    expect(card.querySelector(".vtt2-rollprompt-clock")!.textContent).toBe("expired");
    expect(card.querySelector(".vtt2-rollprompt-dead")!.textContent).toContain("timed out");
    expect(rollButtons(card).map((button) => button.textContent)).toEqual(["Discard"]);

    await act(async () => rollButtons(card)[0].click());
    expect(h.onRoll).not.toHaveBeenCalled();
    // An expired request has nothing left to answer, so this one really is gone.
    expect(h.onDrop).toHaveBeenCalledTimes(1);
    expect(h.onDrop.mock.calls[0][0].requestId).toBe("req-expiring");
  });

  it("carries the tray's own posture modifiers into a requested roll", async () => {
    const h = handlers();
    await mount([{ label: "Reflex", expr: "1d20+2", requestId: "req-mode" }], h);

    const button = rollButtons(cards()[0])[0];
    await act(async () => button.dispatchEvent(new MouseEvent("click", { bubbles: true, shiftKey: true })));
    await act(async () => button.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true })));
    // The tray's keyboard route to Disadvantage, for anyone whose pointer has no
    // right button — a trackpad, or a tablet.
    await act(async () => button.dispatchEvent(new MouseEvent("click", { bubbles: true, ctrlKey: true })));
    await act(async () => button.dispatchEvent(new MouseEvent("click", { bubbles: true, altKey: true })));

    expect(h.onRoll.mock.calls.map(([, , mode]) => mode)).toEqual(["adv", "dis", "dis", "dis"]);
  });

  it("counts the remaining second down rather than off, so 2.5s left never reads 0:02", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    const h = handlers();
    await mount([{ label: "Reflex", expr: "1d20", requestId: "req-round", expiresAt: 1_000_000 + 2_500 }], h);
    // There are still three seconds on the table's clock; rounding down would
    // start the card a whole second behind the Curator's own countdown.
    expect(cards()[0].querySelector(".vtt2-rollprompt-clock")!.textContent).toBe("0:03 left");
  });

  it("Escape closes the card the player is already inside, and only that card", async () => {
    const h = handlers();
    const queue: RollLock[] = [axisRequest, { label: "Other ask", expr: "1d20", requestId: "req-other" }];
    await mount(queue, h);

    await act(async () => {
      rollButtons(cards()[0])[0].dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });

    expect(h.onDismiss).toHaveBeenCalledTimes(1);
    expect(h.onDismiss.mock.calls[0][0].requestId).toBe("req-axis");
    // Escape is a dismissal, never a discard: the request is still the tray's.
    expect(h.onDrop).not.toHaveBeenCalled();
    expect(cards()).toHaveLength(1);
    expect(cards()[0].querySelector(".vtt2-rollprompt-label")!.textContent).toBe("Other ask");
  });

  it("a request that is dismissed, settled, then asked again comes back", async () => {
    const h = handlers();
    await mount([axisRequest], h);
    await act(async () => cards()[0].querySelector<HTMLButtonElement>(".cdx-tab-x")!.click());
    expect(cards()).toHaveLength(0);

    // The Curator's request leaves the queue — answered in the tray, or dropped.
    await mount([], h);
    // ...and they ask for the same save again. A dismissal that outlived its
    // request would swallow the second ask in silence.
    await mount([axisRequest], h);
    expect(cards()).toHaveLength(1);
  });
});
