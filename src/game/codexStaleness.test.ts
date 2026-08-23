// @vitest-environment happy-dom
//
// The staleness family: four ways a consumer kept serving an answer the Codex
// had already replaced.
import { beforeEach, describe, expect, it } from "vitest";
import {
  applyCodexPages,
  beginCodexLoad,
  codexLoadIsCurrent,
  codexRegistry,
  codexRevision,
  codexStatus,
  noCodexPages,
  __resetCodexService,
} from "./codexService";
import { codexCtx } from "./resolvedGenus";
import { GENUS_DOMAIN_NAMES, getGenusDomain } from "./wte";

const CAMPAIGN = "8a93a397-4c21-4a6e-9d0b-1f2e3a4b5c6d";
const first = getGenusDomain(GENUS_DOMAIN_NAMES[0])!.abilities[0];
const empty = { officialMirrors: [], campaignPages: [], campaignId: CAMPAIGN, skipped: [] };
const override = (ss: number) => ({
  ...empty,
  campaignPages: [{ stem: "H", title: "House", overrides: first.id!, data: { ss } }],
});

beforeEach(() => __resetCodexService());

describe("the revision changes even when the status does not", () => {
  it("advances on every applied pass", () => {
    noCodexPages();
    const a = codexRevision();
    applyCodexPages(override(1));
    const b = codexRevision();
    expect(b).toBeGreaterThan(a);
  });

  it("advances across a ready -> ready reload that changed the answer", () => {
    // This is the case status alone cannot express, and the one that left open
    // cards and migration plans showing a definition that no longer applied.
    applyCodexPages(override(1));
    expect(codexStatus()).toBe("ready");
    const before = codexRevision();

    applyCodexPages(override(4));
    expect(codexStatus()).toBe("ready");
    expect(codexRevision(), "the status stayed ready and nothing signalled a change").toBeGreaterThan(before);
  });

  it("and the registry really did change under it", () => {
    applyCodexPages(override(1));
    const ctx = { ...codexCtx(CAMPAIGN, "c1"), role: "curator" as const };
    const ssNow = () => {
      const r = codexRegistry().resolveReference(first.id!, ctx);
      return r && r.ambiguous === false ? (r.resolvedDefinition.data as { ss: number }).ss : null;
    };
    expect(ssNow()).toBe(1);
    applyCodexPages(override(4));
    expect(ssNow()).toBe(4);
  });
});

describe("load ordering reflects when a load STARTED", () => {
  it("lets the later-started load win even if it finishes first", () => {
    const older = beginCodexLoad();
    const newer = beginCodexLoad();
    applyCodexPages({ ...override(9), campaignId: CAMPAIGN }, newer);
    applyCodexPages({ ...override(1), campaignId: CAMPAIGN }, older);
    const ctx = { ...codexCtx(CAMPAIGN, "c1"), role: "curator" as const };
    const r = codexRegistry().resolveReference(first.id!, ctx);
    expect(r && r.ambiguous === false && (r.resolvedDefinition.data as { ss: number }).ss).toBe(9);
  });

  it("hands out strictly increasing tokens", () => {
    const a = beginCodexLoad();
    const b = beginCodexLoad();
    const c = beginCodexLoad();
    expect(b).toBeGreaterThan(a);
    expect(c).toBeGreaterThan(b);
  });

  it("lets singleton catalog writers detect a superseded load", () => {
    const older = beginCodexLoad();
    expect(codexLoadIsCurrent(older)).toBe(true);
    const newer = beginCodexLoad();
    expect(codexLoadIsCurrent(older)).toBe(false);
    expect(codexLoadIsCurrent(newer)).toBe(true);
  });
});

describe("role is stated, not inferred from a machine setting", () => {
  it("honours an explicit role over the stored toggle", () => {
    localStorage.setItem("wte-curator", "1");
    expect(codexCtx(CAMPAIGN, "c1", "player").role).toBe("player");
    localStorage.setItem("wte-curator", "0");
    expect(codexCtx(CAMPAIGN, "c1", "curator").role).toBe("curator");
  });

  it("falls back to the toggle only when the caller does not know", () => {
    localStorage.setItem("wte-curator", "1");
    expect(codexCtx(CAMPAIGN, "c1").role).toBe("curator");
    localStorage.setItem("wte-curator", "0");
    expect(codexCtx(CAMPAIGN, "c1").role).toBe("player");
  });

  it("defaults to the more restrictive role when nothing is knowable", () => {
    localStorage.removeItem("wte-curator");
    expect(codexCtx(CAMPAIGN, "c1").role).toBe("player");
  });
});
