// Campaign-global identity for character tokens.
//
// Scene JSON remains the renderer's source of token positions, but it cannot by
// itself answer "where is this character now?": historically every scene could
// contain another copy of the same character.  This registry gives each linked
// character one profile (customisation) and one active presence (token + scene).
// All transforms below are pure.  Callers can preview/report a migration before
// saving either the scenes or the registry.
import { kvGet, kvSet } from "../../lib/campaignStore";
import type { VttScene, VttToken, VttTokenMeta } from "../types/scene";
import { nearestFreeCell } from "./occupancy";

export const TOKEN_REGISTRY_VERSION = 1 as const;
export const TOKEN_REGISTRY_KEY = "vtt-token-registry-v1";

export interface TokenAppearance {
  name: string;
  color: string;
  size: number;
  img?: string | null;
  vision?: number;
}

export interface TokenProfile {
  /** Stable and deterministic; the record itself is keyed by sourceId as well. */
  id: string;
  campaignId: string;
  sourceKind: "character";
  sourceId: string;
  appearance: TokenAppearance;
  /** Durable account/principal when available; legacy peer ids are migrated here. */
  controllerId: string | null;
  updatedAt: number;
}

export interface TokenPresence {
  profileId: string;
  tokenId: string;
  sceneId: string;
  revision: number;
  updatedAt: number;
}

export interface RetiredTokenPresence {
  profileId: string;
  sourceId: string;
  sceneId: string;
  /** Original scene-array slot; distinguishes even corrupt duplicate token ids. */
  originalIndex: number;
  token: VttToken;
  reason: "legacy-duplicate";
  retiredAt: number;
}

export interface TokenRegistryState {
  version: typeof TOKEN_REGISTRY_VERSION;
  campaignId: string;
  /** Character id -> profile. */
  profiles: Record<string, TokenProfile>;
  /** Character id -> the only active presence. */
  presences: Record<string, TokenPresence>;
  /** Full snapshots make automatic legacy dedupe reversible/auditable. */
  retired: RetiredTokenPresence[];
}

export interface TokenRegistryStorage {
  load(campaignId: string): Promise<unknown | null>;
  save(campaignId: string, state: TokenRegistryState): Promise<void>;
}

/** SQLite campaign_kv adapter. A different backend can be injected in tests/web. */
export const campaignKvTokenRegistryStorage: TokenRegistryStorage = {
  load: (campaignId) => kvGet<unknown>(campaignId, "misc", TOKEN_REGISTRY_KEY),
  save: (campaignId, state) => kvSet(campaignId, "misc", TOKEN_REGISTRY_KEY, state),
};

export function emptyTokenRegistry(campaignId: string): TokenRegistryState {
  return { version: TOKEN_REGISTRY_VERSION, campaignId, profiles: {}, presences: {}, retired: [] };
}

export type TokenRegistryLoadResult =
  | { status: "missing"; state: TokenRegistryState }
  | { status: "loaded"; state: TokenRegistryState }
  | { status: "corrupt"; state: TokenRegistryState; raw: unknown };

/**
 * Read without papering over damaged state.  "corrupt" is deliberately distinct
 * from "missing" so a caller never autosaves an empty registry over recoverable
 * bytes merely because a newer/partial value could not be understood.
 */
export async function loadTokenRegistry(
  campaignId: string,
  storage: TokenRegistryStorage = campaignKvTokenRegistryStorage
): Promise<TokenRegistryLoadResult> {
  const raw = await storage.load(campaignId);
  if (raw === null || raw === undefined) return { status: "missing", state: emptyTokenRegistry(campaignId) };
  const state = parseTokenRegistry(raw, campaignId);
  return state
    ? { status: "loaded", state }
    : { status: "corrupt", state: emptyTokenRegistry(campaignId), raw };
}

export async function saveTokenRegistry(
  state: TokenRegistryState,
  storage: TokenRegistryStorage = campaignKvTokenRegistryStorage
): Promise<void> {
  const valid = parseTokenRegistry(state, state.campaignId);
  if (!valid) throw new Error("Refusing to save an invalid token registry");
  await storage.save(state.campaignId, valid);
}

