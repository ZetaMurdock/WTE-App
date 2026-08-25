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

  it("requires a responding player to choose the Roll Axis source", async () => {
    const publish = vi.fn<(message: RollMessage) => void>();
    await act(async () => {
      root?.render(
        <VttRollFeed
          campaignId={null}
          publishRoll={publish}
          lock={{
            label: "Gravitic Snare — Physical Save — Evasion",
            requestId: "request-axis",
            choices: [
              { label: "Dexterity", expr: "1d20-1", detail: "DEX +2 + EV -3 = -1" },
              { label: "Balance", expr: "1d40+29", detail: "Balance +32 + EV -3 = +29" },
            ],
          }}
          onClearLock={() => {}}
          onClose={() => {}}
        />
      );
    });

    const input = host!.querySelector<HTMLInputElement>(".vtt2-roll-expr")!;
    expect(input.value).toBe("");
    const balance = [...host!.querySelectorAll<HTMLButtonElement>(".vtt2-requested-axis-choices button")]
      .find((button) => button.textContent?.includes("Balance"));
    expect(balance).toBeDefined();
    await act(async () => balance!.click());
    expect(input.value).toBe("1d40+29");

    const roll = [...host!.querySelectorAll<HTMLButtonElement>(".vtt2-roll-actions button")]
      .find((button) => button.textContent?.startsWith("Roll"));
    await act(async () => roll!.click());
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({
      requestId: "request-axis",
      baseExpr: "1d40+29",
      label: "Gravitic Snare — Physical Save — Evasion · Balance",
    }));
  });

  it("files a lock's own actor rather than the tray's when the Curator rolls a target's save", async () => {
    const publish = vi.fn<(message: RollMessage) => void>();
    await act(async () => {
      root?.render(
        <VttRollFeed
          campaignId={null}
          sessionKey="scope-lock-actor"
          actor={{ characterId: "caster-1", tokenId: "token-caster", name: "Inquisitor Vale" }}
          publishRoll={publish}
          lock={{
            label: "Kira — Physical Save",
            expr: "1d20+3",
            requestId: "request-target-save",
            actor: { characterId: "target-1", tokenId: "token-kira", name: "Kira" },
          }}
          onClearLock={() => {}}
          onClose={() => {}}
        />
      );
    });

    const roll = [...host!.querySelectorAll<HTMLButtonElement>(".vtt2-roll-actions button")]
      .find((button) => button.textContent?.startsWith("Roll"));
    await act(async () => roll!.click());
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({
      requestId: "request-target-save",
      actor: expect.objectContaining({ characterId: "target-1", tokenId: "token-kira", name: "Kira" }),
    }));
    expect(host!.querySelector(".vtt2-roll-who")?.textContent).toBe("Kira");
  });

  it("keeps the tray's own actor on a freeform roll", async () => {
    const publish = vi.fn<(message: RollMessage) => void>();
    await act(async () => {
      root?.render(
        <VttRollFeed
          campaignId={null}
          actor={{ characterId: "caster-1", tokenId: "token-caster", name: "Inquisitor Vale" }}
          publishRoll={publish}
          lock={null}
          onClearLock={() => {}}
          onClose={() => {}}
        />
      );
    });

    const roll = [...host!.querySelectorAll<HTMLButtonElement>(".vtt2-roll-actions button")]
      .find((button) => button.textContent?.startsWith("Roll"));
    await act(async () => roll!.click());
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({
      actor: expect.objectContaining({ characterId: "caster-1", name: "Inquisitor Vale" }),
    }));
  });
});
