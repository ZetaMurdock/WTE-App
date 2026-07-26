import { beforeEach, describe, expect, it } from "vitest";

// Storage-backed and browser-free, so stub the one API these functions use.
const store = new Map<string, string>();
(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
};

const { getFirebaseConfigRaw, saveFirebaseConfig, usingCustomFirebaseConfig, getFirebaseConfig } = await import("./tauri");

const KEY = "wte-fb-config";

describe("shared-library config", () => {
  beforeEach(() => store.clear());

  it("shows the built-in config when nothing is overridden", () => {
    // It used to return "" here, so the settings box rendered BLANK on the
    // default — which looks unconfigured and invites re-pasting the very config
    // already baked in. That is what this guards.
    const raw = getFirebaseConfigRaw();
    expect(raw).not.toBe("");
    expect(raw).toContain("codexlib-b81bf");
    expect(usingCustomFirebaseConfig()).toBe(false);
  });

  it("treats pasting the built-in config as using the built-in config", () => {
    const err = saveFirebaseConfig(getFirebaseConfigRaw());
    expect(err).toBeNull();
    // No redundant copy is stored, so the two can never drift apart.
    expect(store.has(KEY)).toBe(false);
    expect(usingCustomFirebaseConfig()).toBe(false);
  });

  it("stores a genuinely different project as an override", () => {
    const mine = JSON.stringify({
      apiKey: "x",
      projectId: "my-table",
      databaseURL: "https://my-table-default-rtdb.firebaseio.com",
    });
    expect(saveFirebaseConfig(mine)).toBeNull();
    expect(usingCustomFirebaseConfig()).toBe(true);
    expect(getFirebaseConfig()?.projectId).toBe("my-table");
    expect(getFirebaseConfigRaw()).toContain("my-table");
  });

  it("clearing the box goes back to the built-in one", () => {
    saveFirebaseConfig(JSON.stringify({ projectId: "p", databaseURL: "https://p.firebaseio.com" }));
    expect(usingCustomFirebaseConfig()).toBe(true);
    expect(saveFirebaseConfig("   ")).toBeNull();
    expect(usingCustomFirebaseConfig()).toBe(false);
    expect(getFirebaseConfigRaw()).toContain("codexlib-b81bf");
  });

  it("explains a bad paste instead of silently storing junk", () => {
    expect(saveFirebaseConfig("not a config")).toBeTruthy();
    expect(saveFirebaseConfig(JSON.stringify({ projectId: "p" }))).toContain("databaseURL");
    expect(store.has(KEY)).toBe(false);
  });

  it("tolerates a console snippet with unquoted keys", () => {
    const snippet = 'const firebaseConfig = { projectId: "p", databaseURL: "https://p.firebaseio.com" };';
    expect(saveFirebaseConfig(snippet)).toBeNull();
    expect(getFirebaseConfig()?.projectId).toBe("p");
  });

  it("falls back to the built-in config if the stored blob is corrupt", () => {
    store.set(KEY, "{not json");
    expect(getFirebaseConfig()?.projectId).toBe("codexlib-b81bf");
  });
});