function record(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function finite(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function cleanAppearance(v: unknown): TokenAppearance | null {
  if (!record(v) || typeof v.name !== "string" || typeof v.color !== "string" || !finite(v.size) || v.size <= 0) return null;
  const out: TokenAppearance = { name: v.name, color: v.color, size: v.size };
  if (typeof v.img === "string" || v.img === null) out.img = v.img;
  if (finite(v.vision) && v.vision >= 0) out.vision = v.vision;
  return out;
}

/** Validate the persisted shape and discard unknown fields, never mutate raw. */
export function parseTokenRegistry(raw: unknown, campaignId: string): TokenRegistryState | null {
  if (!record(raw) || raw.version !== TOKEN_REGISTRY_VERSION || raw.campaignId !== campaignId) return null;
  if (!record(raw.profiles) || !record(raw.presences) || !Array.isArray(raw.retired)) return null;

  const profiles: Record<string, TokenProfile> = {};
  for (const [sourceId, value] of Object.entries(raw.profiles)) {
    if (!record(value) || sourceId.length === 0 || value.sourceId !== sourceId || value.sourceKind !== "character") return null;
    if (typeof value.id !== "string" || value.campaignId !== campaignId || !finite(value.updatedAt)) return null;
    const appearance = cleanAppearance(value.appearance);
    if (!appearance || !(typeof value.controllerId === "string" || value.controllerId === null)) return null;
    profiles[sourceId] = {
      id: value.id,
      campaignId,
      sourceKind: "character",
      sourceId,
      appearance,
      controllerId: value.controllerId,
      updatedAt: value.updatedAt,
    };
  }

  const presences: Record<string, TokenPresence> = {};
  for (const [sourceId, value] of Object.entries(raw.presences)) {
    const profile = profiles[sourceId];
    if (!profile || !record(value) || value.profileId !== profile.id) return null;
    if (typeof value.tokenId !== "string" || !value.tokenId || typeof value.sceneId !== "string" || !value.sceneId) return null;
    if (!finite(value.revision) || value.revision < 0 || !Number.isInteger(value.revision) || !finite(value.updatedAt)) return null;
    presences[sourceId] = {
      profileId: value.profileId,
      tokenId: value.tokenId,
      sceneId: value.sceneId,
      revision: value.revision,
      updatedAt: value.updatedAt,
    };
  }

  const retired: RetiredTokenPresence[] = [];
  for (const value of raw.retired) {
    if (!record(value) || value.reason !== "legacy-duplicate") return null;
    if (typeof value.profileId !== "string" || typeof value.sourceId !== "string" || typeof value.sceneId !== "string") return null;
    const profile = profiles[value.sourceId];
    if (!profile || profile.id !== value.profileId) return null;
    if (!finite(value.originalIndex) || value.originalIndex < 0 || !Number.isInteger(value.originalIndex)) return null;
    if (!finite(value.retiredAt) || !isToken(value.token) || linkedCharacterId(value.token) !== value.sourceId) return null;
    retired.push({
      profileId: value.profileId,
      sourceId: value.sourceId,
      sceneId: value.sceneId,
      originalIndex: value.originalIndex,
      token: cloneToken(value.token),
      reason: "legacy-duplicate",
      retiredAt: value.retiredAt,
    });
  }
  return { version: TOKEN_REGISTRY_VERSION, campaignId, profiles, presences, retired };
}

function isToken(v: unknown): v is VttToken {
  return (
    record(v) &&
    typeof v.id === "string" &&
    typeof v.name === "string" &&
    finite(v.x) &&
    finite(v.y) &&
    finite(v.size) &&
    v.size > 0 &&
    typeof v.color === "string" &&
    typeof v.visible === "boolean"
  );
}

function cloneMeta(meta: VttTokenMeta | undefined): VttTokenMeta | undefined {
  if (!meta) return undefined;
  return {
    ...meta,
    flags: meta.flags ? [...meta.flags] : undefined,
    stats: meta.stats ? { ...meta.stats } : undefined,
  };
}

export function cloneToken(token: VttToken): VttToken {
  return {
    ...token,
    statuses: token.statuses ? [...token.statuses] : undefined,
    meta: cloneMeta(token.meta),
  };
}

export function tokenProfileId(characterId: string): string {
  return `character:${encodeURIComponent(characterId)}`;
}

function linkedCharacterId(token: VttToken): string | null {
  if (token.prop || typeof token.characterId !== "string") return null;
  const id = token.characterId.trim();
  return id || null;
}

function appearanceFromToken(token: VttToken): TokenAppearance {
  return {
    name: token.name,
    color: token.color,
    size: token.size,
    ...(token.img !== undefined ? { img: token.img } : {}),
    ...(finite(token.vision) ? { vision: token.vision } : {}),
  };
}

/** Profile values are customisation, so they win; missing art/vision is recovered from legacy copies. */
function mergeAppearance(winner: VttToken, donors: VttToken[], previous?: TokenProfile): TokenAppearance {
  const appearance = appearanceFromToken(winner);
  if ((appearance.img === undefined || appearance.img === null || appearance.img === "") && !previous?.appearance.img) {
    const donor = donors.find((t) => typeof t.img === "string" && t.img.length > 0);
    if (donor) appearance.img = donor.img;
  }
  if (appearance.vision === undefined && previous?.appearance.vision === undefined) {
    const donor = donors.find((t) => finite(t.vision));
    if (donor) appearance.vision = donor.vision;
  }
  return previous ? { ...appearance, ...previous.appearance } : appearance;
}

function applyAppearance(token: VttToken, appearance: TokenAppearance): VttToken {
  return {
    ...cloneToken(token),
    name: appearance.name,
    color: appearance.color,
    size: appearance.size,
    ...(appearance.img !== undefined ? { img: appearance.img } : {}),
    ...(appearance.vision !== undefined ? { vision: appearance.vision } : {}),
  };
}

interface Candidate {
  scene: VttScene;
  sceneIndex: number;
  token: VttToken;
  tokenIndex: number;
}

function candidateOrder(previous: TokenPresence | undefined): (a: Candidate, b: Candidate) => number {
  return (a, b) => {
    const aPrevious = previous && a.scene.id === previous.sceneId && a.token.id === previous.tokenId ? 1 : 0;
    const bPrevious = previous && b.scene.id === previous.sceneId && b.token.id === previous.tokenId ? 1 : 0;
    if (aPrevious !== bPrevious) return bPrevious - aPrevious;
    if (a.scene.active !== b.scene.active) return a.scene.active ? -1 : 1;
    if (a.scene.updatedAt !== b.scene.updatedAt) return b.scene.updatedAt - a.scene.updatedAt;
    const byScene = a.scene.id.localeCompare(b.scene.id);
    if (byScene) return byScene;
    const byToken = a.token.id.localeCompare(b.token.id);
    return byToken || a.tokenIndex - b.tokenIndex || a.sceneIndex - b.sceneIndex;
  };
}

function cloneScenesForTokenChanges(scenes: readonly VttScene[]): VttScene[] {
  return scenes.map((scene) => ({
    ...scene,
    data: { ...scene.data, tokens: scene.data.tokens.map(cloneToken) },
  }));
}

function retiredKey(sourceId: string, sceneId: string, originalIndex: number, token: VttToken): string {
  // Exact payload in the key makes rerunning the same migration idempotent while
  // still archiving a later, different token that reuses a corrupt legacy id/slot.
  return `${sourceId}\u0000${sceneId}\u0000${originalIndex}\u0000${JSON.stringify(token)}`;
}

export interface LegacyTokenMigrationReport {
  createdProfiles: string[];
  updatedProfiles: string[];
  clearedStalePresences: string[];
  deduplicated: { characterId: string; keptTokenId: string; retiredTokenIds: string[] }[];
  /** Suspicious character links on props are left byte-for-byte intact. */
  skipped: { sceneId: string; tokenId: string; reason: "linked-prop" }[];
}

export interface LegacyTokenMigrationResult {
  state: TokenRegistryState;
  scenes: VttScene[];
  report: LegacyTokenMigrationReport;
}

/**
 * Convert legacy scene-local character copies into a reversible canonical set.
 * Only non-prop tokens with a non-empty characterId participate. Unlinked actors,
 * props, and suspicious linked props are never removed or rewritten.
 */
export function migrateLegacyCharacterTokens(
  campaignId: string,
  scenes: readonly VttScene[],
  previous: TokenRegistryState = emptyTokenRegistry(campaignId),
  now = Date.now()
): LegacyTokenMigrationResult {
  if (previous.campaignId !== campaignId) throw new Error("Token registry belongs to a different campaign");
  const outScenes = cloneScenesForTokenChanges(scenes);
  const report: LegacyTokenMigrationReport = {
    createdProfiles: [],
    updatedProfiles: [],
    clearedStalePresences: [],
    deduplicated: [],
    skipped: [],
  };
  const grouped = new Map<string, Candidate[]>();

  for (let sceneIndex = 0; sceneIndex < outScenes.length; sceneIndex++) {
    const scene = outScenes[sceneIndex];
    for (let tokenIndex = 0; tokenIndex < scene.data.tokens.length; tokenIndex++) {
      const token = scene.data.tokens[tokenIndex];
      if (token.prop && typeof token.characterId === "string" && token.characterId.trim()) {
        report.skipped.push({ sceneId: scene.id, tokenId: token.id, reason: "linked-prop" });
        continue;
      }
      const characterId = linkedCharacterId(token);
      if (!characterId) continue;
      const list = grouped.get(characterId) ?? [];
      list.push({ scene, sceneIndex, token, tokenIndex });
      grouped.set(characterId, list);
    }
  }

  const state: TokenRegistryState = {
    version: TOKEN_REGISTRY_VERSION,
    campaignId,
    profiles: { ...previous.profiles },
    // Rebuilt from the complete campaign scene set below. Profiles survive an
    // absent token (so its art/controller are not lost); stale presence pointers do not.
    presences: {},
    retired: previous.retired.map((r) => ({ ...r, token: cloneToken(r.token) })),
  };
  report.clearedStalePresences = Object.keys(previous.presences).filter((id) => !grouped.has(id)).sort();
  const retiredKeys = new Set(
    state.retired.map((r) => retiredKey(r.sourceId, r.sceneId, r.originalIndex, r.token))
  );
  const removals = new Map<string, Set<number>>();

  for (const characterId of [...grouped.keys()].sort()) {
    const candidates = grouped.get(characterId)!;
    const priorProfile = state.profiles[characterId];
    const priorPresence = previous.presences[characterId];
    candidates.sort(candidateOrder(priorPresence));
    const winner = candidates[0];
    const duplicates = candidates.slice(1);
    const profileId = priorProfile?.id ?? tokenProfileId(characterId);
    const appearance = mergeAppearance(winner.token, candidates.map((candidate) => candidate.token), priorProfile);
    const profile: TokenProfile = {
      id: profileId,
      campaignId,
      sourceKind: "character",
      sourceId: characterId,
      appearance,
      controllerId: priorProfile?.controllerId ?? winner.token.owner ?? winner.token.ownerPeer ?? null,
      updatedAt: now,
    };
    state.profiles[characterId] = profile;
    state.presences[characterId] = {
      profileId,
      tokenId: winner.token.id,
      sceneId: winner.scene.id,
      revision: priorPresence?.revision ?? 0,
      updatedAt: now,
    };
    (priorProfile ? report.updatedProfiles : report.createdProfiles).push(characterId);

    // Recover profile art/customisation onto the canonical instance, while its
    // id, runtime (HP/status/meta), position and ownership remain the winner's.
    const normalizedWinner = applyAppearance(winner.token, appearance);
    const legacyOwner = normalizedWinner.owner ?? normalizedWinner.ownerPeer;
    delete normalizedWinner.ownerPeer;
    if (legacyOwner) normalizedWinner.owner = legacyOwner;
    winner.scene.data.tokens[winner.tokenIndex] = { ...normalizedWinner, characterId };

    if (duplicates.length > 0) {
      for (const duplicate of duplicates) {
        const set = removals.get(duplicate.scene.id) ?? new Set<number>();
        set.add(duplicate.tokenIndex);
        removals.set(duplicate.scene.id, set);
        const key = retiredKey(characterId, duplicate.scene.id, duplicate.tokenIndex, duplicate.token);
        if (!retiredKeys.has(key)) {
          state.retired.push({
            profileId,
            sourceId: characterId,
            sceneId: duplicate.scene.id,
            originalIndex: duplicate.tokenIndex,
            token: cloneToken(duplicate.token),
            reason: "legacy-duplicate",
            retiredAt: now,
          });
          retiredKeys.add(key);
        }
      }
      report.deduplicated.push({
        characterId,
        keptTokenId: winner.token.id,
        retiredTokenIds: duplicates.map((d) => d.token.id),
      });
    }
  }
  // Deferred until every winner has been updated: removing an earlier token
  // would otherwise invalidate the captured indexes for later characters.
  for (const [sceneId, indexes] of removals) {
    const scene = outScenes.find((s) => s.id === sceneId)!;
    scene.data.tokens = scene.data.tokens.filter((_, i) => !indexes.has(i));
  }
  return { state, scenes: outScenes, report };
}

export interface TokenPlacementOptions {
  /** Defaults to every other token blocking. */
  blocks?: (token: VttToken) => boolean;
  ignoreTokenIds?: ReadonlySet<string>;
}

/** Deterministic nearest-cell search used by migration/scene transfer. */
export function findNearestAvailableTokenPosition(
  scene: Pick<VttScene, "data">,
  moving: Pick<VttToken, "id" | "size">,
  preferred: { x: number; y: number },
  options: TokenPlacementOptions = {}
): { x: number; y: number } | null {
  const { grid } = scene.data;
  const ignore = options.ignoreTokenIds ?? new Set([moving.id]);
  const tokens = scene.data.tokens.filter((token) => !ignore.has(token.id));
  const found = nearestFreeCell(
    grid,
    tokens,
    { id: moving.id, size: moving.size, x: preferred.x, y: preferred.y },
    { ignoreTokenId: moving.id, ...(options.blocks ? { blocks: options.blocks } : {}) }
  );
  return found ? { x: found.x, y: found.y } : null;
}

export interface CanonicalTransferSuccess {
  ok: true;
  action: "focused" | "transferred" | "created";
  token: VttToken;
  state: TokenRegistryState;
  scenes: VttScene[];
}

export interface CanonicalTransferFailure {
  ok: false;
  reason:
    | "missing-destination"
    | "missing-token"
    | "ambiguous-presence"
    | "duplicate-token-id"
    | "no-open-space"
    | "invalid-character";
  state: TokenRegistryState;
  scenes: readonly VttScene[];
}

export type CanonicalTransferResult = CanonicalTransferSuccess | CanonicalTransferFailure;

function characterCandidates(scenes: readonly VttScene[], characterId: string): Candidate[] {
  const found: Candidate[] = [];
  scenes.forEach((scene, sceneIndex) =>
    scene.data.tokens.forEach((token, tokenIndex) => {
      if (linkedCharacterId(token) === characterId) found.push({ scene, sceneIndex, token, tokenIndex });
    })
  );
  return found;
}

function failure(
  reason: CanonicalTransferFailure["reason"],
  state: TokenRegistryState,
  scenes: readonly VttScene[]
): CanonicalTransferFailure {
  return { ok: false, reason, state, scenes };
}

function profileForToken(state: TokenRegistryState, characterId: string, token: VttToken, now: number): TokenProfile {
  const previous = state.profiles[characterId];
  return {
    id: previous?.id ?? tokenProfileId(characterId),
    campaignId: state.campaignId,
    sourceKind: "character",
    sourceId: characterId,
    appearance: previous ? { ...appearanceFromToken(token), ...previous.appearance } : appearanceFromToken(token),
    controllerId: previous?.controllerId ?? token.owner ?? token.ownerPeer ?? null,
    updatedAt: now,
  };
}

function stateWithPresence(
  state: TokenRegistryState,
  characterId: string,
  profile: TokenProfile,
  tokenId: string,
  sceneId: string,
  revision: number,
  now: number
): TokenRegistryState {
  return {
    ...state,
    profiles: { ...state.profiles, [characterId]: profile },
    presences: {
      ...state.presences,
      [characterId]: { profileId: profile.id, tokenId, sceneId, revision, updatedAt: now },
    },
    retired: state.retired.map((r) => ({ ...r, token: cloneToken(r.token) })),
  };
}

/**
 * Move the canonical instance between scenes. Ambiguous legacy duplicates are a
 * hard stop: callers must run/report migration first, never lose one silently.
 */
export function transferCanonicalCharacterToken(
  state: TokenRegistryState,
  scenes: readonly VttScene[],
  characterId: string,
  destinationSceneId: string,
  preferred: { x: number; y: number },
  now = Date.now()
): CanonicalTransferResult {
  if (!characterId.trim()) return failure("invalid-character", state, scenes);
  const destination = scenes.find((s) => s.id === destinationSceneId);
  if (!destination) return failure("missing-destination", state, scenes);
  const found = characterCandidates(scenes, characterId);
  if (found.length === 0) return failure("missing-token", state, scenes);
  if (found.length > 1) return failure("ambiguous-presence", state, scenes);
  const existing = found[0];
  const idOccurrences = scenes.reduce(
    (count, scene) => count + scene.data.tokens.filter((token) => token.id === existing.token.id).length,
    0
  );
  if (idOccurrences > 1) return failure("duplicate-token-id", state, scenes);
  if (existing.scene.id === destinationSceneId) {
    const outScenes = cloneScenesForTokenChanges(scenes);
    const profile = profileForToken(state, characterId, existing.token, now);
    const token = {
      ...applyAppearance(outScenes[existing.sceneIndex].data.tokens[existing.tokenIndex], profile.appearance),
      characterId,
    };
    outScenes[existing.sceneIndex].data.tokens[existing.tokenIndex] = token;
    const previousPresence = state.presences[characterId];
    const unchanged = previousPresence?.tokenId === token.id && previousPresence.sceneId === destinationSceneId;
    const revision = unchanged ? previousPresence.revision : previousPresence ? previousPresence.revision + 1 : 0;
    return {
      ok: true,
      action: "focused",
      token: cloneToken(token),
      state: stateWithPresence(state, characterId, profile, token.id, destinationSceneId, revision, now),
      scenes: outScenes,
    };
  }

  const outScenes = cloneScenesForTokenChanges(scenes);
  const sourceOut = outScenes[existing.sceneIndex];
  const destinationOut = outScenes.find((s) => s.id === destinationSceneId)!;
  const profile = profileForToken(state, characterId, sourceOut.data.tokens[existing.tokenIndex], now);
  const token = { ...applyAppearance(sourceOut.data.tokens[existing.tokenIndex], profile.appearance), characterId };
  sourceOut.data.tokens.splice(existing.tokenIndex, 1);
  const point = findNearestAvailableTokenPosition(destinationOut, token, preferred);
  if (!point) return failure("no-open-space", state, scenes);
  token.x = point.x;
  token.y = point.y;
  destinationOut.data.tokens.push(token);

  const previousPresence = state.presences[characterId];
  const outState = stateWithPresence(
    state,
    characterId,
    profile,
    token.id,
    destinationSceneId,
    (previousPresence?.revision ?? 0) + 1,
    now
  );
  return { ok: true, action: "transferred", token: cloneToken(token), state: outState, scenes: outScenes };
}

/**
 * Spawn semantics for the UI: focus an existing same-scene token, transfer an
 * existing other-scene token, or create exactly one first presence.
 */
export function ensureCanonicalCharacterToken(
  state: TokenRegistryState,
  scenes: readonly VttScene[],
  destinationSceneId: string,
  tokenSpec: VttToken,
  preferred: { x: number; y: number },
  now = Date.now()
): CanonicalTransferResult {
  const characterId = linkedCharacterId(tokenSpec);
  if (!characterId) return failure("invalid-character", state, scenes);
  const found = characterCandidates(scenes, characterId);
  if (found.length > 1) return failure("ambiguous-presence", state, scenes);
  if (found.length === 1) {
    return transferCanonicalCharacterToken(state, scenes, characterId, destinationSceneId, preferred, now);
  }

  const destinationIndex = scenes.findIndex((s) => s.id === destinationSceneId);
  if (destinationIndex < 0) return failure("missing-destination", state, scenes);
  if (scenes.some((scene) => scene.data.tokens.some((token) => token.id === tokenSpec.id))) {
    return failure("duplicate-token-id", state, scenes);
  }
  const outScenes = cloneScenesForTokenChanges(scenes);
  const destination = outScenes[destinationIndex];
  const profile = profileForToken(state, characterId, tokenSpec, now);
  const token = { ...applyAppearance(tokenSpec, profile.appearance), characterId };
  const point = findNearestAvailableTokenPosition(destination, token, preferred);
  if (!point) return failure("no-open-space", state, scenes);
  token.x = point.x;
  token.y = point.y;
  destination.data.tokens.push(token);

  const outState = stateWithPresence(state, characterId, profile, token.id, destinationSceneId, 0, now);
  return { ok: true, action: "created", token: cloneToken(token), state: outState, scenes: outScenes };
}

/** Update campaign-global customisation and the currently present scene token. */
export function customizeCanonicalCharacterToken(
  state: TokenRegistryState,
  scenes: readonly VttScene[],
  characterId: string,
  patch: Partial<TokenAppearance>,
  now = Date.now()
): { state: TokenRegistryState; scenes: VttScene[] } | null {
  const profile = state.profiles[characterId];
  const presence = state.presences[characterId];
  if (!profile || !presence) return null;
  const definedPatch = Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined));
  const appearance = cleanAppearance({ ...profile.appearance, ...definedPatch });
  if (!appearance) return null;
  const outScenes = cloneScenesForTokenChanges(scenes);
  const scene = outScenes.find((s) => s.id === presence.sceneId);
  const index = scene?.data.tokens.findIndex((t) => t.id === presence.tokenId) ?? -1;
  if (!scene || index < 0 || linkedCharacterId(scene.data.tokens[index]) !== characterId) return null;
  scene.data.tokens[index] = applyAppearance(scene.data.tokens[index], appearance);
  return {
    scenes: outScenes,
    state: {
      ...state,
      profiles: { ...state.profiles, [characterId]: { ...profile, appearance, updatedAt: now } },
      presences: { ...state.presences },
      retired: state.retired.map((r) => ({ ...r, token: cloneToken(r.token) })),
    },
  };
}

