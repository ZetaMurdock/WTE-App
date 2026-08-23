// The Codex in force for one campaign, expressed as a wire-safe document.
//
// A campaign lives in the Curator's database. Players only have a TableLink with
// its id, so reading their own app-data pages can never reproduce the Curator's
// backgrounds, species, paradigms or other authored mechanics. This module makes
// that boundary explicit: the Curator builds one effective manifest, netplay
// sends the player-visible subset, and joined players use it in memory. Nothing
// received from a room is written into the player's personal Codex.
import { parseId, sameConcept, slugify, type IdKind } from "../game/codexId";
import { parseRollFormulaPage } from "../game/rollFormula";
import { listCodexPages, type StoredCodexPage } from "./codexPageRepo";
import { allPageMeta, getPageMeta, type PageMeta } from "./pageMeta";
import { readField } from "./pageIdentity";
import { isTauri } from "./tauri";
import {
  clearRoomCampaignRules,
  installRoomCampaignRules,
  loadLocalRules,
  parseRules,
  type CampaignRules,
} from "./campaignRules";
import {
  clearRoomRuleLayers,
  installRoomRuleLayers,
  listLocalRuleLayers,
} from "./ruleLayerRepo";
import { ID_SCOPES } from "../game/codexId";
import type { LayerOp, RuleLayer } from "../game/ruleLayers";

export const CAMPAIGN_CODEX_SCHEMA = 1 as const;
export const MAX_CAMPAIGN_CODEX_PAGES = 1_500;
export const MAX_CAMPAIGN_CODEX_PAGE_CHARS = 2 * 1024 * 1024;
export const MAX_CAMPAIGN_CODEX_CHARS = 20 * 1024 * 1024;
/** Leaves headroom under net/chunking's 24 MiB envelope ceiling. */
export const MAX_CAMPAIGN_CODEX_WIRE_CHARS = 20 * 1024 * 1024;
const MAX_CAMPAIGN_CODEX_ID_CHARS = 240;
const MAX_CAMPAIGN_CODEX_NAME_CHARS = 300;
const MAX_RULE_LAYER_NUMBER = 1_000_000;

export type CampaignCodexVisibility = "player" | "curator";
export type CampaignCodexSource = "official" | "campaign";

export interface CampaignCodexPage {
  /** Permanent semantic id when the page has one; a stable page id otherwise. */
  id: string;
  stem: string;
  title: string;
  /** Generic by design: new Codex kinds appear without changing this protocol. */
  kind: string;
  label?: string;
  content: string;
  visibility: CampaignCodexVisibility;
  /** Whether this page feeds the game-data catalogs and mechanics. */
  pulled: boolean;
  source: CampaignCodexSource;
  /** The owning campaign for a campaign page. */
  ownerId?: string;
  /** Official semantic id replaced by a campaign page. */
  overrides?: string;
  updatedAt?: number;
}

export interface CampaignCodexSnapshot {
  schema: typeof CAMPAIGN_CODEX_SCHEMA;
  campaignId: string;
  campaignName: string;
  /** Deterministic content revision, used to ignore duplicate room updates. */
  revision: string;
  generatedAt: number;
  /** Creation budgets and derived-stat policy owned by this campaign. */
  rules: CampaignRules;
  /** Declarative numeric rule/formula changes (never executable code). */
  ruleLayers: RuleLayer[];
  pages: CampaignCodexPage[];
}

function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const t = typeof window !== "undefined" ? window.__TAURI__ : undefined;
  if (!t?.core?.invoke) return Promise.reject(new Error("The desktop Codex is unavailable."));
  return t.core.invoke(cmd, args) as Promise<T>;
}

function cleanStem(value: unknown): string {
  return String(value ?? "").trim().replace(/\\/g, "/").split("/").pop()!.replace(/\.(md|markdown)$/i, "");
}

