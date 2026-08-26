// The Standard Null Ruling, as the corpus states it — and only as it states it.
//
// WHAT THE CORPUS SAYS. Every energy domain page carries an `| SNR Status |`
// row, and there are exactly three answers in `genus.json`:
//
//   Null      applies  "All Null abilities resolve before Reactions can be
//                       declared — unless specifically intercepted by another
//                       Null ability (Negate or Reflect)."
//   Photonic  anti     "Photonic abilities resolve faster than normal attacks
//                       and gain advantage on offensive Checks other than Null."
//   others    none     "…resolve in normal initiative order and can be
//                       intercepted by standard Reactions."
//
// This module never writes those sentences. It reads them off the domain record,
// so a table that forks a domain page and rewrites its SNR Status gets its own
// words at the table — no hidden compiled rule to fork around.
//
// ONE SOURCE: THE DOMAIN ENUM. SNR is double-encoded in the shipped corpus — 17
// Null abilities also say it in free text ("Active (SNR)", "Active (Instant —
// SNR)", "Reaction (SNR)"), and Photonic's Lock Move says "Active (SNR speed —
// resolves before movement)". Nothing here parses that prose. An activation
// string is a sentence for a human; the enum is the field, and re-deriving a
// scheduling posture from prose would give an ability two answers that could
// disagree the moment somebody rewords one. `snr.test.ts` guards the drift the
// other way round — an SNR-less domain acquiring an "Active (SNR)" activation —
// so an authoring mistake is caught rather than silently ignored.
//
// INFORMATION, NOT ENFORCEMENT — and this is a deliberate, honest limit:
//
//   SNR is a rule about REACTIONS and INTERRUPTS. `Action_Priority.md` states
//   the setting's temporal system, and it is explicit that priority "does not
//   create strict turn order" — it governs who interrupts whom. The app has no
//   such machinery. `VttEncounterData` is a flat list sorted by one `initiative`
//   number (`orderedCombatants`); there is no reaction to declare, no interrupt
//   to win, and no window for a Null ability to resolve BEFORE. There is
//   therefore nothing here for an engine to enforce, and an engine that
//   reordered a turn list on its own would be inventing a rule the corpus never
//   asked for.
//
//   So SNR is SHOWN, at the two moments a Curator is deciding what resolves —
//   arming an ability, and adjudicating what it did — and the ordering call
//   stays a human's, exactly as `Action_Priority.md` describes it.
//
// A GAP FOR THE CURATOR: the Null page ends its SNR Status with "See the
// Pressure Engine for the full SNR intercept table." There is no such table.
// `src/rules/Pressure_Engine.md` does not mention SNR at all, and neither does
// `Combat.md` or `Action_Priority.md`. What happens when two Null abilities meet
// — the Negate/Reflect intercept the page names — is unwritten, and no code here
// guesses at it.
import { domainOfGenus, getGenusDomain, type SnrPosture } from "./wte";

export interface SnrReading {
  /** The domain the ability belongs to, by its current name. */
  domain: string;
  posture: SnrPosture;
  /** Chip text. Kept to the words the sheet's Genus contest panel already uses,
   *  so one posture does not read two ways in one app. */
  label: string;
  /** The domain page's own SNR Status sentence, verbatim — the tooltip, and the
   *  whole of what this app claims SNR means. */
  note: string;
}

const LABELS: Readonly<Record<SnrPosture, string>> = {
  applies: "SNR",
  anti: "anti-SNR",
  none: "no SNR",
};

/**
 * Where one ability sits in resolution order, according to its domain page.
 *
 * Accepts a permanent ability id OR a name, because `domainOfGenus` does: a
 * migrated sheet stores `wte.genus.lark`, and a name-only lookup would quietly
 * lose the ability's posture. Null for anything that belongs to no energy domain
 * — a cipher, a weapon action, a homebrew page — which is a real answer and not
 * a failure: SNR is a property of a DOMAIN, and those have none.
 */
export function snrReading(ref: string | null | undefined): SnrReading | null {
  const domain = domainOfGenus(String(ref ?? ""));
  if (!domain) return null;
  const record = getGenusDomain(domain);
  if (!record) return null;
  return { domain, posture: record.snr, label: LABELS[record.snr] ?? LABELS.none, note: record.snrNote };
}

/**
 * The same reading, but only when there is something to say.
 *
 * `none` is the corpus's default and covers three domains and 57 abilities; a
 * chip on every one of them would be a badge that means "normal", which is how a
 * surface teaches a table to stop reading its badges. The two postures that
 * change resolution order get the chip; the rest get silence, which is what
 * "resolves in normal initiative order" looks like.
 */
export function snrChip(ref: string | null | undefined): SnrReading | null {
  const reading = snrReading(ref);
  return reading && reading.posture !== "none" ? reading : null;
}
