// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildAbilityCatalog } from "../game/abilityCatalog";
import { VttAbilityRing, abilityRingPlan, abilityRingWorthOpening, abilityTemplate, type AbilityRingInput } from "./VttAbilityRing";
import { parseEffectMeta } from "./data/effectMeta";
import type { VttAbility } from "./data/characterAbilities";
import type { OriginPlan } from "./data/originAnchor";
import type { PixiVttApp } from "./engine/PixiVttApp";

const CATALOG = buildAbilityCatalog([]);

function ability(over: Partial<VttAbility> & { effect: string }): VttAbility {
  return {
    id: "row-1",
    abilityId: "ab-1",
    name: "Reverse Reaction",
    source: "genus",
    ss: 3,
    meta: parseEffectMeta(over.effect),
    ...over,
  };
}

/** A page that says what it does in the declared grammar. NOT shipped content —
 *  no W.T.E ability carries an `## Actions` block yet; this is what a table
 *  would write if it forked one into the grammar P1–P5 built. */
const DECLARED = ability({
  name: "Cinder Bloom",
  effect: "A gout of flame.",
  actions: `
## Actions
- Zone: circle 15 ft, attach point
- Damage: 3d10 Fire
- Save: Physical Save — Evasion, DV 18
`,
});

/** The whole shipped corpus: prose only, read by the scanner. */
const UNDECLARED = ability({
  name: "Gravitic Snare",
  effect: "Creatures within a 10 ft radius take 2d6 damage and make an Endurance Save (DC 18).",
});

/** Prose with no area at all and nothing to ask of a target. */
const SELF_ONLY = ability({ name: "Iron Skin", effect: "You gain +2 Damage Reduction for 3 rounds." });

function input(over: Partial<AbilityRingInput> = {}): AbilityRingInput {
  return {
    ability: DECLARED,
    catalog: CATALOG,
    origin: null,
    casterTokenId: "tk-caster",
    casterName: "Kira",
    targetName: null,
    axisStats: null,
    ...over,
  };
}

const labels = (plan: ReturnType<typeof abilityRingPlan>) => plan.actions.map((one) => one.label);

describe("abilityTemplate", () => {
  it("takes the shape and the size the block DECLARED", () => {
    const plan = abilityRingPlan(input());
    // 15 ft is 3 cells at the app's one scale. The prose says "a gout of
    // flame", which the scanner reads as no area at all — a declared block that
    // lost to the prose scanner would be decorative.
    expect(plan.template).toEqual({ kind: "circle", cells: 3 });
  });

  it("falls back to the prose scanner for an ability that declared nothing", () => {
    expect(abilityRingPlan(input({ ability: UNDECLARED })).template).toEqual({ kind: "circle", cells: 2 });
  });

  it("has no template at all for an ability with no area", () => {
    expect(abilityTemplate(SELF_ONLY, [])).toBeNull();
  });

  it("calls the block's square what the engine calls a zone", () => {
    // Every other shape word in the grammar is already the engine's own word;
    // this is the one mapping that is not identity, so it is the one that rots
    // silently — a `square` reaching the engine unmapped draws no template at
    // all and the Curator sees the ring do nothing.
    const field = ability({
      name: "Cinder Field",
      effect: "A gout of flame.",
      actions: `
## Actions
- Zone: square 20 ft, attach point
`,
    });
    expect(abilityRingPlan(input({ ability: field })).template).toEqual({ kind: "zone", cells: 4 });
  });
});

