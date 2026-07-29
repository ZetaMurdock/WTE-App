// The one Codex registry the running app asks.
//
// THE PROPERTY THIS FILE EXISTS FOR
//
// Official mechanics are built SYNCHRONOUSLY, at module load, from genus.json.
// Nothing about reading Codex pages — a locked database, an unreadable file, a
// failed listing, a page that will not parse — can subtract an ability from the
// app. The worst a page pass can do is leave the Codex knowing less about where
// to find things; it can never make a character's abilities disappear.
//
// That inverts how the old loader worked. `mergeAbilities` let a pulled page
// DELETE a baked official ability by name and put its own version in place, so a
// wiki mirror that was a revision behind silently rewrote live rules — and if the
// page failed to parse, the ability came back, which meant the mechanics your
// table played by depended on whether a file happened to read cleanly that
// morning.
//
// States, and what each one permits:
//   loading   official mechanics are live; the page pass has not finished.
//             Safe to READ. Never safe to migrate.
//   ready     everything loaded and the registry found no faults.
//   degraded  usable, but something is wrong — duplicate ids, an overrides cycle,
//             a record that could not be indexed, or a page pass that partly
//             failed. Safe to READ. Never safe to migrate.
//   failed    the synchronous official build threw. This should be impossible; it
//             means the shipped data file is broken.
import { buildCampaignGenus, buildOfficialGenus, type GenusManifest, type GenusPage } from "./codexGenusSource";
import { CodexRegistry, type RegistryProblem, type RegistryStatus, type ResolveContext } from "./codexRegistry";
import { planGenusMigration, type MigrationPlan } from "./genusRef";

export interface PageSkip {
  stem: string;
  reason: string;
  /**
   * True when this page could have carried MEANING and we could not read it —
   * an I/O failure on a page that might define a campaign rule. A page that
   * simply has no Type row is lore, and lore going unparsed is normal.
   *
   * The distinction decides whether a pass is trustworthy enough to replace the
   * registry, so conflating the two would let one unreadable file discard every
   * campaign override the app had.
   */
  semantic?: boolean;
}

/** What a page pass found. Every field is something the app can be honest about. */
export interface CodexPageInput {
  /** Mirror pages for official abilities — provenance only, never mechanics. */
  officialMirrors: GenusPage[];
  /** Campaign-authored pages, which DO carry mechanics, as scoped layers. */
  campaignPages: GenusPage[];
  campaignId: string;
  /** Pages that were listed but could not be used, and why. */
  skipped: PageSkip[];
  /** The page listing itself failed — so `officialMirrors` being empty means
   *  "we do not know", not "there are none". */
  listFailed?: string;
  /** What the grouped-page scan found, including official abilities it could not
   *  locate and domains whose page is missing entirely. */
  corpus?: {
    unlocated: string[];
    domainMismatch: { missingPages: string[]; unknownPages: string[] };
  };
}

let registry = new CodexRegistry();
let manifest: GenusManifest = { pages: new Map(), aliases: new Map() };
let officialProblems: RegistryProblem[] = [];
let pageProblems: RegistryProblem[] = [];
let skipped: PageSkip[] = [];
let state: RegistryStatus = "loading";
let lastPages: CodexPageInput | null = null;
/** The last page pass that was complete enough to trust. Kept so a transient
 *  failure degrades the service without rewinding it to official-only. */
let lastGood: CodexPageInput | null = null;
/** Monotonic pass counter, so a slow load cannot land on top of a fast one. */
let newestApplied = -1;
let nextToken = 0;

/** Claim a place in the ordering. Pass the result to applyCodexPages. */
export function beginCodexLoad(): number {
  return nextToken++;
}

/** Why a pass was not trusted, in words. */
function describeFailure(input: CodexPageInput): RegistryProblem[] {
  const out: RegistryProblem[] = [];
  if (input.listFailed) {
    out.push({
      kind: "unusable-record",
      detail: `the Codex pages could not be listed (${input.listFailed}) — showing the last good load`,
      ids: [],
      severity: "error",
    });
  }
  for (const s of input.skipped.filter((x) => x.semantic)) {
    out.push({
      kind: "unusable-record",
      detail: `the page "${s.stem}" could not be read: ${s.reason} — showing the last good load`,
      ids: [],
      severity: "error",
    });
  }
  return out;
}

/** Build the 98 official abilities. Synchronous, and the only thing that can fail
 *  the whole service. */
function buildOfficial(): void {
  try {
    const built = buildOfficialGenus();
    registry = new CodexRegistry(built.entities);
    manifest = built.manifest;
    officialProblems = built.problems;
    state = "loading";
  } catch (e) {
    // The shipped data file is unreadable. Nothing else in here can help.
    registry = new CodexRegistry();
    officialProblems = [
      {
        kind: "unusable-record",
        detail: `the official Genus data could not be loaded: ${e instanceof Error ? e.message : String(e)}`,
        ids: [],
        severity: "error",
      },
    ];
    state = "failed";
  }
}

buildOfficial();

const CHANGED = "wte-codex-changed";
function announce(): void {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(CHANGED));
}

/**
 * Fold a completed page pass into the registry.
 *
 * Rebuilds from the data file every time rather than layering onto whatever is
 * already there, so a page that stops existing stops affecting the Codex.
 */