function pageTitle(content: string, stem: string): string {
  const heading = content.match(/^#{1,4}\s+(.+)$/m)?.[1];
  return (heading || stem).replace(/[*_`]/g, "").trim() || stem;
}

function pageKind(content: string, label?: string, storedKind?: string): string {
  const raw = readField(content, "Type") || storedKind || label || "Page";
  return raw.trim().toLowerCase().replace(/\s+/g, "-") || "page";
}

function pageVisibility(content: string, meta: PageMeta, stored?: CampaignCodexVisibility): CampaignCodexVisibility {
  const declared = (readField(content, "Visibility") || "").trim().toLowerCase();
  return meta.visibility === "gm" || stored === "curator" || declared === "gm" || declared === "curator"
    ? "curator"
    : "player";
}

const OFFICIAL_FALLBACK_KINDS: Readonly<Record<string, IdKind>> = {
  species: "species",
  paradigm: "paradigm",
  background: "background",
  weapon: "weapon",
  equipment: "gear",
  gear: "gear",
  formula: "formula",
  "roll-formula": "formula",
};

function officialFallbackKind(kind: string): IdKind {
  return Object.prototype.hasOwnProperty.call(OFFICIAL_FALLBACK_KINDS, kind)
    ? OFFICIAL_FALLBACK_KINDS[kind]
    : "page";
}

function pageId(
  content: string,
  stem: string,
  kind: string,
  source: CampaignCodexSource,
  campaignId?: string
): string {
  const declared = (readField(content, "ID") || "").trim();
  if (parseId(declared)) return declared;
  const slug = slugify(stem) || "page";
  const idKind = officialFallbackKind(kind);
  return source === "campaign" && campaignId
    ? `campaign.${slugify(campaignId)}.${idKind}.${slug}`
    : `wte.${idKind}.${slug}`;
}

function filePage(stemRaw: string, content: string, meta: PageMeta, campaignId: string): CampaignCodexPage {
  const stem = cleanStem(stemRaw);
  const declared = parseId((readField(content, "ID") || "").trim());
  const source: CampaignCodexSource = declared?.scope === "campaign" ? "campaign" : "official";
  const kind = pageKind(content, meta.label, declared?.kind);
  return {
    id: pageId(content, stem, kind, source, campaignId),
    stem,
    title: pageTitle(content, stem),
    kind,
    label: meta.label,
    content,
    visibility: pageVisibility(content, meta),
    pulled: meta.pulled,
    source,
    ownerId: source === "campaign" ? declared?.owner : undefined,
    overrides: readField(content, "Overrides") || undefined,
  };
}

function storedPage(page: StoredCodexPage, meta: PageMeta): CampaignCodexPage {
  const source: CampaignCodexSource = page.campaignId ? "campaign" : "official";
  const parsed = parseId(page.id);
  const kind = pageKind(page.content, meta.label, page.kind || parsed?.kind);
  return {
    id: parseId(page.id) ? page.id : pageId(page.content, page.stem, kind, source, page.campaignId),
    stem: cleanStem(page.stem),
    title: page.title || pageTitle(page.content, page.stem),
    kind,
    label: meta.label,
    content: page.content,
    visibility: pageVisibility(page.content, meta, page.visibility),
    pulled: meta.pulled,
    source,
    ownerId: page.campaignId || undefined,
    overrides: page.overrides || readField(page.content, "Overrides") || undefined,
    updatedAt: page.updatedAt,
  };
}

function pageIdentityMatchesSource(page: CampaignCodexPage, campaignId: string): boolean {
  const parsed = parseId(page.id);
  if (!parsed) return false;
  if (page.source === "campaign") {
    return parsed.scope === "campaign" && parsed.owner === slugify(campaignId) &&
      (page.ownerId === campaignId || page.ownerId === slugify(campaignId));
  }
  // Content packs are a supported official-baseline layer. Character/session
  // identities are never campaign-wide pages and must not arrive disguised as
  // official content.
  return (parsed.scope === "wte" || parsed.scope === "pack") && page.ownerId === undefined;
}

/** Deterministic, non-cryptographic content hash. It is a revision token, not an
 * authenticity claim; room authority is established by NetSession's host peer. */
export function campaignCodexRevision(
  pages: CampaignCodexPage[],
  rules?: CampaignRules,
  ruleLayers: RuleLayer[] = []
): string {
  let h = 0x811c9dc5;
  const ordered = [...pages].sort((a, b) => a.id.localeCompare(b.id) || a.stem.localeCompare(b.stem));
  const chunks = ordered.map((page) =>
    [
      page.id,
      page.stem,
      page.title,
      page.kind,
      page.label || "",
      page.visibility,
      page.pulled ? "1" : "0",
      page.source,
      page.ownerId || "",
      page.overrides || "",
      page.content,
    ].join("\u001f")
  );
  if (rules) chunks.push(JSON.stringify(parseRules(rules)));
  chunks.push(JSON.stringify([...ruleLayers].sort((a, b) => a.id.localeCompare(b.id))));
  for (const text of chunks) {
    for (let i = 0; i < text.length; i++) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
  }
  return `c${ordered.length}-${(h >>> 0).toString(36)}`;
}

/** Collapse a provenance manifest into the pages actually in force. A campaign
 * customization shadows the official page it names (or the same-stem official
 * page for older homebrew that predates `Overrides`). New campaign pages remain
 * alongside the official library. */
export function resolveCampaignCodexPages(pages: CampaignCodexPage[]): CampaignCodexPage[] {
  const campaignPages = pages.filter((page) => page.source === "campaign");
  const officialPages = pages.filter((page) => page.source === "official");
  const shadowed = new Set<string>();
  for (const campaignPage of campaignPages) {
    for (const officialPage of officialPages) {
      const explicit = campaignPage.overrides && campaignPage.overrides.toLowerCase() !== "none"
        ? campaignPage.overrides === officialPage.id
        : false;
      const legacySameStem = campaignPage.stem === officialPage.stem;
      const declaredSameConcept = !!campaignPage.overrides && sameConcept(campaignPage.id, officialPage.id);
      if (explicit || legacySameStem || declaredSameConcept) shadowed.add(officialPage.id);
    }
  }
  return [
    ...officialPages.filter((page) => !shadowed.has(page.id)),
    ...campaignPages,
  ];
}

/** A public pulled formula is shared game math, so the host must not publish a
 * snapshot that its own game-data loader will reject immediately afterwards. */
function assertValidPlayerRollFormulas(pages: readonly CampaignCodexPage[]): void {
  for (const page of pages) {
    if (!page.pulled) continue;
    const parsed = parseRollFormulaPage(page.content, page.stem);
    if (!parsed || parsed.ok) continue;
    throw new Error(`Roll Formula page “${page.title || page.stem}” is invalid: ${parsed.errors.join(" ")}`);
  }
}

/** Official files plus this campaign's stored additions/overrides. Stored rows
 * replace the same id (or same owner+stem) but never erase the official record an
 * override points at; the manifest needs both for provenance and safe forking. */
export async function buildCampaignCodexSnapshot(
  campaignId: string,
  campaignName = "",
  options: { playerOnly?: boolean } = {}
): Promise<CampaignCodexSnapshot> {
  const owner = campaignId.trim();
  if (!owner) throw new Error("A campaign Codex needs a campaign id.");
  const metaMap = allPageMeta();
  const pages: CampaignCodexPage[] = [];

  if (isTauri()) {
    const stems = await invoke<string[]>("wte_list_pages");
    if (stems.length > MAX_CAMPAIGN_CODEX_PAGES) {
      throw new Error(`The Codex has ${stems.length} pages; the supported limit is ${MAX_CAMPAIGN_CODEX_PAGES}.`);
    }
    for (const raw of stems) {
      const stem = cleanStem(raw);
      if (!stem) continue;
      const content = await invoke<string>("wte_load_page", { path: raw });
      if (content.length > MAX_CAMPAIGN_CODEX_PAGE_CHARS) {
        throw new Error(`Codex page “${stem}” exceeds the supported per-page size.`);
      }
      const page = filePage(stem, content, getPageMeta(stem, metaMap), owner);
      // AppData is global to the installation and may still contain a file that
      // belongs to another campaign. It must not leak into this one.
      if (page.source === "campaign" && page.ownerId !== slugify(owner)) continue;
      pages.push(page);
    }
  }

  // The table may not exist in an older database; listCodexPages deliberately
  // degrades to [] in that supported state.
  const stored = await listCodexPages(owner);
  for (const row of stored) {
    if (!row.content) continue;
    if (row.content.length > MAX_CAMPAIGN_CODEX_PAGE_CHARS) {
      throw new Error(`Campaign Codex page “${row.stem}” exceeds the supported per-page size.`);
    }
    const next = storedPage(row, getPageMeta(row.stem, metaMap));
    // The editor writes a file and an owned row for legacy compatibility. Keep
    // the owned row, which carries enforced campaign ownership and visibility.
    const duplicate = pages.findIndex((p) => p.id === next.id || (p.stem === next.stem && p.source === next.source));
    if (duplicate >= 0) pages[duplicate] = next;
    else pages.push(next);
  }

  const permitted = pages.filter((p) => !options.playerOnly || p.visibility === "player");
  // Players need only the effective document. The Curator dashboard keeps the
  // full provenance manifest so it can show both an official page and its fork.
  const visible = options.playerOnly ? resolveCampaignCodexPages(permitted) : permitted;
  if (options.playerOnly) assertValidPlayerRollFormulas(visible);
  if (visible.length > MAX_CAMPAIGN_CODEX_PAGES) {
    throw new Error(`The effective campaign Codex has ${visible.length} pages; the supported limit is ${MAX_CAMPAIGN_CODEX_PAGES}.`);
  }
  let chars = 0;
  const bounded: CampaignCodexPage[] = [];
  for (const page of visible) {
    if (!pageIdentityMatchesSource(page, owner)) {
      throw new Error(`Codex page “${page.title || page.stem}” has an identity that does not match its source or campaign.`);
    }
    chars += page.content.length;
    if (chars > MAX_CAMPAIGN_CODEX_CHARS) {
      throw new Error("The effective campaign Codex exceeds the supported total size.");
    }
    bounded.push(page);
  }
  const rules = loadLocalRules(owner);
  const localRuleLayers = await listLocalRuleLayers(owner);
  // Notes explain Curator intent but do not affect arithmetic. Keep them out of
  // the player wire document so a private annotation cannot hitchhike with the
  // public numeric operation.
  const candidateRuleLayers = options.playerOnly
    ? localRuleLayers.map((layer) => {
        const publicLayer = { ...layer };
        delete publicLayer.note;
        return publicLayer;
      })
    : localRuleLayers;
  const ruleLayers = parseRuleLayers(candidateRuleLayers, owner, { allowNotes: !options.playerOnly });
  if (!ruleLayers) throw new Error("The campaign contains an invalid or out-of-range rule layer.");
  const cleanName = campaignName.trim();
  if (cleanName.length > MAX_CAMPAIGN_CODEX_NAME_CHARS) {
    throw new Error(`The campaign name exceeds ${MAX_CAMPAIGN_CODEX_NAME_CHARS} characters.`);
  }
  const snapshot: CampaignCodexSnapshot = {
    schema: CAMPAIGN_CODEX_SCHEMA,
    campaignId: owner,
    campaignName: cleanName,
    revision: campaignCodexRevision(bounded, rules, ruleLayers),
    generatedAt: Date.now(),
    rules,
    ruleLayers,
    pages: bounded,
  };
  if (JSON.stringify(snapshot).length > MAX_CAMPAIGN_CODEX_WIRE_CHARS) {
    throw new Error("The serialized campaign Codex exceeds the supported network size.");
  }
  return snapshot;
}

const LAYER_OPS: LayerOp[] = ["set", "add", "multiply", "min", "max"];

function parseSnapshotRules(raw: unknown): CampaignRules | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Partial<CampaignRules>;
  if (
    typeof value.attrBudget !== "boolean" ||
    typeof value.attrBudgetPoints !== "number" || !Number.isFinite(value.attrBudgetPoints) ||
    typeof value.specTotal !== "number" || !Number.isFinite(value.specTotal) ||
    typeof value.poolCompensation !== "boolean"
  ) return null;
  const parsed = parseRules(value);
  // parseRules deliberately clamps damaged local storage. A network document is
  // different: silently changing the Curator's numbers would make two peers use
  // different rules, so out-of-range/non-integral data is rejected instead.
  if (parsed.attrBudgetPoints !== value.attrBudgetPoints || parsed.specTotal !== value.specTotal) return null;
  return parsed;
}

function parseRuleLayers(
  raw: unknown,
  campaignId: string,
  options: { allowNotes?: boolean } = {}
): RuleLayer[] | null {
  if (!Array.isArray(raw) || raw.length > 5_000) return null;
  const out: RuleLayer[] = [];
  const ids = new Set<string>();
  for (const value of raw) {
    if (!value || typeof value !== "object") return null;
    const l = value as Partial<RuleLayer>;
    if (
      typeof l.id !== "string" || !l.id || l.id.length > MAX_CAMPAIGN_CODEX_ID_CHARS || ids.has(l.id) ||
      typeof l.targetId !== "string" || !parseId(l.targetId) || l.targetId.length > MAX_CAMPAIGN_CODEX_ID_CHARS ||
      !ID_SCOPES.includes(l.scope as RuleLayer["scope"]) || !LAYER_OPS.includes(l.op as LayerOp) ||
      typeof l.value !== "number" || !Number.isFinite(l.value) || Math.abs(l.value) > MAX_RULE_LAYER_NUMBER ||
      (l.owner !== undefined && (typeof l.owner !== "string" || !l.owner || l.owner.length > MAX_CAMPAIGN_CODEX_ID_CHARS)) ||
      (l.note !== undefined && (!options.allowNotes || typeof l.note !== "string" || l.note.length > 500)) ||
      (l.enabled !== undefined && typeof l.enabled !== "boolean") ||
      (l.order !== undefined && (
        typeof l.order !== "number" || !Number.isFinite(l.order) || !Number.isInteger(l.order) ||
        Math.abs(l.order) > MAX_RULE_LAYER_NUMBER
      ))
    ) return null;
    // A player's campaign snapshot must not smuggle in another campaign's layer.
    if (
      (l.scope === "wte" && l.owner !== undefined) ||
      (l.scope !== "wte" && !l.owner) ||
      (l.scope === "campaign" && l.owner !== campaignId)
    ) return null;
    ids.add(l.id);
    const scope = l.scope as RuleLayer["scope"];
    const op = l.op as LayerOp;
    out.push({
      id: l.id,
      targetId: l.targetId,
      scope,
      owner: l.owner,
      op,
      value: l.value,
      note: l.note,
      enabled: l.enabled,
      order: l.order,
    });
  }
  return out;
}

/** Fail-closed validation for a document received from the room. Curator-only
 * pages are rejected rather than merely hidden: their content must never enter a
 * player's process. */
export function parseCampaignCodexSnapshot(raw: unknown, expectedCampaignId?: string): CampaignCodexSnapshot | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Partial<CampaignCodexSnapshot>;
  if (
    value.schema !== CAMPAIGN_CODEX_SCHEMA || typeof value.campaignId !== "string" || !value.campaignId ||
    value.campaignId.length > MAX_CAMPAIGN_CODEX_ID_CHARS ||
    (expectedCampaignId && value.campaignId !== expectedCampaignId) ||
    typeof value.campaignName !== "string" || value.campaignName.length > MAX_CAMPAIGN_CODEX_NAME_CHARS ||
    typeof value.revision !== "string" || !value.revision || value.revision.length > 120 ||
    typeof value.generatedAt !== "number" || !Number.isFinite(value.generatedAt) || !Array.isArray(value.pages) ||
    value.pages.length > MAX_CAMPAIGN_CODEX_PAGES
  ) return null;
  const rules = parseSnapshotRules(value.rules);
  if (!rules) return null;
  const ruleLayers = parseRuleLayers(value.ruleLayers, value.campaignId);
  if (!ruleLayers) return null;

  let chars = 0;
  const pages: CampaignCodexPage[] = [];
  const pageIds = new Set<string>();
  for (const rawPage of value.pages) {
    if (!rawPage || typeof rawPage !== "object") return null;
    const p = rawPage as Partial<CampaignCodexPage>;
    if (
      typeof p.id !== "string" || !p.id || p.id.length > MAX_CAMPAIGN_CODEX_ID_CHARS ||
      typeof p.stem !== "string" || !p.stem || p.stem.length > MAX_CAMPAIGN_CODEX_ID_CHARS || cleanStem(p.stem) !== p.stem ||
      typeof p.title !== "string" || p.title.length > MAX_CAMPAIGN_CODEX_NAME_CHARS ||
      typeof p.kind !== "string" || !p.kind || p.kind.length > 80 ||
      typeof p.content !== "string" || p.content.length > MAX_CAMPAIGN_CODEX_PAGE_CHARS ||
      p.visibility !== "player" || typeof p.pulled !== "boolean" ||
      (p.source !== "official" && p.source !== "campaign") ||
      (p.label !== undefined && (typeof p.label !== "string" || p.label.length > 120)) ||
      (p.ownerId !== undefined && (typeof p.ownerId !== "string" || p.ownerId.length > MAX_CAMPAIGN_CODEX_ID_CHARS)) ||
      (p.overrides !== undefined && (typeof p.overrides !== "string" || p.overrides.length > MAX_CAMPAIGN_CODEX_ID_CHARS)) ||
      pageIds.has(p.id)
    ) return null;
    if (!pageIdentityMatchesSource(p as CampaignCodexPage, value.campaignId)) return null;
    pageIds.add(p.id);
    chars += p.content.length;
    if (chars > MAX_CAMPAIGN_CODEX_CHARS) return null;
    pages.push({
      id: p.id,
      stem: p.stem,
      title: p.title,
      kind: p.kind,
      label: p.label,
      content: p.content,
      visibility: "player",
      pulled: p.pulled,
      source: p.source,
      ownerId: p.ownerId,
      overrides: p.overrides,
      updatedAt: typeof p.updatedAt === "number" && Number.isFinite(p.updatedAt) ? p.updatedAt : undefined,
    });
  }
  const parsed: CampaignCodexSnapshot = {
    schema: CAMPAIGN_CODEX_SCHEMA,
    campaignId: value.campaignId,
    campaignName: value.campaignName,
    revision: value.revision,
    generatedAt: value.generatedAt,
    rules,
    ruleLayers,
    pages,
  };
  if (JSON.stringify(parsed).length > MAX_CAMPAIGN_CODEX_WIRE_CHARS) return null;
  // Do not trust a sender-provided revision that disagrees with its contents.
  return campaignCodexRevision(pages, rules, ruleLayers) === parsed.revision ? parsed : null;
}

let roomSnapshot: CampaignCodexSnapshot | null = null;
export type RoomCodexState =
  | { status: "idle" }
  | { status: "syncing"; campaignId: string }
  | { status: "ready"; campaignId: string; revision: string; pageCount: number }
  | { status: "error"; campaignId: string; message: string };
let roomState: RoomCodexState = { status: "idle" };
const roomListeners = new Set<() => void>();

function announceRoomState(): void {
  for (const listener of roomListeners) listener();
}

export function roomCodexState(): RoomCodexState {
  return roomState;
}

export function onRoomCodexChanged(listener: () => void): () => void {
  roomListeners.add(listener);
  return () => roomListeners.delete(listener);
}

export function markRoomCodexSyncing(campaignId: string): void {
  if (!campaignId || (roomState.status === "syncing" && roomState.campaignId === campaignId)) return;
  roomState = { status: "syncing", campaignId };
  announceRoomState();
}

export function markRoomCodexError(campaignId: string, message: string): void {
  roomState = { status: "error", campaignId, message };
  announceRoomState();
}

export function activeRoomCodex(): CampaignCodexSnapshot | null {
  return roomSnapshot;
}

export function installRoomCodex(snapshot: CampaignCodexSnapshot): boolean {
  if (roomSnapshot?.campaignId === snapshot.campaignId && roomSnapshot.revision === snapshot.revision) {
    return false;
  }
  roomSnapshot = snapshot;
  installRoomCampaignRules(snapshot.campaignId, snapshot.rules);
  installRoomRuleLayers(snapshot.campaignId, snapshot.ruleLayers);
  // Receiving bytes is not the same as applying them. Character creation stays
  // gated until loadCodexGameData has rebuilt every singleton catalog from this
  // exact revision, preventing a brief render with the player's local options.
  roomState = { status: "syncing", campaignId: snapshot.campaignId };
  announceRoomState();
  return true;
}

/** Called only after the room snapshot has successfully compiled into live game
 * data. A stale load cannot mark a newer room/campaign ready. */
export function markRoomCodexReady(campaignId: string, revision: string): boolean {
  if (!roomSnapshot || roomSnapshot.campaignId !== campaignId || roomSnapshot.revision !== revision) return false;
  const next: RoomCodexState = {
    status: "ready",
    campaignId,
    revision,
    pageCount: roomSnapshot.pages.length,
  };
  if (
    roomState.status === "ready" && roomState.campaignId === campaignId &&
    roomState.revision === revision && roomState.pageCount === next.pageCount
  ) return false;
  roomState = next;
  announceRoomState();
  return true;
}

export function clearRoomCodex(): boolean {
  const changed = roomSnapshot !== null || roomState.status !== "idle";
  roomSnapshot = null;
  clearRoomCampaignRules();
  clearRoomRuleLayers();
  roomState = { status: "idle" };
  if (changed) announceRoomState();
  return changed;
}

/** Page content for readers/editors. A joined player's authoritative room copy
 * wins. Locally, a campaign-owned row wins over the global file. */
export async function loadEffectiveCodexPage(stemRaw: string, campaignId?: string | null): Promise<CampaignCodexPage | null> {
  const stem = cleanStem(stemRaw);
  if (!stem) return null;
  if (roomSnapshot && (!campaignId || roomSnapshot.campaignId === campaignId)) {
    return roomSnapshot.pages.find((p) => p.stem === stem && p.source === "campaign")
      ?? roomSnapshot.pages.find((p) => p.stem === stem)
      ?? null;
  }
  if (campaignId) {
    const stored = await listCodexPages(campaignId);
    const hit = stored.find((p) => cleanStem(p.stem) === stem);
    if (hit) return storedPage(hit, getPageMeta(hit.stem));
  }
  if (!isTauri()) return null;
  try {
    const content = await invoke<string>("wte_load_page", { path: stem });
    return filePage(stem, content, getPageMeta(stem), campaignId || "");
  } catch {
    return null;
  }
}

/** Effective page names for the Codex browser. */
export async function listEffectiveCodexPages(campaignId?: string | null): Promise<CampaignCodexPage[]> {
  if (roomSnapshot && (!campaignId || roomSnapshot.campaignId === campaignId)) {
    return resolveCampaignCodexPages(roomSnapshot.pages);
  }
  if (!campaignId) {
    if (!isTauri()) return [];
    const stems = await invoke<string[]>("wte_list_pages");
    const out: CampaignCodexPage[] = [];
    for (const stem of stems) {
      const page = await loadEffectiveCodexPage(stem, null);
      if (page) out.push(page);
    }
    return out;
  }
  return resolveCampaignCodexPages((await buildCampaignCodexSnapshot(campaignId)).pages);
}

/** The mechanically authoritative, player-safe view. Curator-only prose and
 * records remain browsable by the Curator, but they cannot alter shared character
 * math unless a sanitized public mechanic exists: otherwise the host and player
 * would compile different rules from the same campaign. */
export async function listCampaignMechanicPages(campaignId?: string | null): Promise<CampaignCodexPage[]> {
  if (roomSnapshot && (!campaignId || roomSnapshot.campaignId === campaignId)) {
    return resolveCampaignCodexPages(roomSnapshot.pages).filter((page) => page.visibility === "player");
  }
  if (campaignId) return (await buildCampaignCodexSnapshot(campaignId, "", { playerOnly: true })).pages;
  return (await listEffectiveCodexPages(null)).filter((page) => page.visibility === "player");
}
