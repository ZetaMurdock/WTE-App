// An origin word against a real scene. The assertions worth having are the
// ones about REFUSING to match: an anchor bound to the wrong body moves an
// ability's whole reach to somewhere the Curator never put it, and nothing on
// screen says so.
import { describe, expect, it } from "vitest";
import { defaultSceneData, type VttSceneData } from "../types/scene";
import { declaredOrigin } from "../../game/abilityOrigin";
import { matchOriginCandidate, originCandidates, planOrigin } from "./originAnchor";

function scene(): VttSceneData {
  const data = defaultSceneData();
  data.tokens = [
    { id: "caster", name: "Vaun", x: 100, y: 100, size: 1, color: "#fff", visible: true },
    { id: "lamp", name: "Inanimate Object", x: 400, y: 250, size: 1, color: "#fff", visible: true, prop: true },
  ];
  data.effects = [{ id: "mark", kind: "circle", x: 700, y: 700, data: { radius: 2, label: "The Medium" } }];
  return data;
}

const origin = (text: string) => declaredOrigin(null, `- Origin: ${text}`);

describe("what the scene offers", () => {
  it("counts props, because a Component is far more often a lamp than an actor", () => {
    expect(originCandidates(scene()).map((c) => c.name)).toContain("Inanimate Object");
  });

  it("counts a labelled marker, which is how an unmodelled origin gets a location", () => {
    const marker = originCandidates(scene()).find((c) => c.kind === "effect");
    expect(marker?.name).toBe("The Medium");
  });

  it("ignores an unlabelled template, which names nothing and would match anything", () => {
    const data = scene();
    data.effects = [{ id: "plain", kind: "circle", x: 0, y: 0, data: { radius: 2 } }];
    expect(originCandidates(data).filter((c) => c.kind === "effect")).toEqual([]);
  });
});

describe("matching", () => {
  it("finds the body the page names", () => {
    expect(matchOriginCandidate("Inanimate object (light-interacting)", originCandidates(scene()))?.id).toBe("lamp");
  });

  it("refuses a partial-word overlap", () => {
    // The first draft scored shared words and bound "Group of targets" to a
    // token called "Target Dummy" — a four-target Cipher silently anchored to
    // one prop across the room.
    const data = scene();
    data.tokens.push({ id: "dummy", name: "Target Dummy", x: 0, y: 0, size: 1, color: "#fff", visible: true });
    expect(matchOriginCandidate("Group of targets (up to 4)", originCandidates(data))).toBeNull();
  });

  it("refuses when two things answer to the same name", () => {
    // Which of the two Mediums is THE Medium is the Curator's question. Taking
    // the first would anchor to whichever happened to be spawned first.
    const data = scene();
    data.tokens.push({ id: "m2", name: "The Medium", x: 0, y: 0, size: 1, color: "#fff", visible: true });
    expect(matchOriginCandidate("The Medium", originCandidates(data))).toBeNull();
  });
});

describe("planOrigin", () => {
  it("leaves an ability that declared no origin completely alone", () => {
    const plan = planOrigin(declaredOrigin("Deal 3d10 Cold.", "- Damage: 3d10 Cold"), scene(), "caster");
    expect(plan.text).toBeNull();
    expect(plan.tokenId).toBeNull();
    expect(plan.needsPlacement).toBe(false);
    expect(plan.note).toBeNull();
  });

  it("resolves a self origin to the caster, so nothing changes for the body-fired corpus", () => {
    const plan = planOrigin(origin("Animate (self)"), scene(), "caster");
    expect(plan.self).toBe(true);
    expect(plan.tokenId).toBe("caster");
    expect(plan.at).toEqual({ x: 100, y: 100 });
  });

  it("asks rather than guessing when the caster is not on this scene", () => {
    // Falling through to the view centre would drop the template wherever the
    // camera happened to be pointing, with nothing on screen saying why.
    const plan = planOrigin(origin("Animate (self)"), scene(), null);
    expect(plan.needsPlacement).toBe(true);
    expect(plan.at).toBeNull();
  });

  it("rides the token it resolved to, which is what feeds the aura binding", () => {
    const plan = planOrigin(origin("Inanimate Object"), scene(), "caster");
    expect(plan.tokenId).toBe("lamp");
    expect(plan.at).toEqual({ x: 400, y: 250 });
  });

  it("anchors to a marker without claiming it rides one", () => {
    // The aura binding attaches an effect to a TOKEN. A marker gives a point
    // and nothing more, and the note says so instead of silently downgrading.
    const plan = planOrigin(origin("The Medium"), scene(), "caster");
    expect(plan.at).toEqual({ x: 700, y: 700 });
    expect(plan.tokenId).toBeNull();
    expect(plan.note).toContain("does not move on its own");
  });

  it("refuses to invent a body for an origin the map has no object for", () => {
    // S4 — THE LAST WAR mounts on `Battlefield environment`. There is no such
    // token and there must not be one conjured with stats — the Curator places
    // it, and is told that is what is being asked.
    const plan = planOrigin(origin("Battlefield environment"), scene(), "caster");
    expect(plan.needsPlacement).toBe(true);
    expect(plan.tokenId).toBeNull();
    expect(plan.at).toBeNull();
    expect(plan.note).toContain("place the origin yourself");
  });

  it("carries the origin through from a Cipher's own header, with no page edit", () => {
    const plan = planOrigin(declaredOrigin("Rank: Corporal · Component: Inanimate Object. EFFECT — it hits things.", null), scene(), "caster");
    expect(plan.source).toBe("component");
    expect(plan.tokenId).toBe("lamp");
  });
});
