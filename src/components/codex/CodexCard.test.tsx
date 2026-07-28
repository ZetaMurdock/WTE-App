// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { CodexCard } from "./CodexCard";
import { buildEntity } from "../../game/codexEntity";
import { CodexRegistry, type Resolution } from "../../game/codexRegistry";
import type { RuleLayer } from "../../game/ruleLayers";

const CAMPAIGN = "8a93a397-4c21-4a6e-9d0b-1f2e3a4b5c6d";

const official = buildEntity({
  kind: "genus",
  title: "Vector Swing",
  sourcePage: "Vector_Swing",
  fields: {},
  data: { domain: "Kinetic", ss: 1, activation: "Active", range: "Self", target: "Self", effect: "One extra damage die." },
}).entity;

const override = buildEntity({
  kind: "genus",
  title: "Vector Swing",
  sourcePage: "Ashen_Sun_Vector_Swing",
  fields: { overrides: "wte.genus.vector-swing" },
  data: { domain: "Kinetic", ss: 2, activation: "Reaction", range: "Self", target: "Self", effect: "Two extra damage dice." },
  scope: "campaign",
  ownerId: CAMPAIGN,
}).entity;

function resolve(entities = [official]): Resolution {
  const r = new CodexRegistry(entities).resolveTerm("Vector Swing", { role: "curator", campaignId: CAMPAIGN });
  if (!r || r.ambiguous) throw new Error("expected a single resolution");
  return r;
}

const render = (r: Resolution, layers?: RuleLayer[]) =>
  renderToStaticMarkup(<CodexCard resolution={r} layers={layers} onOpenPage={vi.fn()} onClose={vi.fn()} />);

describe("the card shows what the term means here", () => {
  it("renders the mechanics", () => {
    const html = render(resolve());
    for (const bit of ["Vector Swing", "Kinetic", "Active", "Self", "One extra damage die."]) {
      expect(html, bit).toContain(bit);
    }
  });

  it("marks an official definition as official", () => {
    expect(render(resolve())).toContain("Official W.T.E");
  });

  it("badges a campaign override and shows the official value beside it", () => {
    const html = render(resolve([official, override]));
    expect(html).toContain("Modified by this campaign");
    // The override's activation, with the official one still visible.
    expect(html).toContain("Reaction");
    expect(html).toContain("officially Active");
  });

  it("says the original is still on record", () => {
    expect(render(resolve([official, override]))).toMatch(/original is still on record/i);
  });

  it("offers both pages when they differ", () => {
    const html = render(resolve([official, override]));
    expect(html).toContain("Open full Codex page");
    expect(html).toContain("Open the official page");
  });

  it("offers only one page when there is no override", () => {
    const html = render(resolve());
    expect(html).toContain("Open full Codex page");
    expect(html).not.toContain("Open the official page");
  });

  it("shows the stable id, which is what makes renames safe", () => {
    expect(render(resolve())).toContain("wte.genus.vector-swing");
  });
});

describe("the provenance breakdown answers 'why is this different?'", () => {
  const layers: RuleLayer[] = [
    { id: "a", targetId: "wte.genus.vector-swing", scope: "campaign", owner: CAMPAIGN, op: "add", value: 1, note: "Ashen Sun campaign override" },
    { id: "b", targetId: "wte.genus.vector-swing", scope: "session", owner: "s1", op: "add", value: -1, note: "Null Storm scene effect" },
  ];

  it("lists every contribution with the base and the final", () => {
    const html = render(resolve([official]), layers);
    expect(html).toContain("Why is this different?");
    expect(html).toContain("Base W.T.E rule");
    expect(html).toContain("Ashen Sun campaign override");
    expect(html).toContain("Null Storm scene effect");
    expect(html).toContain("Final");
  });

  it("shows the resolved value, not the official one", () => {
    // base 1, +1, -1 = 1 — and the official is also 1, so the interesting check is
    // that the trail is rendered at all rather than the numbers coinciding.
    const html = render(resolve([official]), [layers[0]]);
    expect(html).toContain("+1");
  });

  it("omits the breakdown entirely when no layer applies", () => {
    expect(render(resolve())).not.toContain("Why is this different?");
  });
});

describe("card conventions", () => {
  it("shows aliases so a renamed ability is recognisable", () => {
    const renamed = buildEntity({
      kind: "genus",
      title: "Vector Redirection",
      sourcePage: "Vector_Swing",
      fields: { id: "wte.genus.vector-swing", aliases: "Vector Swing" },
      data: { ss: 1 },
    }).entity;
    expect(render(resolve([renamed]))).toContain("Vector Swing");
  });

  it("flags a Curator-only definition", () => {
    const secret = buildEntity({
      kind: "genus",
      title: "Vector Swing",
      sourcePage: "V",
      fields: { visibility: "curator" },
      data: { ss: 1 },
    }).entity;
    expect(render(resolve([secret]))).toContain("Curator only");
  });

  it("contains no emoji or pictographs", () => {
    expect(render(resolve([official, override]))).not.toMatch(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/u);
  });

  it("renders without throwing when the entity carries no mechanics at all", () => {
    const bare = buildEntity({ kind: "genus", title: "Bare", sourcePage: "B", fields: {}, data: {} }).entity;
    const r = new CodexRegistry([bare]).resolveTerm("Bare", { role: "curator" });
    if (!r || r.ambiguous) throw new Error("expected resolution");
    expect(() => render(r)).not.toThrow();
  });
});
