// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MechanicsBlockEditor } from "./MechanicsBlockEditor";

// The editor is the only place a Curator sees the two halves of a page at once,
// so the surface is asserted here rather than left to a screenshot: a page whose
// prose and block disagree must SAY so, and one that declares nothing must look
// exactly as it always did.
const page = (actions: string[]): string =>
  [
    "# Frost Nail",
    "",
    "| Field | Value |",
    "|---|---|",
    "| Type | Genus |",
    "| Domain | Elemental |",
    "| SS | 6 |",
    "",
    "## Effect",
    "",
    "Living creatures make a Physical Save — Recovery (DV 18) or take 3d10 cold damage.",
    ...(actions.length ? ["", "## Actions", "", ...actions] : []),
  ].join("\n");

const render = (source: string): string =>
  renderToStaticMarkup(<MechanicsBlockEditor value={source} onChange={() => {}} kind="genus" />);

describe("the Mechanics editor shows what the block declares", () => {
  it("lists the declared steps as chips", () => {
    const markup = render(
      page(["- Cost: 6 SS", "- Save (target): Physical Save — Recovery, DV 18", "- Fail: Damage: 3d10 Cold, half on success"])
    );
    expect(markup).toContain("Declared steps");
    expect(markup).toContain("6 SS");
    expect(markup).toContain("Physical Save — Recovery · DV 18");
    expect(markup).toContain("On fail · 3d10 Cold");
    // Agreeing halves say nothing at all.
    expect(markup).not.toContain("mech-lint");
  });

  it("warns in the page when the dice drifted apart", () => {
    const markup = render(page(["- Save (target): Physical Save — Recovery, DV 18", "- Fail: Damage: 3d8 Cold"]));
    expect(markup).toContain("mech-lint");
    expect(markup).toContain("mech-warn");
    expect(markup).toContain("the page states the rule twice, differently");
  });

  it("shows a step it could not read rather than dropping it", () => {
    const markup = render(page(["- Damage: a great deal of cold"]));
    expect(markup).toContain("mech-warn");
    expect(markup).toContain("a great deal of cold");
  });

  it("says so when a step line would be lifted out of the block as a spec field", () => {
    // `Target: …` written without a bullet is captured by the pre-parser: it
    // leaves the block, overwrites the Target mechanic, and the page stops
    // opening in Mechanics mode at all. The Effect box warns about this shape;
    // the block that shares the page must not stay quiet about it.
    const markup = render(page(["- Cost: 6 SS", "Target: everyone nearby"]));
    expect(markup).toContain("mech-warn");
    expect(markup).toContain("Target");
    // A well-formed block is still silent — every bullet starts with “-”.
    expect(render(page(["- Cost: 6 SS", "- Condition: Slowed, 2 rounds"]))).not.toContain("mech-warn");
  });

  it("adds no findings and no chips to a prose-only ability", () => {
    const markup = render(page([]));
    expect(markup).toContain("Declared steps"); // the box is offered…
    expect(markup).not.toContain("mech-lint"); // …but an undeclared page is not nagged
  });
});