/** Narrow helper for import-copy: token ids stay stable, campaign/source/scene ids follow their copied records. */
export function remapTokenRegistryForCampaignCopy(
  raw: unknown,
  fromCampaignId: string,
  toCampaignId: string,
  remapId: (id: string) => string
): unknown {
  const state = parseTokenRegistry(raw, fromCampaignId);
  if (!state) return raw;
  const out = emptyTokenRegistry(toCampaignId);
  for (const [sourceId, profile] of Object.entries(state.profiles)) {
    const nextSourceId = remapId(sourceId);
    const nextProfileId = tokenProfileId(nextSourceId);
    const appearance = { ...profile.appearance };
    if (typeof appearance.img === "string" && appearance.img.startsWith("wte-blob:")) {
      appearance.img = `wte-blob:${remapId(appearance.img.slice("wte-blob:".length))}`;
    }
    out.profiles[nextSourceId] = {
      ...profile,
      id: nextProfileId,
      campaignId: toCampaignId,
      sourceId: nextSourceId,
      appearance,
    };
    const presence = state.presences[sourceId];
    if (presence) {
      out.presences[nextSourceId] = {
        ...presence,
        profileId: nextProfileId,
        sceneId: remapId(presence.sceneId),
      };
    }
  }
  out.retired = state.retired.map((retired) => {
    const nextSourceId = remapId(retired.sourceId);
    const token = cloneToken(retired.token);
    if (typeof token.characterId === "string") token.characterId = remapId(token.characterId);
    if (typeof token.img === "string" && token.img.startsWith("wte-blob:")) {
      token.img = `wte-blob:${remapId(token.img.slice("wte-blob:".length))}`;
    }
    return {
      ...retired,
      profileId: tokenProfileId(nextSourceId),
      sourceId: nextSourceId,
      sceneId: remapId(retired.sceneId),
      token,
    };
  });
  return out;
}
