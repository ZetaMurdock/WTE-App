// @vitest-environment happy-dom
//
// The Photonic rework renamed ten abilities in place (Teleport became Molecular
// Divergence, Long Jump became Dazzling Jump, …). Characters store genus picks
// by id OR by name, so both routes must survive: the id stays on the record, and
// the former name rides along as an alias the registry resolves.
import { beforeEach, describe, expect, it } from "vitest";
import { applyCodexPages, codexRegistry, __resetCodexService } from "./codexService";
import { getGenusDomain } from "./wte";
import { resolveGenusRefs } from "./genusRef";
import type { ResolveContext } from "./codexRegistry";

const CAMPAIGN = "rename-table";
const player: ResolveContext = { role: "player", campaignId: CAMPAIGN, kind: "genus" };
const empty = { officialMirrors: [], campaignPages: [], campaignId: CAMPAIGN, skipped: [] };

const RENAMES: Array<[oldName: string, newName: string, id: string]> = [
  ["Teleport", "Molecular Divergence", "wte.genus.teleport"],
  ["Long Jump", "Dazzling Jump", "wte.genus.long-jump"],
  ["Frictionless Advance", "Remembrance", "wte.genus.frictionless-advance"],
  ["Prismatic Overload", "Luminance Overload", "wte.genus.prismatic-overload"],
  ["Inverse Dodge", "Prismatic Refraction", "wte.genus.inverse-dodge"],
  ["Reverted Advance", "Jihoonic", "wte.genus.reverted-advance"],
  ["Mirror Movement", "Mariefocus", "wte.genus.mirror-movement"],
  ["Vector Swap", "Fracturance", "wte.genus.vector-swap"],
  ["Atomic Reverberation", "A-Fixture", "wte.genus.atomic-reverberation"],
  ["Vibration Link", "Post-Mortem Resurgence", "wte.genus.vibration-link"],
];

beforeEach(() => __resetCodexService());

describe("the Photonic rework keeps old characters resolving", () => {
  it("carries every rename in the baked data, id unchanged", () => {
    const photonic = getGenusDomain("Photonic")!;
    for (const [oldName, newName, id] of RENAMES) {
      const rec = photonic.abilities.find((a) => a.name === newName);
      expect(rec, newName).toBeDefined();
      expect(rec!.id, newName).toBe(id);
      expect(rec!.aliases, newName).toContain(oldName);
    }
  });

  it("resolves a sheet that stored the OLD name to the new ability", () => {
    applyCodexPages(empty);
    for (const [oldName, newName] of RENAMES) {
      const r = codexRegistry().resolveReference(oldName, player);
      expect(r && !r.ambiguous && r.entity.name, oldName).toBe(newName);
    }
  });

  it("resolves a sheet that stored the old ID to the new ability", () => {
    applyCodexPages(empty);
    for (const [, newName, id] of RENAMES) {
      const r = codexRegistry().resolveReference(id, player);
      expect(r && !r.ambiguous && r.entity.name, id).toBe(newName);
    }
  });

  it("shows the CURRENT name on a legacy sheet, not the stored one", () => {
    applyCodexPages(empty);
    // A real pre-rework Photonic loadout, keyed by names, with Focus invested.
    const refs = resolveGenusRefs(
      { Teleport: 4, "Long Jump": 2, "Photonic Swing": 3 },
      codexRegistry(),
      player
    );
    const byStored = new Map(refs.map((r) => [r.stored, r]));
    expect(byStored.get("Teleport")!.displayName).toBe("Molecular Divergence");
    expect(byStored.get("Teleport")!.unresolved).toBe(false);
    expect(byStored.get("Teleport")!.focus).toBe(4);
    expect(byStored.get("Long Jump")!.displayName).toBe("Dazzling Jump");
    // An unrenamed ability is untouched by any of this.
    expect(byStored.get("Photonic Swing")!.displayName).toBe("Photonic Swing");
  });

  it("does not let an alias shadow a REAL ability elsewhere in the catalog", () => {
    // "Phase" exists in Photonic today AND "Photonic Cleave" lives in Elemental;
    // sanity-check that alias indexing did not create cross-domain ambiguity.
    applyCodexPages(empty);
    const phase = codexRegistry().resolveReference("Phase", player);
    expect(phase && !phase.ambiguous && phase.entity.name).toBe("Phase");
    const cleave = codexRegistry().resolveReference("Photonic Cleave", player);
    expect(cleave && !cleave.ambiguous && cleave.entity.name).toBe("Photonic Cleave");
  });
});
