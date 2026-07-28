// @vitest-environment happy-dom
//
// The character vault is gated behind isTauri(), so this screen cannot be reached
// in a browser preview. Server-rendering it is the strongest verification
// available without the desktop app: it proves the component mounts without
// throwing, shows the raw bytes it is supposed to preserve, and words the message
// as a read failure rather than as an empty character.
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { CorruptSheetNotice } from "./CorruptSheetNotice";

vi.mock("../../lib/characters", () => ({
  repairCharacterData: vi.fn(),
  resetCorruptCharacter: vi.fn(),
}));
vi.mock("../../lib/appToast", () => ({ pushToast: vi.fn() }));

const RAW = '{"attributes":{"phy":30},"rank":4,"not';

function render() {
  return renderToStaticMarkup(
    <CorruptSheetNotice
      id="bad"
      name="Truncated Row"
      raw={RAW}
      error="Unexpected end of JSON input"
      onBack={() => {}}
      onResolved={() => {}}
    />
  );
}

describe("the recovery screen", () => {
  it("renders without throwing", () => {
    expect(() => render()).not.toThrow();
  });

  it("names the character so the user knows which one is affected", () => {
    expect(render()).toContain("Truncated Row");
  });

  it("says the data could not be READ, not that the character is empty", () => {
    const html = render();
    expect(html).toContain("could not be read");
    // The distinction that matters: reassure that nothing was overwritten.
    expect(html.toLowerCase()).toMatch(/nothing has been changed|not been changed|stays that way/);
  });

  it("shows the raw stored bytes so they can be rescued", () => {
    // React escapes quotes in text content, so compare on a distinctive fragment.
    expect(render()).toContain("attributes");
    expect(render()).toContain("rank");
  });

  it("surfaces the parser's reason", () => {
    expect(render()).toContain("Unexpected end of JSON input");
  });

  it("offers copy, repair and reset", () => {
    const html = render();
    expect(html).toContain("Copy the stored data");
    expect(html).toContain("repair");
    expect(html).toContain("Reset");
  });

  it("uses only styled classes — no invented class names", () => {
    // danger-btn was invented once already and rendered unstyled.
    const html = render();
    expect(html).not.toContain("danger-btn");
    expect(html).toContain("icon-btn danger");
  });

  it("contains no emoji or pictographs, per the project convention", () => {
    expect(render()).not.toMatch(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/u);
  });

  it("handles an empty raw field without breaking", () => {
    const html = renderToStaticMarkup(
      <CorruptSheetNotice id="x" name="Empty" raw="" onBack={() => {}} onResolved={() => {}} />
    );
    expect(html).toContain("the field was empty");
  });
});
