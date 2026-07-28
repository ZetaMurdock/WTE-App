// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  __resetSaveQueue,
  flushAll,
  hasPendingSaves,
  installSaveGuards,
  pendingLabels,
  registerSaver,
  saveErrorMessage,
  saveState,
  subscribeSaveState,
} from "./saveQueue";

beforeEach(() => __resetSaveQueue());

describe("outstanding work is observable", () => {
  it("starts idle with nothing registered", () => {
    expect(saveState()).toBe("idle");
    expect(hasPendingSaves()).toBe(false);
  });

  it("reports pending once a saver marks work, and names it", () => {
    const s = registerSaver("this character", () => {});
    expect(saveState()).toBe("idle");
    s.markPending();
    expect(saveState()).toBe("pending");
    expect(pendingLabels()).toEqual(["this character"]);
  });

  it("returns to idle when the write lands", () => {
    const s = registerSaver("a scene", () => {});
    s.markPending();
    s.markSaved();
    expect(saveState()).toBe("idle");
    expect(hasPendingSaves()).toBe(false);
  });

  it("reports failure with the reason", () => {
    const s = registerSaver("a scene", () => {});
    s.markPending();
    s.markFailed("disk full");
    expect(saveState()).toBe("failed");
    expect(saveErrorMessage()).toBe("disk full");
  });

  it("clears a previous failure once something saves successfully", () => {
    const s = registerSaver("x", () => {});
    s.markPending();
    s.markFailed("nope");
    expect(saveState()).toBe("failed");
    s.markPending();
    s.markSaved();
    expect(saveState()).toBe("idle");
  });

  it("notifies subscribers so the indicator re-renders", () => {
    const cb = vi.fn();
    const un = subscribeSaveState(cb);
    const s = registerSaver("x", () => {});
    s.markPending();
    expect(cb).toHaveBeenCalled();
    un();
  });

  it("drops a saver on unregister", () => {
    const s = registerSaver("gone", () => {});
    s.markPending();
    expect(hasPendingSaves()).toBe(true);
    s.unregister();
    expect(hasPendingSaves()).toBe(false);
  });
});

describe("flushAll persists everything outstanding", () => {
  it("calls every registered flush", async () => {
    const a = vi.fn();
    const b = vi.fn();
    registerSaver("a", a);
    registerSaver("b", b);
    await flushAll();
    expect(a).toHaveBeenCalledOnce();
    expect(b).toHaveBeenCalledOnce();
  });

  it("awaits async flushes rather than firing and forgetting", async () => {
    let landed = false;
    registerSaver("slow", async () => {
      await new Promise((r) => setTimeout(r, 20));
      landed = true;
    });
    await flushAll();
    // This is the whole point: before this existed, app close dropped the write.
    expect(landed).toBe(true);
  });

  it("one failing saver does not stop the others", async () => {
    const good = vi.fn();
    registerSaver("bad", () => {
      throw new Error("boom");
    });
    registerSaver("good", good);
    await expect(flushAll()).resolves.toBeUndefined();
    expect(good).toHaveBeenCalledOnce();
    expect(saveState()).toBe("failed");
    expect(saveErrorMessage()).toContain("boom");
  });

  it("is safe with nothing registered", async () => {
    await expect(flushAll()).resolves.toBeUndefined();
  });
});

describe("the close paths are guarded", () => {
  it("flushes on beforeunload when work is outstanding", async () => {
    const flush = vi.fn();
    const s = registerSaver("sheet", flush);
    s.markPending();
    installSaveGuards();
    window.dispatchEvent(new Event("beforeunload"));
    await Promise.resolve();
    expect(flush).toHaveBeenCalled();
  });

  it("does not flush on beforeunload when everything is already written", async () => {
    const flush = vi.fn();
    registerSaver("sheet", flush);
    installSaveGuards();
    window.dispatchEvent(new Event("beforeunload"));
    await Promise.resolve();
    expect(flush).not.toHaveBeenCalled();
  });

  it("installs only once even if called repeatedly", async () => {
    const flush = vi.fn();
    const s = registerSaver("sheet", flush);
    s.markPending();
    installSaveGuards();
    installSaveGuards();
    installSaveGuards();
    window.dispatchEvent(new Event("beforeunload"));
    await Promise.resolve();
    // Three installs would mean three flushes per event.
    expect(flush).toHaveBeenCalledOnce();
  });
});
