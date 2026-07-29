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

export interface PageSkip {
  stem: string;
  reason: string;
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
}

let registry = new CodexRegistry();
let manifest: GenusManifest = { pages: new Map(), aliases: new Map() };
let officialProblems: RegistryProblem[] = [];
let pageProblems: RegistryProblem[] = [];
let skipped: PageSkip[] = [];
let state: RegistryStatus = "loading";
let lastPages: CodexPageInput | null = null;

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
export function applyCodexPages(input: CodexPageInput): void {
  if (state === "failed") return; // nothing to attach pages to
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
  pageProblems = problems;

  // Never empty the registry. replaceAll([]) would discard the 98 official
  // abilities, which is the one thing a page pass must never be able to do.
  const next = [...official.entities, ...campaign.entities];
  if (next.length) registry.replaceAll(next);

  state = registry.status() === "degraded" || problems.some((p) => p.severity === "error") ? "degraded" : "ready";
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
