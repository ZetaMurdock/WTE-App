import { useEffect, useRef, useState } from "react";
import { abilityUnderstanding } from "../game/abilityUnderstanding";
import type { AbilityCatalog } from "../game/abilityCatalog";
import type { EffectShape, EffectStep } from "../game/abilityEffects";
import type { RollAxisStats } from "../game/rollAxis";
import { saveIntentChip, type SaveIntentInput, type VttTargetRollIntent } from "./data/abilitySaveIntent";
import type { VttAbility } from "./data/characterAbilities";
import { FT_PER_CELL, hasAoe, suggestedTemplate, type TemplateKind } from "./data/effectMeta";
import type { OriginPlan } from "./data/originAnchor";
import { RING_BUTTON, ringOffsets, ringPlacement, ringRadius } from "./data/ringAnchor";
import type { PixiVttApp } from "./engine/PixiVttApp";

/**
 * Using an ability, as a thing that happens ON THE MAP.
 *
 * The flow this replaces was a modal form in the middle of the screen: five
 * radio-style target modes, a shape, a size and a lifetime, for an act that is
 * spatial and usually has exactly one right answer already written on the
 * ability's own page. A Curator mid-fight was reading a form to re-declare what
 * the page had declared.
 *
 * So this ring FRONTS that form rather than deleting it. Every button here is
 * one press and comes off what the ability actually says; the form is still one
 * press away behind "More options", because a numeric size and a lingering
 * round count are real needs the ring cannot express without becoming a form
 * again. Deleting a working flow to ship a prettier one would have cost the
 * table the two cases the ring is worst at.
 *
 * ANCHORING IS THE RADIAL MENU'S, not a second copy — see data/ringAnchor. A
 * per-frame loop re-reads the LIVE display position, so the ring stays glued
 * through drags, camera pans and momentum, and survives the body under it being
 * deleted mid-cast.
 */

/** `square` is the block's word for what the engine calls a zone; every other
 *  shape word is already the engine's own. */
const DECLARED_SHAPE: Readonly<Record<EffectShape, TemplateKind>> = {
  circle: "circle",
  cone: "cone",
  line: "line",
  ring: "ring",
  cross: "cross",
  square: "zone",
};

/**
 * The template an ability places: what its block DECLARED, else what its prose
 * suggests, else nothing.
 *
 * A declared `Zone: circle 15 ft` is the page saying the shape and the size in
 * so many words. Reaching past it for the prose scanner would make the
 * declaration decorative, and would quietly disagree with it every time the
 * prose worded the area differently from the block beside it — which is exactly
 * what the block exists to stop.
 *
 * Exported because the form behind "More options" opens on the same numbers.
 * Two readings of one ability's shape, one on the ring and one in the form, is
 * a Curator pressing "More options" and watching the shape change under them.
 */
export function abilityTemplate(
  ability: VttAbility,
  steps: readonly EffectStep[]
): { kind: TemplateKind; cells: number } | null {
  const zone = steps.find((step) => step.verb === "zone");
  if (zone?.shape) {
    // Feet on the page, cells in the engine — the corpus writes "15-ft radius"
    // and so does the block. A block that named a shape and no size falls back
    // to the prose's size rather than to a magic number.
    const cells = zone.sizeFt ? Math.max(1, Math.round(zone.sizeFt / FT_PER_CELL)) : suggestedTemplate(ability.meta).cells;
    return { kind: DECLARED_SHAPE[zone.shape], cells };
  }
  return hasAoe(ability.meta) ? suggestedTemplate(ability.meta) : null;
}

export type RingActionKind = "place" | "aim" | "roll" | "save" | "options" | "cancel";

export interface RingActionSpec {
  key: string;
  kind: RingActionKind;
  /** The mark on the button. The words live in `label`, which is the caption,
   *  the tooltip AND the accessible name — a glyph-only button that only
   *  explains itself on hover says nothing at all to a keyboard.
   *
   *  A ring can hold TWO rolls and TWO saves, and one shared glyph per kind
   *  drew them as identical circles the Curator could only tell apart by
   *  hovering each in turn. So a repeatable kind wears its own number instead
   *  of an ornament: the die it arms, the DV it asks for. */
  glyph: string;
  label: string;
  /** The longer sentence, appended to the tooltip. */
  detail?: string;
  /** The tray roll this button arms — a `roll` button carries its own dice
   *  rather than the ring re-deriving them at click time from a label. */
  arm?: { label: string; expr?: string };
  /** The request this button sends, for a `save` button. */
  intent?: VttTargetRollIntent;
}