describe("abilityRingPlan", () => {
  it("offers the declared ability its template, its dice and a way out", () => {
    expect(labels(abilityRingPlan(input()))).toEqual([
      "Place circle · 3 cells",
      "Aim circle · 3 cells",
      "3d10 Fire",
      "More options",
      "Cancel",
    ]);
  });

  it("offers an undeclared ability exactly the same shape of surface", () => {
    // One renderer either way — the point of the understanding layer. What
    // differs is the NUMBERS the page supplied, never the buttons it gets.
    const plan = abilityRingPlan(input({ ability: UNDECLARED }));
    expect(labels(plan)).toEqual(["Place circle · 2 cells", "Aim circle · 2 cells", "2d6", "More options", "Cancel"]);
  });

  it("never walks an ability with no area through a placement flow", () => {
    // The heaviest thing about the dialog this replaces: it opened for
    // abilities that had nothing to place, and asked them to pick a shape.
    const plan = abilityRingPlan(input({ ability: SELF_ONLY }));
    expect(labels(plan)).toEqual(["Cancel"]);
    expect(abilityRingWorthOpening(plan)).toBe(false);
  });

  it("opens no surface for an ordinary attack whose roll is already armed", () => {
    // Dice alone are not a reason. The dock chip that opened this ring armed
    // the tray on the way; a ring appearing to re-offer that roll would
    // interrupt every ability use in the game and add nothing.
    const punch = ability({ name: "Cinder Jab", effect: "Deals 2d6 fire damage to one target." });
    const plan = abilityRingPlan(input({ ability: punch }));
    expect(plan.template).toBeNull();
    expect(labels(plan)).toEqual(["2d6 Fire", "Cancel"]);
    expect(abilityRingWorthOpening(plan)).toBe(false);
  });

  it("opens on a template and on nothing else", () => {
    // The same trigger the modal form had. A save-only ability keeps asking
    // through the dock's gold chip, where it always has: a ring that opened
    // whenever a token happened to be selected would pop up seconds after the
    // cast, on a selection that had nothing to do with it.
    const stare = ability({ name: "Cold Read", effect: "The target makes a Mental Save — Influence (DV 16)." });
    expect(abilityRingWorthOpening(abilityRingPlan(input({ ability: stare, targetName: "Ravener" })))).toBe(false);
    expect(abilityRingWorthOpening(abilityRingPlan(input()))).toBe(true);
  });

  it("asks a target for the save only when there is a target to ask", () => {
    expect(labels(abilityRingPlan(input())).some((one) => one.includes("Evasion"))).toBe(false);
    const asked = labels(abilityRingPlan(input({ targetName: "Ravener" })));
    expect(asked).toContain("Ravener: Physical Save — Evasion · DV 18");
  });

  it("rides the body a declared origin resolved to, not the caster's", () => {
    // A Cipher mounted on a Component is standing wherever the Component is.
    const origin: OriginPlan = {
      text: "Reliquary Lamp",
      source: "component",
      tokenId: "tk-lamp",
      at: { x: 300, y: 120 },
      self: false,
      needsPlacement: false,
      note: null,
    };
    const plan = abilityRingPlan(input({ origin }));
    expect(plan.tokenId).toBe("tk-lamp");
    expect(plan.anchorNote).toBe("From Reliquary Lamp");
  });

  it("offers no drop for an origin the scene has no object for", () => {
    // The app will not invent a Component so a template has something to hang
    // off. The Curator places it, which is what Aim is.
    const origin: OriginPlan = {
      text: "Battlefield environment",
      source: "block",
      tokenId: null,
      at: null,
      self: false,
      needsPlacement: true,
      note: "nothing answers",
    };
    const plan = abilityRingPlan(input({ origin }));
    expect(plan.tokenId).toBeNull();
    expect(labels(plan)).not.toContain("Place circle · 3 cells");
    expect(labels(plan)).toContain("Aim circle · 3 cells");
    expect(plan.anchorNote).toContain("nothing on this scene answers to that");
  });

  it("hangs on the square a declared marker sits on rather than riding nothing", () => {
    // A Curator with no object for "the Medium" drops a labelled marker and the
    // ability anchors to it. Markers do not move on their own, so the ring holds
    // a POINT and no token — and a plan that dropped that point would send the
    // ring to the view centre while its caption still read "From the Medium".
    const origin: OriginPlan = {
      text: "the Medium",
      source: "block",
      tokenId: null,
      at: { x: 640, y: 220 },
      self: false,
      needsPlacement: false,
      note: "anchored to the placed marker",
    };
    const plan = abilityRingPlan(input({ origin }));
    expect(plan.tokenId).toBeNull();
    expect(plan.at).toEqual({ x: 640, y: 220 });
    expect(plan.anchorNote).toBe("From the Medium");
    expect(labels(plan)).toContain("Place circle · 3 cells");
  });

  it("anchors to the caster when the page declared no origin", () => {
    const plan = abilityRingPlan(input());
    expect(plan.tokenId).toBe("tk-caster");
    expect(plan.anchorNote).toBe("On Kira");
  });

  it("says so rather than lying when nothing is on the map to anchor to", () => {
    const plan = abilityRingPlan(input({ casterTokenId: null }));
    expect(plan.tokenId).toBeNull();
    expect(plan.anchorNote).toBe("At the view centre");
  });
});

