// @vitest-environment happy-dom
//
// The Dashboard is behind isTauri() for its data, so server-rendering is the
// strongest check available. What matters here is the WORDING as much as the
// markup: this screen exists because a failed read used to render as "you have no
// characters", and it must never read that way itself.
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("../lib/db", () => ({
  getDb: async () => ({ select: async () => [] }),
  sqlAvailable: () => false,
  lastMigrationGate: () => ({ ok: true, backup_dir: "C:/AppData/com.wte.tabletop/backup-pre-v5", schema_version: 5 }),
}));
vi.mock("../lib/localJson", () => ({
  listQuarantined: () => [{ key: "wte-desk-notes:c1.corrupt.1700000000000", original: "wte-desk-notes:c1", at: 1700000000000, bytes: 128 }],
}));
vi.mock("../lib/campaignStore", () => ({
  migrationStatus: () => [
    { key: "desk/notes", migrated: true },
    { key: "desk/calendar", migrated: false },
  ],
}));
vi.mock("../lib/appToast", () => ({ pushToast: vi.fn() }));

const { Diagnostics } = await import("./Diagnostics");

const campaign = { id: "c1", name: "Ashen Sun", createdAt: 1, updatedAt: 2, archived: false };

describe("the diagnostics screen", () => {
  it("renders without throwing", () => {
    expect(() => renderToStaticMarkup(<Diagnostics campaign={campaign} />)).not.toThrow();
  });

  it("tells you where the pre-upgrade restore point is", () => {
    // A restore point nobody can find is not one.
    const html = renderToStaticMarkup(<Diagnostics campaign={campaign} />);
    expect(html).toContain("backup-pre-v5");
    expect(html).toMatch(/copy .{0,60}over your/i);
    // The step that was missing: restoring alone leaves you on the old data with
    // a build that will simply migrate it again.
    expect(html).toMatch(/the older version/i);
  });

  it("renders with no campaign selected", () => {
    expect(() => renderToStaticMarkup(<Diagnostics campaign={null} />)).not.toThrow();
  });

  it("offers a re-scan and a copyable report", () => {
    const html = renderToStaticMarkup(<Diagnostics campaign={campaign} />);
    expect(html).toContain("Re-scan");
    expect(html).toContain("Copy report");
  });

  it("names itself clearly", () => {
    expect(renderToStaticMarkup(<Diagnostics campaign={campaign} />)).toContain("Storage health");
  });

  it("contains no emoji or pictographs, per the project convention", () => {
    const html = renderToStaticMarkup(<Diagnostics campaign={campaign} />);
    expect(html).not.toMatch(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/u);
  });

  it("uses only styled class names", () => {
    // danger-btn was invented once already and rendered unstyled.
    const html = renderToStaticMarkup(<Diagnostics campaign={campaign} />);
    expect(html).not.toContain("danger-btn");
    expect(html).toContain("diag");
  });
});
