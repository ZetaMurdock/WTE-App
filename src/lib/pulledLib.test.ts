import { describe, expect, it } from "vitest";
import { libStatus, stalePulled } from "./pulledLib";
import type { PublishedPage } from "./publishedPages";

const page = (stem: string, at: number): PublishedPage => ({ stem, title: stem, content: "x", at });

describe("libStatus", () => {
  it("never-imported pages are new", () => {
    expect(libStatus(page("a", 100), {})).toBe("new");
  });
  it("re-published pages are updated", () => {
    expect(libStatus(page("a", 200), { a: 100 })).toBe("updated");
  });
  it("unchanged pages are current", () => {
    expect(libStatus(page("a", 100), { a: 100 })).toBe("current");
  });
});

describe("stalePulled", () => {
  it("returns only the already-pulled pages that moved", () => {
    const pages = [page("new", 50), page("moved", 300), page("same", 100)];
    const out = stalePulled(pages, { moved: 100, same: 100 });
    expect(out.map((p) => p.stem)).toEqual(["moved"]);
  });
});
