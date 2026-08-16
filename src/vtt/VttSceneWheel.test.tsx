// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { newScene } from "./types/scene";
import { VttSceneWheel } from "./VttSceneWheel";

let root: Root | null = null;
let host: HTMLDivElement | null = null;

beforeEach(() => {
  document.body.innerHTML = "";
  localStorage.clear();
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

describe("VttSceneWheel touch controls", () => {
  it("opens every scene action from the visible overflow button", async () => {
    const scene = newScene("campaign-1", "Moonlit Ruins");
    const pin = vi.fn();
    await act(async () => {
      root?.render(
        <VttSceneWheel
          scenes={[scene]}
          activeId={scene.id}
          onSwitch={() => {}}
          onStep={() => {}}
          onSetBackground={() => {}}
          onSetMusic={() => {}}
          onClearMusic={() => {}}
          onOpenSettings={() => {}}
          onOpenSoundboard={() => {}}
          onOpenDialogue={() => {}}
          onSetActiveForEveryone={pin}
          pinnedId={null}
          onReleasePin={() => {}}
          onSetFolder={() => {}}
          playerCount={1}
        />
      );
    });

    const more = document.querySelector<HTMLButtonElement>("[aria-label='Scene tools for Moonlit Ruins']");
    expect(more).not.toBeNull();
    await act(async () => more!.click());

    const pinButton = [...document.querySelectorAll<HTMLButtonElement>(".vtt2-scene-menu button")]
      .find((button) => button.textContent?.includes("Pin for everyone"));
    expect(pinButton).toBeDefined();
    await act(async () => pinButton!.click());
    expect(pin).toHaveBeenCalledWith(scene.id);
  });
});