export interface AbilityRingPlan {
  /** The ability this ring is about, for the caption and the roll labels. */
  name: string;
  /** The template this ability declares, or null — an ability with no area is
   *  never offered a placement, which is half of why the old dialog felt heavy:
   *  it opened for abilities that had nothing to place. */
  template: { kind: TemplateKind; cells: number } | null;
  /** Where the ring hangs, in words, for the caption under it. */
  anchorNote: string;
  /** The body the ring rides. Null anchors it to a fixed point or the view. */
  tokenId: string | null;
  /** The fixed world point, when the origin resolved to a placed marker — those
   *  do not move on their own, so there is nothing to ride. */
  at: { x: number; y: number } | null;
  actions: RingActionSpec[];
}

export interface AbilityRingInput {
  ability: VttAbility;
  catalog: AbilityCatalog;
  /** Where the page says it fires from, already resolved against the scene. */
  origin: OriginPlan | null;
  casterTokenId: string | null;
  casterName: string | null;
  /** The token that would answer a save. Null means no target is selected and
   *  the ring offers no save it could not deliver. */
  targetName: string | null;
  axisStats: RollAxisStats | null;
  casterCharacterId?: string;
}

/** How many of each kind the ring will draw. A ring is a ring: past about eight
 *  buttons it stops being readable at a glance, which is the entire point of
 *  putting it on the map instead of in a panel. The dock still lists them all. */
const MAX_ROLLS = 2;
const MAX_SAVES = 2;

/** The die a roll button arms — "d10" off "3d10" — so two damage buttons on one
 *  ring are told apart by what they roll rather than by hovering both. Null for
 *  an action carrying no literal dice, which falls back to the die mark. */
function dieMark(expr: string | undefined): string | null {
  const die = expr?.match(/d(\d+)/i);
  return die ? `d${die[1]}` : null;
}

/**
 * What this ability offers, read off what it declares.
 *
 * DAMAGE dice only, never the self checks. A self check resolves through the
 * character's roll profile and, on a Roll Axis path, through a CHOICE of source
 * the player makes on the dock chip — the ring cannot ask that question and
 * must not answer it for them. A damage action carries a literal expression, so
 * the ring arms exactly the string the dock's chip arms and the two can't drift.
 */
