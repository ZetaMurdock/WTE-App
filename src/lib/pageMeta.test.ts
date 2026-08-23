// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_PAGE_META, allPageMeta, getPageMeta, setPageMeta } from "./pageMeta";

const KEY = "wte-page-meta";
const PROTOTYPE_STEMS = ["Constructor", "constructor", "toString", "__proto__"] as const;

beforeEach(() => {
  localStorage.clear();
});

describe("Codex page metadata prototype-key safety", () => {
  it("uses the normal default for absent stems that match Object prototype names", () => {
    for (const stem of PROTOTYPE_STEMS) {
      const meta = getPageMeta(stem);
      expect(meta).toEqual(DEFAULT_PAGE_META);
      expect(typeof meta.pulled).toBe("boolean");
    }
  });

  it("preserves saved metadata for prototype-named stems", () => {
    localStorage.setItem(
      KEY,
      '{"Constructor":{"pulled":false,"visibility":"gm"},"toString":{"pulled":true,"visibility":"player"},"__proto__":{"pulled":false,"visibility":"player"}}'
    );

    const all = allPageMeta();
    expect(Object.getPrototypeOf(all)).toBeNull();
    expect(getPageMeta("Constructor", all)).toEqual({ pulled: false, visibility: "gm", label: undefined });
    expect(getPageMeta("toString", all)).toEqual({ pulled: true, visibility: "player", label: undefined });
    expect(getPageMeta("__proto__", all)).toEqual({ pulled: false, visibility: "player", label: undefined });
  });

  it("writes and reloads prototype-named stems as own JSON properties", () => {
    for (const stem of PROTOTYPE_STEMS) {
      setPageMeta(stem, { pulled: false, visibility: "gm", label: `Section ${stem}` });
    }

    const stored = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Record<string, unknown>;
    for (const stem of PROTOTYPE_STEMS) {
      expect(Object.prototype.hasOwnProperty.call(stored, stem)).toBe(true);
      const meta = getPageMeta(stem);
      expect(meta).toEqual({ pulled: false, visibility: "gm", label: `Section ${stem}` });
      expect(typeof meta.pulled).toBe("boolean");
    }
  });
});