// ── The component ──────────────────────────────────────────────────────────
const CAMERA = { x: 0, y: 0, zoom: 1 };

function fakeEngine(overrides: { tokens?: { id: string; x: number; y: number; size?: number }[] } = {}) {
  const tokens = overrides.tokens ?? [{ id: "tk-caster", x: 200, y: 160, size: 1 }];
  return {
    camera: CAMERA,
    scene: { data: { tokens, grid: { size: 70 } } },
    tokens: { displayPosition: (id: string) => tokens.find((one) => one.id === id) ?? null },
    viewportSize: () => ({ width: 900, height: 600 }),
    viewCenterWorld: () => ({ x: 0, y: 0 }),
  } as unknown as PixiVttApp;
}

let host: HTMLDivElement;
let root: Root;

async function mount(plan: ReturnType<typeof abilityRingPlan>, engine = fakeEngine()) {
  const props = {
    engine,
    plan,
    onArmRoll: vi.fn(),
    onRequestSave: vi.fn(),
    onPlace: vi.fn(),
    onAim: vi.fn(),
    onOptions: vi.fn(),
    onCancel: vi.fn(),
  };
  await act(async () => {
    root.render(<VttAbilityRing {...props} />);
  });
  return props;
}

const buttons = () => [...host.querySelectorAll<HTMLButtonElement>("button")];
const byLabel = (label: string) => buttons().find((one) => one.getAttribute("aria-label") === label);