export function abilityRingPlan(input: AbilityRingInput): AbilityRingPlan {
  const { ability, origin } = input;
  const read = ability.source === "action" ? null : abilityUnderstanding(ability.effect, ability.actions, input.catalog);
  const actions = read?.actions ?? [];
  const template = abilityTemplate(ability, read?.steps ?? []);

  // Where the act happens: the declared origin's body, then the square a
  // declared marker sits on, then the caster's own body. An origin the map has
  // no object for anchors to NOTHING on purpose — the app will not invent a
  // Component to hang a template off, so the Curator places it by hand.
  // An origin that resolved ANSWERS FOR ITSELF — to a body when the map found
  // one, to a bare square when it found a placed marker. Only a page that
  // declared no origin, or one the scene has no object for, falls back to the
  // caster. Letting a marker origin fall through to the caster's token set both
  // halves at once, and the anchoring loop prefers the body: the ring drew over
  // the caster while its caption read "From the Medium" and the template it
  // placed landed on the marker.
  const tokenId = origin?.tokenId ?? (origin?.at || origin?.needsPlacement ? null : input.casterTokenId);
  const at = origin?.tokenId ? null : origin?.at ?? null;
  const anchorNote = origin?.text
    ? origin.needsPlacement
      ? `${origin.text} — nothing on this scene answers to that`
      : `From ${origin.text}`
    : tokenId
      ? `On ${input.casterName || "the caster"}`
      : "At the view centre";

  const saveContext: SaveIntentInput = {
    ability: { abilityId: ability.abilityId ?? ability.id, name: ability.name, effect: ability.effect },
    actions,
    steps: read?.steps,
    declared: read?.declared === true,
    axisStats: input.axisStats,
    casterCharacterId: input.casterCharacterId,
  };
  const saveChips = input.targetName
    ? actions.filter((one) => one.kind === "save").slice(0, MAX_SAVES).map((one) => saveIntentChip(one, saveContext))
    : [];

  const specs: RingActionSpec[] = [];
  if (template) {
    // An origin the scene could not find has no square to drop on, so the ring
    // does not offer a drop. Offering one anyway would land the template at the
    // view centre and call that the page's declared origin.
    if (tokenId || at || !origin?.needsPlacement) {
      specs.push({
        key: "place",
        kind: "place",
        // A filled dot for the drop and an open cross for the aim. They were a
        // bullseye and a circled plus — two circles of the same weight, side by
        // side at 38px on a dark map, for the two acts most easily confused.
        glyph: "◉",
        label: `Place ${template.kind} · ${template.cells} cells`,
        detail: `${anchorNote} — drag to re-aim, resize in the inspector`,
      });
    }
    specs.push({
      key: "aim",
      kind: "aim",
      glyph: "✛",
      label: `Aim ${template.kind} · ${template.cells} cells`,
      detail: "Then click anywhere on the map to drop it",
    });
  }
  for (const [index, roll] of actions.filter((one) => one.kind === "damage").slice(0, MAX_ROLLS).entries()) {
    specs.push({
      key: `roll${index}`,
      kind: "roll",
      glyph: dieMark(roll.expr) ?? "⚄",
      label: roll.label,
      detail: `Arm the tray with ${roll.expr ?? "these dice"}`,
      arm: { label: roll.label, expr: roll.expr },
    });
  }
  for (const [index, chip] of saveChips.entries()) {
    specs.push({
      key: `save${index}`,
      kind: "save",
      // The number the Curator is about to say out loud, rather than a lozenge.
      glyph: chip.dv != null ? String(chip.dv) : "◈",
      label: `${input.targetName}: ${chip.label}`,
      detail: `Ask ${input.targetName} for this roll${chip.title}`,
      intent: chip.intent,
    });
  }
  if (template) {
    specs.push({ key: "options", kind: "options", glyph: "⋯", label: "More options", detail: "Exact size, lingering rounds, and every anchor" });
  }
  specs.push({ key: "cancel", kind: "cancel", glyph: "✕", label: "Cancel", detail: "Place nothing — the roll already made stands" });

  return { name: ability.name, template, anchorNote, tokenId, at, actions: specs };
}

/**
 * Does this ability have anything for the ring to do?
 *
 * A TEMPLATE, and nothing else. This is deliberately the same trigger the modal
 * form had — an ability with an area opens a surface, an ability without one
 * opens nothing — so the ring changes what using an ability LOOKS like without
 * changing when the app interrupts anybody.
 *
 * The dice and the target saves ride along once the ring is up because they are
 * the acts that follow a placement, but neither is a reason to open one. A ring
 * that appeared for every ability carrying a damage die would interrupt every
 * ability use in the game to re-offer a roll the dock chip already armed; a ring
 * that appeared whenever a token happened to be selected would pop open
 * seconds after the fact, on a selection that had nothing to do with the cast.
 */
export function abilityRingWorthOpening(plan: AbilityRingPlan): boolean {
  return plan.template != null;
}

interface Props {
  engine: PixiVttApp;
  /** Derived by the shell through `abilityRingPlan`, not here: the shell has to
   *  ask whether the ring is worth opening at all before it mounts one, and a
   *  component that re-derived the answer could disagree with the gate that
   *  mounted it. */
  plan: AbilityRingPlan;
  onArmRoll: (label: string, expr?: string) => void;
  onRequestSave: (intent: VttTargetRollIntent) => void;
  onPlace: (kind: TemplateKind, cells: number) => void;
  onAim: (kind: TemplateKind, cells: number) => void;
  onOptions: () => void;
  onCancel: () => void;
}

/** Half a button plus the caption plate below the ring, so a clamped ring keeps
 *  its words on the canvas and not just its buttons. */
const RING_EDGE = RING_BUTTON / 2 + 30;

