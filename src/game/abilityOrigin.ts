// `Origin: Medium` — the ability does not fire from the caster's body.
//
// This is the frame a third of the corpus is written in and none of the app
// could see. Every one of the 148 Ciphers opens `Rank: … · Component: …`, and
// the Component is not flavour: WEAPONIZE mounts on an inanimate object, MASS
// DETECTION on the Inquisitor themselves, S4 — THE LAST WAR on the battlefield
// environment. A Seraph's Medium, a Remnant's echo and a Stygian's shadow are
// the same mechanism wearing three setting words. Where the origin IS decides
// where a range is measured from and where a template anchors, so an engine
// that assumed the caster's body was measuring from the wrong square every time
// a Cipher was mounted on something across the room.
//
// TWO SOURCES, ONE ANSWER. A page may declare `Origin:` in its `## Actions`
// block, and every official cipher already states the same thing in its header
// row. The block wins where both exist — an author who wrote the bullet said it
// deliberately — and the header answers for the entire undeclared corpus, which
// is the whole point: 148 Ciphers gain an origin without a single page edit.
//
// The header is read through `splitCipherEffect`, the same splitter the page
// generator round-trips through, rather than a second regex here. A private
// copy would drift from the emitter and start reporting origins for pages whose
// headers had moved on.
import type { EffectStep } from "./abilityEffects";
import { parseAbilityEffects } from "./abilityEffects";
import { splitCipherEffect } from "../lib/codexParse";

/** Where the origin word came from. A table looking at a wrong anchor needs to
 *  know whether to edit a bullet or a header row. */
export type OriginSource = "block" | "component";

export interface DeclaredOrigin {
  /** The `Origin:` bullet's text, when the block declares one. */
  declared: string | null;
  /** The `Component:` the authored header names, when the effect has that header. */
  component: string | null;
  /** The one the table is being asked to anchor to. Null means the ability
   *  never said, which for the great majority of Genus abilities is correct —
   *  they fire from the body, and there is nothing to place. */
  text: string | null;
  source: OriginSource | null;
  /**
   * The origin IS the caster's body, said the long way round.
   *
   * `Component: Animate (self)` and `Component: Self (all Cipher slots)` are
   * both origins, and both name the caster. Treating them as unplaceable
   * anchors would have asked the Curator to go find a "Self" on the map for
   * MASS DETECTION and ARMY OF ONE — an origin prompt on abilities that have
   * always fired from the body and always should.
   */
  isSelf: boolean;
}

const NONE: DeclaredOrigin = { declared: null, component: null, text: null, source: null, isSelf: false };

/** The header row runs into the sentence that follows it — "Component:
 *  Inanimate Object. ACTIVE MODIFICATION — …" — so the splitter hands back a
 *  Component with the full stop still attached. Left on, it is one character
 *  that no token name on any map will ever carry, and every origin in the
 *  shipped corpus would fail to match. */
const trimOrigin = (text: string): string => text.trim().replace(/[.,;:·]+$/, "").trim();

/** The caster's own body, however the page spells it. Narrow on purpose: a
 *  looser test would swallow "Group of targets", which is emphatically not the
 *  caster, and quietly anchor a four-target Cipher to the Inquisitor. */
const SELF_RE = /\b(?:self|caster|the inquisitor|own body)\b/i;

/** The `Origin:` a block declares — the FIRST one, because an ability fires
 *  from one place and a page listing two has not said which. */
export function originOf(steps: readonly EffectStep[]): string | null {
  return steps.find((step) => step.verb === "origin" && !!step.origin)?.origin ?? null;
}

/**
 * Read an ability for where it fires from.
 *
 * Deliberately takes the RAW block rather than parsed steps, so that the two
 * halves of a page — its header and its bullets — are read together in one
 * place. A caller holding steps already can pass them; the parse is shared.
 */
export function declaredOrigin(
  effect: string | null | undefined,
  actions: string | null | undefined,
  steps?: readonly EffectStep[]
): DeclaredOrigin {
  const raw = originOf(steps ?? parseAbilityEffects(actions).steps);
  const declared = raw ? trimOrigin(raw) || null : null;
  const rawComponent = splitCipherEffect(String(effect ?? ""))?.component;
  const component = rawComponent ? trimOrigin(rawComponent) || null : null;
  const text = declared ?? component;
  if (!text) return NONE;
  return {
    declared,
    component,
    text,
    source: declared ? "block" : "component",
    isSelf: SELF_RE.test(text),
  };
}

/**
 * The origin reduced to the words worth matching against a map.
 *
 * A Component carries a qualifier the map will never repeat — "Inanimate object
 * (light-interacting)", "Group of targets (up to 4)" — and matching on the full
 * string would find nothing for every cipher that has one. The parenthetical is
 * dropped; nothing else is, because guessing which of the remaining words is
 * the noun is how an origin ends up bound to the wrong body.
 */
export function originMatchText(text: string): string {
  return trimOrigin(text.replace(/\s*\([^)]*\)\s*/g, " ").replace(/\s+/g, " ")).toLowerCase();
}