beforeEach(() => {
  document.body.innerHTML = "";
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

describe("VttAbilityRing", () => {
  it("names every button in words, not just a mark", async () => {
    // A ring of glyphs with the words only in a hover caption says nothing at
    // all to a keyboard, and the buttons have to say what they will do.
    await mount(abilityRingPlan(input({ targetName: "Ravener" })));
    for (const button of buttons()) expect(button.getAttribute("aria-label")).toBeTruthy();
    expect(byLabel("Place circle · 3 cells")).toBeDefined();
    expect(byLabel("Cancel")).toBeDefined();
  });

  it("places the declared shape and size, and closes", async () => {
    const props = await mount(abilityRingPlan(input()));
    await act(async () => byLabel("Place circle · 3 cells")?.click());
    expect(props.onPlace).toHaveBeenCalledWith("circle", 3);
    expect(props.onCancel).toHaveBeenCalled();
  });

  it("arms the cursor instead of dropping when the Curator would rather aim", async () => {
    const props = await mount(abilityRingPlan(input()));
    await act(async () => byLabel("Aim circle · 3 cells")?.click());
    expect(props.onAim).toHaveBeenCalledWith("circle", 3);
    expect(props.onPlace).not.toHaveBeenCalled();
  });

  it("keeps the ring open after arming a roll", async () => {
    // The tray is a second surface the Curator still has to press Roll in;
    // closing under them would take the placement away mid-act.
    const props = await mount(abilityRingPlan(input()));
    await act(async () => byLabel("3d10 Fire")?.click());
    expect(props.onArmRoll).toHaveBeenCalledWith("Cinder Bloom — 3d10 Fire", "3d10");
    expect(props.onCancel).not.toHaveBeenCalled();
  });

  it("keeps the ring open after asking a target for a save", async () => {
    // An area ability asks the same save of every body it caught.
    const props = await mount(abilityRingPlan(input({ targetName: "Ravener" })));
    await act(async () => byLabel("Ravener: Physical Save — Evasion · DV 18")?.click());
    expect(props.onRequestSave).toHaveBeenCalledTimes(1);
    expect(props.onRequestSave.mock.calls[0][0]).toMatchObject({ abilityId: "ab-1", dc: 18 });
    expect(props.onCancel).not.toHaveBeenCalled();
  });

  it("hands the old form the ability rather than losing it", async () => {
    const props = await mount(abilityRingPlan(input()));
    await act(async () => byLabel("More options")?.click());
    expect(props.onOptions).toHaveBeenCalled();
  });

  it("anchors itself to the caster's square through the camera", async () => {
    await mount(abilityRingPlan(input()));
    const ring = host.querySelector<HTMLDivElement>(".vtt2-ring");
    // The token sits at world 200,160 under an identity camera.
    expect(ring?.style.left).toBe("200px");
    expect(ring?.style.top).toBe("160px");
  });

  it("falls back to the view rather than rendering nowhere when its body is gone", async () => {
    // The token under a cast gets dragged, killed and deleted while the ring is
    // still open. The ring has to survive that, not hang off a corpse.
    await mount(abilityRingPlan(input()), fakeEngine({ tokens: [] }));
    const ring = host.querySelector<HTMLDivElement>(".vtt2-ring");
    // Clamped back onto the 900x600 stage instead of drawing at world origin.
    expect(parseFloat(ring?.style.left ?? "")).toBeGreaterThan(0);
    expect(parseFloat(ring?.style.top ?? "")).toBeGreaterThan(0);
  });

  it("draws itself on a marker's square when there is no body to ride", async () => {
    const origin: OriginPlan = {
      text: "the Medium",
      source: "block",
      tokenId: null,
      at: { x: 640, y: 220 },
      self: false,
      needsPlacement: false,
      note: null,
    };
    await mount(abilityRingPlan(input({ origin })));
    const ring = host.querySelector<HTMLDivElement>(".vtt2-ring");
    expect(ring?.style.left).toBe("640px");
    expect(ring?.style.top).toBe("220px");
  });

  it("spreads its buttons around the ring instead of stacking them on the anchor", async () => {
    // The offsets are written straight onto each button by the anchoring loop.
    // Lose that and every button lands on the ring's centre, one on top of the
    // next, and only the last one drawn can be pressed — which looks like a ring
    // that opened correctly and answers to nothing.
    await mount(abilityRingPlan(input({ targetName: "Ravener" })));
    const spots = buttons().map((one) => one.style.transform);
    expect(spots).toHaveLength(6);
    for (const spot of spots) expect(spot).toContain("translate(");
    expect(new Set(spots).size).toBe(spots.length);
  });

  it("takes focus, because a keyboard cannot Tab onto a surface the dock sits after", async () => {
    // The dock chip that opens the ring is LATER in the document than the map
    // is, so Tab from that chip walks away from the ring and never arrives.
    const opener = document.createElement("button");
    document.body.appendChild(opener);
    opener.focus();
    await mount(abilityRingPlan(input()));
    expect(document.activeElement).toBe(host.querySelector(".vtt2-ring"));
    // One Tab from there: the buttons are the group's own children, in the
    // order the ring draws them.
    expect(host.querySelector(".vtt2-ring")?.firstElementChild).toBe(byLabel("Place circle · 3 cells"));
    // And gives it back, so Escape does not drop the Curator on the document
    // body halfway down a loadout they were reading.
    await act(async () => root.unmount());
    expect(document.activeElement).toBe(opener);
  });

  it("says what it is anchored to until a button is pointed at", async () => {
    await mount(abilityRingPlan(input()));
    expect(host.querySelector(".vtt2-ring-hint")?.textContent).toBe("On Kira");
    expect(host.querySelector(".vtt2-ring-name")?.textContent).toBe("Cinder Bloom");
  });
});
