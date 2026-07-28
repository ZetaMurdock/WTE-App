// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";

// getDb() refusing to open the database is the safety property; this is the
// honesty property. Without it the refusal renders as an empty app — every
// campaign, character and scene apparently gone — which reads as data loss.

let gate: unknown = null;
vi.mock("../lib/db", () => ({
  probeMigrationGate: async () => gate,
}));

const { BootGate } = await import("./BootGate");

let host: HTMLDivElement;
beforeEach(() => {
  gate = null;
  host = document.createElement("div");
  document.body.appendChild(host);
});

async function mount() {
  await act(async () => {
    createRoot(host).render(
      <BootGate>
        <p>the app</p>
      </BootGate>
    );
  });
  return host.innerHTML;
}

describe("the boot gate", () => {
  it("renders the app when there is nothing to report", async () => {
    expect(await mount()).toContain("the app");
  });

  it("renders the app when the backup succeeded", async () => {
    gate = { ok: true, reason: null, schema_version: 5 };
    expect(await mount()).toContain("the app");
  });

  it("replaces the app entirely when the backup failed", async () => {
    gate = { ok: false, reason: "the copy of wte.db-wal is 0 bytes but the original is 40960", schema_version: 5 };
    const html = await mount();
    expect(html).not.toContain("the app");
    expect(html).toContain("Your data was not opened");
  });

  it("shows the actual reason, not a generic apology", async () => {
    gate = { ok: false, reason: "Another copy of W.T.E is starting up or backing up.", schema_version: 5 };
    expect(await mount()).toContain("Another copy of W.T.E is starting up");
  });

  it("says plainly that nothing was changed", async () => {
    gate = { ok: false, reason: "disk full", schema_version: 5 };
    const html = await mount();
    expect(html).toMatch(/nothing was changed/i);
    expect(html).toMatch(/untouched/i);
  });

  it("offers a retry, because the usual cause is fixable without restarting", async () => {
    gate = { ok: false, reason: "busy", schema_version: 5 };
    expect(await mount()).toContain("Try again");
  });

  it("contains no emoji or pictographs", async () => {
    gate = { ok: false, reason: "busy", schema_version: 5 };
    expect(await mount()).not.toMatch(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/u);
  });
});
