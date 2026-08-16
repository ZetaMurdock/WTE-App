// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../net/NetContext", () => ({
  useNet: () => ({ selfId: "player-1", status: "idle", publish: vi.fn() }),
}));

import type { RollMessage } from "../net/protocol";
import { VttRollFeed } from "./VttRollFeed";

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
  host?.remove();
  root = null;
  host = null;
});

describe("VttRollFeed touch controls", () => {
  it("offers direct disadvantage and advantage buttons without mouse modifiers", async () => {
    const publish = vi.fn<(message: RollMessage) => void>();
    await act(async () => {
      root?.render(
        <VttRollFeed
          campaignId={null}
          publishRoll={publish}
          lock={null}
          onClearLock={() => {}}
          onClose={() => {}}
        />
      );
    });

    const buttons = [...host!.querySelectorAll<HTMLButtonElement>(".vtt2-roll-actions button")];
    const dis = buttons.find((button) => button.textContent?.trim() === "Dis");
    const adv = buttons.find((button) => button.textContent?.trim() === "Adv");
    expect(dis).toBeDefined();
    expect(adv).toBeDefined();

    await act(async () => dis!.click());
    await act(async () => adv!.click());
    expect(publish.mock.calls.map(([message]) => message.mode)).toEqual(["dis", "adv"]);
  });
});