export function VttAbilityRing({ engine, plan, onArmRoll, onRequestSave, onPlace, onAim, onOptions, onCancel }: Props) {
  const ringRef = useRef<HTMLDivElement>(null);
  const btnRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const capRef = useRef<HTMLDivElement>(null);
  const [hint, setHint] = useState<string | null>(null);

  const { tokenId, at } = plan;
  const count = plan.actions.length;

  useEffect(() => {
    let raf = 0;
    const frame = () => {
      raf = requestAnimationFrame(frame);
      const ring = ringRef.current;
      if (!ring) return;
      // Read LIVE every frame, never captured at mount: the body under a cast
      // gets dragged, killed and deleted while the ring is still open, and a
      // ring holding a stale token would hang in empty space pointing at a
      // corpse that is no longer there.
      const token = tokenId ? engine.scene?.data.tokens.find((one) => one.id === tokenId) ?? null : null;
      const world = token ? engine.tokens.displayPosition(token.id) ?? token : at ?? engine.viewCenterWorld();
      const radius = ringRadius({
        camera: engine.camera,
        bodyCells: token?.size || 1,
        gridSize: engine.scene?.data.grid.size ?? 70,
        count,
      });
      const spot = ringPlacement({
        world,
        camera: engine.camera,
        radius,
        viewport: engine.viewportSize(),
        edge: RING_EDGE,
      });
      if (!spot) return;
      ring.style.left = `${spot.x}px`;
      ring.style.top = `${spot.y}px`;
      const offs = ringOffsets(count, spot.radius);
      for (let i = 0; i < offs.length; i++) {
        const button = btnRefs.current[i];
        if (button) button.style.transform = `translate(calc(-50% + ${offs[i].dx}px), calc(-50% + ${offs[i].dy}px))`;
      }
      const cap = capRef.current;
      if (cap) cap.style.transform = `translate(-50%, ${spot.radius + 26}px)`;
    };
    frame();
    return () => cancelAnimationFrame(raf);
  }, [engine, tokenId, at, count]);

  // The ring opens over the MAP; the dock chip that opened it sits later in the
  // document than the stage does. So Tab from that chip walks away from the ring
  // and never arrives, and a Curator driving by keyboard had no way in at all.
  // Taking focus is that way in — and because the caption reads focus as well as
  // hover, the first button lands already explained. Focus goes back to whatever
  // opened the ring when it closes, so Escape does not drop the Curator on the
  // body element halfway down their loadout.
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    // The GROUP, not its first button. Focusing a button would fire its own
    // `onFocus` and replace the caption's anchor note — "From the Medium", the
    // one line that says the ring is not hanging where the Curator's eye is —
    // before anybody had chosen anything. Landing on the group leaves that line
    // standing and puts the buttons one Tab away.
    ringRef.current?.focus({ preventScroll: true });
    return () => {
      if (opener && opener !== document.body && opener.isConnected) opener.focus({ preventScroll: true });
    };
  }, []);

  const run = (spec: RingActionSpec) => {
    const template = plan.template;
    switch (spec.kind) {
      case "place":
        if (template) onPlace(template.kind, template.cells);
        break;
      case "aim":
        if (template) onAim(template.kind, template.cells);
        break;
      case "roll":
        // Arms and stays open: the tray is a second surface the Curator now has
        // to press Roll in, and closing the ring under them would take the
        // template placement away mid-act.
        if (spec.arm) onArmRoll(`${plan.name} — ${spec.arm.label}`, spec.arm.expr);
        return;
      case "save":
        // Also stays open. An area ability asks the same save of every body it
        // caught, and closing after the first would make the Curator re-cast to
        // ask the second.
        if (spec.intent) onRequestSave(spec.intent);
        return;
      case "options":
        onOptions();
        break;
      case "cancel":
        break;
    }
    // Placement is one act. The ring closes rather than sitting on top of the
    // template it just dropped, which the Curator now needs to see and drag.
    onCancel();
  };

  return (
    <div className="vtt2-ring" ref={ringRef} role="group" tabIndex={-1} aria-label={`Using ${plan.name}`}>
      {plan.actions.map((spec, index) => (
        <button
          key={spec.key}
          ref={(el) => (btnRefs.current[index] = el)}
          type="button"
          className={`vtt2-ring-btn ${spec.kind}`}
          aria-label={spec.label}
          title={spec.detail ? `${spec.label} — ${spec.detail}` : spec.label}
          onMouseEnter={() => setHint(spec.label)}
          onMouseLeave={() => setHint(null)}
          onFocus={() => setHint(spec.label)}
          onBlur={() => setHint(null)}
          onClick={() => run(spec)}
        >
          <span aria-hidden="true">{spec.glyph}</span>
        </button>
      ))}
      <div className="vtt2-ring-cap" ref={capRef}>
        <span className="vtt2-ring-name">{plan.name}</span>
        {/* The pointed-at button's words, falling back to what the ring is
            anchored to. A glyph ring with no caption is a guessing game. */}
        <span className="vtt2-ring-hint">{hint ?? plan.anchorNote}</span>
      </div>
    </div>
  );
}
