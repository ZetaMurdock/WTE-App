// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { OPEN_CODEX_PAGE, onOpenCodexPage, openCodexPage, type OpenCodexPageDetail } from "./openCodexPage";

beforeEach(() => vi.restoreAllMocks());

describe("open Codex page navigation", () => {
  it("keeps the legacy stem and anchor API read-only by default", () => {
    const seen: OpenCodexPageDetail[] = [];
    const stop = onOpenCodexPage((detail) => seen.push(detail));
    openCodexPage("Species", "humanity");
    stop();
    expect(seen).toEqual([{ stem: "Species", anchor: "humanity" }]);
  });

  it("carries campaign edit intent and stable identity", () => {
    const seen = vi.fn();
    const stop = onOpenCodexPage(seen);
    openCodexPage("Ashen_Lark", undefined, {
      intent: "edit",
      campaignId: "ashen-sun",
      pageId: "campaign.ashen-sun.genus.lark",
    });
    stop();
    expect(seen).toHaveBeenCalledWith({
      stem: "Ashen_Lark",
      anchor: undefined,
      intent: "edit",
      campaignId: "ashen-sun",
      pageId: "campaign.ashen-sun.genus.lark",
    });
  });

  it("ignores malformed events and removes subscriptions", () => {
    const seen = vi.fn();
    const stop = onOpenCodexPage(seen);
    window.dispatchEvent(new CustomEvent(OPEN_CODEX_PAGE, { detail: { stem: "" } }));
    expect(seen).not.toHaveBeenCalled();
    stop();
    openCodexPage("Backgrounds");
    expect(seen).not.toHaveBeenCalled();
  });
});
