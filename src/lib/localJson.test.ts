// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./appToast", () => ({ pushToast: vi.fn() }));

const { readJson, writeJson, removeJson, listQuarantined, isArray, isRecord } = await import("./localJson");
const { pushToast } = await import("./appToast");

beforeEach(() => {
  localStorage.clear();
  vi.mocked(pushToast).mockClear();
});

describe("absent is not corrupt", () => {
  it("returns the fallback quietly for a missing key", () => {
    const r = readJson("nope", [] as string[]);
    expect(r).toEqual({ value: [], corrupt: false });
    // A first run must not shout at the user.
    expect(pushToast).not.toHaveBeenCalled();
  });

  it("treats an explicitly empty string as absent", () => {
    localStorage.setItem("k", "");
    expect(readJson("k", { a: 1 })).toEqual({ value: { a: 1 }, corrupt: false });
    expect(pushToast).not.toHaveBeenCalled();
  });

  it("reads a good value straight through", () => {
    localStorage.setItem("k", JSON.stringify([1, 2, 3]));
    expect(readJson("k", [] as number[]).value).toEqual([1, 2, 3]);
  });
});

describe("corrupt content is quarantined, never overwritten", () => {
  it("moves unparseable text aside and reports it", () => {
    localStorage.setItem("desk", "{not json");
    const r = readJson("desk", [] as unknown[], { label: "campaign notes", now: 1000 });
    expect(r.corrupt).toBe(true);
    expect(r.value).toEqual([]);
    expect(r.quarantinedAs).toBe("desk.corrupt.1000");
    // The bytes survive, which is the whole point.
    expect(localStorage.getItem("desk.corrupt.1000")).toBe("{not json");
    expect(pushToast).toHaveBeenCalledOnce();
  });

  it("a later write cannot destroy the rescued copy", () => {
    localStorage.setItem("desk", "{not json");
    readJson("desk", [] as unknown[], { now: 1000 });
    // This is the read-then-write cycle that used to be destructive.
    writeJson("desk", [{ title: "new note" }]);
    expect(localStorage.getItem("desk.corrupt.1000")).toBe("{not json");
    expect(JSON.parse(localStorage.getItem("desk")!)).toEqual([{ title: "new note" }]);
  });

  it("does not re-quarantine over an existing rescue", () => {
    localStorage.setItem("k", "bad-one");
    readJson("k", null, { now: 500 });
    expect(localStorage.getItem("k.corrupt.500")).toBe("bad-one");
    // Same timestamp, different content: the first rescue must win.
    localStorage.setItem("k", "bad-two");
    readJson("k", null, { now: 500 });
    expect(localStorage.getItem("k.corrupt.500")).toBe("bad-one");
  });

  it("heals the original key so a second read is clean and silent", () => {
    localStorage.setItem("k", "{broken");
    const first = readJson("k", [] as unknown[], { now: 1 });
    expect(first.corrupt).toBe(true);
    vi.mocked(pushToast).mockClear();

    // Without healing, every render would quarantine again under a new timestamp,
    // filling storage with copies and re-toasting endlessly.
    const second = readJson("k", [] as unknown[], { now: 2 });
    expect(second.corrupt).toBe(false);
    expect(second.value).toEqual([]);
    expect(pushToast).not.toHaveBeenCalled();
    expect(localStorage.getItem("k.corrupt.2")).toBeNull();
    // The rescue from the first read is still there.
    expect(localStorage.getItem("k.corrupt.1")).toBe("{broken");
  });

  it("quarantines a value that parses but has the wrong shape", () => {
    // An object where an array belongs renders as empty just the same.
    localStorage.setItem("folders", JSON.stringify({ oops: true }));
    const r = readJson("folders", [] as unknown[], { validate: isArray, now: 7 });
    expect(r.corrupt).toBe(true);
    expect(localStorage.getItem("folders.corrupt.7")).toBe('{"oops":true}');
  });

  it("accepts a correctly shaped value with a validator present", () => {
    localStorage.setItem("m", JSON.stringify({ a: 1 }));
    const r = readJson("m", {}, { validate: isRecord });
    expect(r.corrupt).toBe(false);
    expect(r.value).toEqual({ a: 1 });
  });
});

describe("writes report failure instead of swallowing it", () => {
  it("returns ok on success", () => {
    expect(writeJson("k", { a: 1 })).toEqual({ ok: true });
  });

  it("reports a quota failure and tells the user", () => {
    const spy = vi.spyOn(localStorage, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError: quota exceeded");
    });
    const r = writeJson("k", { a: 1 }, { label: "desk notes" });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/quota/i);
    expect(pushToast).toHaveBeenCalledOnce();
    expect(vi.mocked(pushToast).mock.calls[0][0]).toMatch(/storage for W\.T\.E is full/);
    spy.mockRestore();
  });

  it("can stay silent when a caller wants to handle the failure itself", () => {
    const spy = vi.spyOn(localStorage, "setItem").mockImplementation(() => {
      throw new Error("nope");
    });
    expect(writeJson("k", 1, { silent: true }).ok).toBe(false);
    expect(pushToast).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("leaves the original key untouched when there is no room to quarantine", () => {
    localStorage.setItem("k", "{broken");
    const spy = vi.spyOn(localStorage, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    const r = readJson("k", null, { now: 9 });
    expect(r.corrupt).toBe(true);
    expect(r.quarantinedAs).toBeUndefined();
    spy.mockRestore();
    // Nothing was rescued, so the original must still be there to rescue later.
    expect(localStorage.getItem("k")).toBe("{broken");
  });
});

describe("quarantined copies are discoverable", () => {
  it("lists them newest first with their original key", () => {
    localStorage.setItem("a", "bad");
    readJson("a", null, { now: 100 });
    localStorage.setItem("b", "alsobad");
    readJson("b", null, { now: 200 });
    const q = listQuarantined();
    expect(q.map((x) => x.original)).toEqual(["b", "a"]);
    expect(q[0].at).toBe(200);
    expect(q[0].bytes).toBe("alsobad".length);
  });

  it("ignores ordinary keys", () => {
    localStorage.setItem("normal", "1");
    localStorage.setItem("wte-theme", "dark");
    expect(listQuarantined()).toEqual([]);
  });
});

describe("remove", () => {
  it("reports success", () => {
    localStorage.setItem("k", "1");
    expect(removeJson("k")).toEqual({ ok: true });
    expect(localStorage.getItem("k")).toBeNull();
  });
});
