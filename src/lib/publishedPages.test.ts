import { describe, expect, it } from "vitest";
import { isPublishableContent } from "./publishedPages";

// publishPage falls back to content: "" when the local page fails to load, and
// the old boot-time auto-refresh then wrote that blank over every install's local
// copy — while telling the publisher it had succeeded. Nothing empty may ever be
// applied over a real page.
describe("an empty published page can never overwrite a local one", () => {
  it("rejects empty, whitespace-only and non-string content", () => {
    for (const bad of ["", "   ", "\n\n", "\t", null, undefined, 0, false, {}, []]) {
      expect(isPublishableContent(bad), JSON.stringify(bad)).toBe(false);
    }
  });

  it("accepts real page content", () => {
    expect(isPublishableContent("# Pressure Engine\n\nSome rules.")).toBe(true);
    // A single meaningful character still counts.
    expect(isPublishableContent("x")).toBe(true);
  });
});