export function applyCodexPages(input: CodexPageInput, token?: number): void {
  if (state === "failed") return; // nothing to attach pages to

  // Latest result wins. Two page passes can be in flight at once — a campaign
  // switch while the first is still reading — and without this the SLOWER one
  // lands last and the Codex ends up describing the campaign you left.
  if (token !== undefined) {
    if (token < newestApplied) return;
    newestApplied = token;
  }

  // A pass that could not see the pages is not evidence that the rules changed.
  // Replacing the registry from it would drop every campaign override the last
  // good pass found and quietly hand the table the official rules instead.
  const trustworthy = !input.listFailed && !input.skipped.some((s) => s.semantic);
  if (!trustworthy && lastGood) {
    skipped = input.skipped;
    lastPages = input;
    pageProblems = describeFailure(input);
    state = "degraded";
    announce();
    return;
  }

  lastPages = input;
  skipped = input.skipped;
  const problems: RegistryProblem[] = [];

  const official = buildOfficialGenus(input.officialMirrors);
  officialProblems = official.problems;
  manifest = official.manifest;

  let campaign = { entities: [] as ReturnType<typeof buildCampaignGenus>["entities"], problems: [] as RegistryProblem[] };
  if (input.campaignPages.length && input.campaignId) {
    campaign = buildCampaignGenus(input.campaignPages, input.campaignId);
  }
  problems.push(...campaign.problems);

  if (input.listFailed) {
    problems.push({
      kind: "unusable-record",
      detail: `the Codex pages could not be listed (${input.listFailed}), so page links and campaign rules may be missing`,
      ids: [],
      severity: "error",
    });
  }
  for (const s of input.skipped) {
    problems.push({
      kind: "unusable-record",
      detail: `the page "${s.stem}" was not used: ${s.reason}`,
      ids: [],
      // A page that will not parse is worth saying, but it does not make the
      // rules untrustworthy — the official mechanics are not sourced from pages.
      severity: "warning",
    });
  }
  // Content gaps in the corpus. Neither costs anyone a rule — the mechanics are
  // in the data file — but "this ability has no page" and "this whole domain has
  // no page" are both worth a Curator's attention rather than a silent blank.
  if (input.corpus) {
    const { unlocated, domainMismatch } = input.corpus;
    if (unlocated.length) {
      problems.push({
        kind: "page-drift",
        detail: `${unlocated.length} official abilities have no page to open (${unlocated.slice(0, 3).join(", ")}${unlocated.length > 3 ? ", …" : ""})`,
        ids: [],
        severity: "warning",
      });
    }
    for (const d of domainMismatch.missingPages) {
      problems.push({
        kind: "page-drift",
        detail: `the "${d}" domain has no Codex page installed`,
        ids: [],
        severity: "warning",
      });
    }
    for (const stem of domainMismatch.unknownPages) {
      problems.push({
        kind: "page-drift",
        detail: `the Codex page "${stem}" describes a Genus domain the rules data does not have`,
        ids: [],
        severity: "warning",
      });
    }
  }
  pageProblems = problems;

  // Never empty the registry. replaceAll([]) would discard the 98 official
  // abilities, which is the one thing a page pass must never be able to do.
  const next = [...official.entities, ...campaign.entities];
  if (next.length) registry.replaceAll(next);

  const bad = registry.status() === "degraded" || problems.some((p) => p.severity === "error");
  state = bad ? "degraded" : "ready";
  if (!bad) lastGood = input;
  announce();
}

/** The page pass did not run at all — not the desktop app, so there are no pages.
 *  That is a finished state, not a stuck one. */
export function noCodexPages(): void {
  if (state === "failed") return;
  state = registry.status() === "degraded" ? "degraded" : "ready";
  announce();
}

export function codexRegistry(): CodexRegistry {
  return registry;
}
export function codexManifest(): GenusManifest {
  return manifest;
}
export function codexStatus(): RegistryStatus {
  return state;
}
/** Everything wrong, from the data file, the pages, and the index alike. */
export function codexHealth(): RegistryProblem[] {
  return [...officialProblems, ...pageProblems, ...registry.health()];
}
export function codexSkipped(): PageSkip[] {
  return [...skipped];
}

/**
 * May a character be permanently rewritten against this Codex right now?
 *
 * Only when everything loaded and nothing is wrong. `loading` is excluded on
 * purpose: the page pass may still be about to introduce the campaign override
 * that changes which concept a name resolves to.
 */
export function codexCanMigrate(): boolean {
  return state === "ready";
}

/**
 * THE way a character's Genus keys get rewritten. There is no other.
 *
 * Callers used to have to remember to check codexCanMigrate() before calling
 * planGenusMigration, which is the kind of rule that holds until the day someone
 * adds a second call site. The check is in here now, so forgetting is impossible:
 * a Codex that is loading, degraded or failed returns a plan that changes nothing
 * and says why.
 */
export function planGenusMigrationSafely(
  spend: Record<string, number>,
  ctx: ResolveContext
): MigrationPlan {
  if (!codexCanMigrate()) {
    return {
      next: { ...spend },
      migrated: [],
      kept: Object.keys(spend ?? {}).map((stored) => ({ stored, reason: "registry-degraded" as const })),
      conflicts: [],
      changed: false,
      blocked: "registry-degraded",
    };
  }
  return planGenusMigration(spend, registry, { ...ctx, kind: "genus" });
}

export function onCodexChanged(fn: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(CHANGED, fn);
  return () => window.removeEventListener(CHANGED, fn);
}

/** Test seam: back to a freshly-built official-only registry. */
export function __resetCodexService(): void {
  buildOfficial();
  pageProblems = [];
  skipped = [];
  lastPages = null;
  lastGood = null;
  newestApplied = -1;
  nextToken = 0;
}

/** What the last page pass was given, for Diagnostics. */
export function lastCodexPageInput(): CodexPageInput | null {
  return lastPages;
}

/** The context a resolution needs. Kind is left to the caller. */
export function codexContext(opts: {
  role: "player" | "curator";
  campaignId?: string;
  characterId?: string;
  sessionId?: string;
  packIds?: string[];
}): ResolveContext {
  return { ...opts };
}
