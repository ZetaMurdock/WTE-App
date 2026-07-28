// Whole-campaign export and import.
//
// Before this, `downloadCharacter` was the ONLY export in the codebase. Moving a
// campaign to another machine meant copying wte.db by hand — which arrived without
// anything that lived in localStorage — and there was no way to hand a campaign to
// another Curator, or to take a snapshot before a risky change.
//
// Two design constraints, both from earlier findings:
//
//  - KEYED ON STABLE IDS, not names. Notes attach to pages by stem and Sequences
//    hold ordered stems, so a package built on display names would bake in exactly
//    the fragility codexId.ts exists to remove.
//  - VERSIONED AND CHECKED. The shared-character format wrote a version field for
//    releases without ever reading it, and a file from a newer build imported as
//    though it were current, silently dropping what it did not recognise.
import type { Campaign } from "../models/campaign";
import type { CodexNote } from "../models/note";
import type { Sequence } from "../models/sequence";
import type { CharacterRecord } from "./characters";
import { listCharacters, upsertCharacter } from "./characters";
import { listNotes, saveNote } from "./notes";
import { listSequences, saveSequence } from "./sequences";
import { kvAll, kvSet, type KvScope } from "./campaignStore";
import { getDb, sqlAvailable } from "./db";
import { sheetFromJson } from "./sheetCodec";

/** Bump when the ENVELOPE changes shape. Records inside carry their own versions. */
export const PACKAGE_VERSION = 1;

export interface CampaignPackage {
  wte: "campaign";
  version: number;
  exportedAt: number;
  appVersion?: string;
  campaign: Campaign;
  characters: CharacterRecord[];
  notes: CodexNote[];
  sequences: Sequence[];
  scenes: unknown[];
  encounters: unknown[];
  assets: unknown[];
  /** Campaign-scoped settings: desk notes, calendar, folder trees. */
  kv: { scope: string; key: string; value: unknown }[];
  /** Codex pages this campaign relies on, by stem. */
  pages: { stem: string; content: string }[];
}

export class PackageVersionError extends Error {
  constructor(public readonly version: number) {
    super(
      `This campaign package was made by a newer version of W.T.E (format ${version}). Update W.T.E to import it — importing it here could drop parts of the campaign.`
    );
    this.name = "PackageVersionError";
  }
}

export class NotAPackageError extends Error {
  constructor() {
    super("That file is not a W.T.E campaign package.");
    this.name = "NotAPackageError";
  }
}

async function selectAll<T>(sql: string, args: unknown[]): Promise<T[]> {
  if (!sqlAvailable()) return [];
  const db = await getDb();
  return db.select<T[]>(sql, args);
}

/** Gather everything belonging to one campaign. */
export async function buildPackage(
  campaign: Campaign,
  opts?: { appVersion?: string; pages?: { stem: string; content: string }[] }
): Promise<CampaignPackage> {
  const [characters, notes, sequences, scenes, encounters, assets, kv] = await Promise.all([
    listCharacters(campaign.id),
    listNotes(campaign.id),
    listSequences(campaign.id),
    selectAll<unknown>("SELECT * FROM scenes WHERE campaign_id = $1", [campaign.id]),
    selectAll<unknown>("SELECT * FROM encounters WHERE campaign_id = $1", [campaign.id]),
    selectAll<unknown>("SELECT * FROM assets WHERE campaign_id = $1", [campaign.id]),
    kvAll(campaign.id),
  ]);

  return {
    wte: "campaign",
    version: PACKAGE_VERSION,
    exportedAt: Date.now(),
    appVersion: opts?.appVersion,
    campaign,
    // A character whose stored data could not be read is EXCLUDED rather than
    // exported as the blank placeholder the reader substituted — shipping a blank
    // under a real name would turn one machine's corruption into two.
    characters: characters.filter((c) => !c.corrupt),
    notes,
    sequences,
    scenes,
    encounters,
    assets,
    kv,
    pages: opts?.pages ?? [],
  };
}

export function serializePackage(pkg: CampaignPackage): string {
  return JSON.stringify(pkg, null, 2);
}

/** Parse and validate an incoming package. Throws rather than importing something
 *  it does not fully understand. */
export function parsePackage(raw: unknown): CampaignPackage {
  if (!raw || typeof raw !== "object") throw new NotAPackageError();
  const o = raw as Partial<CampaignPackage>;
  if (o.wte !== "campaign") throw new NotAPackageError();
  const v = typeof o.version === "number" ? o.version : 1;
  if (v > PACKAGE_VERSION) throw new PackageVersionError(v);
  if (!o.campaign || typeof o.campaign !== "object" || typeof o.campaign.id !== "string") {
    throw new NotAPackageError();
  }
  const arr = <T>(x: unknown): T[] => (Array.isArray(x) ? (x as T[]) : []);
  return {
    wte: "campaign",
    version: v,
    exportedAt: typeof o.exportedAt === "number" ? o.exportedAt : 0,
    appVersion: typeof o.appVersion === "string" ? o.appVersion : undefined,
    campaign: o.campaign,
    characters: arr<CharacterRecord>(o.characters),
    notes: arr<CodexNote>(o.notes),
    sequences: arr<Sequence>(o.sequences),
    scenes: arr<unknown>(o.scenes),
    encounters: arr<unknown>(o.encounters),
    assets: arr<unknown>(o.assets),
    kv: arr<{ scope: string; key: string; value: unknown }>(o.kv),
    pages: arr<{ stem: string; content: string }>(o.pages),
  };
}

export interface ImportPlan {
  /** The campaign id the package will be imported UNDER. */
  campaignId: string;
  /** True when a campaign with this id already exists locally. */
  collision: boolean;
  counts: { characters: number; notes: number; sequences: number; scenes: number; encounters: number; assets: number };
}

/** What an import would do, WITHOUT doing it — so the user can be shown the
 *  consequences and choose. An id collision is the case that matters: importing
 *  over an existing campaign would replace records the user still has. */
export async function planImport(pkg: CampaignPackage): Promise<ImportPlan> {
  const existing = await selectAll<{ id: string }>("SELECT id FROM campaigns WHERE id = $1", [pkg.campaign.id]);
  return {
    campaignId: pkg.campaign.id,
    collision: existing.length > 0,
    counts: {
      characters: pkg.characters.length,
      notes: pkg.notes.length,
      sequences: pkg.sequences.length,
      scenes: pkg.scenes.length,
      encounters: pkg.encounters.length,
      assets: pkg.assets.length,
    },
  };
}

export interface ImportResult {
  campaignId: string;
  imported: { characters: number; notes: number; sequences: number; scenes: number; encounters: number; assets: number };
  failed: { what: string; error: string }[];
}

/**
 * Import a package.
 *
 * `mode` decides what happens on an id collision, and there is deliberately no
 * default that silently overwrites:
 *   "copy"  — remap every id, so the import lands ALONGSIDE what is already there.
 *   "merge" — keep the ids, updating existing records in place.
 */
export async function importPackage(
  pkg: CampaignPackage,
  mode: "copy" | "merge",
  opts?: { newCampaignName?: string }
): Promise<ImportResult> {
  const failed: { what: string; error: string }[] = [];
  const imported = { characters: 0, notes: 0, sequences: 0, scenes: 0, encounters: 0, assets: 0 };
  if (!sqlAvailable()) return { campaignId: pkg.campaign.id, imported, failed };
  const db = await getDb();

  // In copy mode every id is rewritten through one map, so references between
  // records inside the package stay pointing at each other rather than at the
  // originals.
  const idMap = new Map<string, string>();
  const remap = (id: string): string => {
    if (mode === "merge") return id;
    let next = idMap.get(id);
    if (!next) {
      next = `${id}-copy-${Math.random().toString(36).slice(2, 8)}`;
      idMap.set(id, next);
    }
    return next;
  };

  const campaignId = remap(pkg.campaign.id);
  const now = Date.now();
  const name = opts?.newCampaignName ?? (mode === "copy" ? `${pkg.campaign.name} (imported)` : pkg.campaign.name);

  try {
    await db.execute(
      `INSERT INTO campaigns (id, name, system, created_at, updated_at, archived)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT(id) DO UPDATE SET name = excluded.name, updated_at = excluded.updated_at`,
      [campaignId, name, pkg.campaign.system ?? null, pkg.campaign.createdAt || now, now, pkg.campaign.archived ? 1 : 0]
    );
  } catch (e) {
    failed.push({ what: "campaign", error: e instanceof Error ? e.message : String(e) });
    return { campaignId, imported, failed };
  }

  for (const c of pkg.characters) {
    try {
      // Coerce the sheet rather than trusting it — a package is a file, and files
      // are untrusted input.
      await upsertCharacter({ ...c, id: remap(c.id), campaignId, sheet: sheetFromJson(c.sheet) });
      imported.characters++;
    } catch (e) {
      failed.push({ what: `character "${c.name}"`, error: e instanceof Error ? e.message : String(e) });
    }
  }

  for (const n of pkg.notes) {
    try {
      await saveNote({ ...n, id: remap(n.id), campaignId });
      imported.notes++;
    } catch (e) {
      failed.push({ what: `note "${n.title || n.id}"`, error: e instanceof Error ? e.message : String(e) });
    }
  }

  for (const s of pkg.sequences) {
    try {
      await saveSequence({ ...s, id: remap(s.id), campaignId });
      imported.sequences++;
    } catch (e) {
      failed.push({ what: `Sequence "${s.title || s.id}"`, error: e instanceof Error ? e.message : String(e) });
    }
  }

  const rowImports: [string, unknown[], keyof typeof imported, string][] = [
    ["scenes", pkg.scenes, "scenes", "INSERT OR REPLACE INTO scenes (id, campaign_id, name, active, data, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7)"],
    ["encounters", pkg.encounters, "encounters", "INSERT OR REPLACE INTO encounters (id, campaign_id, name, scene_id, data, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7)"],
    ["assets", pkg.assets, "assets", "INSERT OR REPLACE INTO assets (id, campaign_id, kind, name, uri, created_at) VALUES ($1,$2,$3,$4,$5,$6)"],
  ];
  for (const [label, rows, counter, sql] of rowImports) {
    for (const r of rows as Record<string, unknown>[]) {
      if (!r || typeof r !== "object" || typeof r.id !== "string") continue;
      try {
        const id = remap(r.id);
        if (label === "assets") {
          await db.execute(sql, [id, campaignId, r.kind ?? "blob", r.name ?? "", r.uri ?? "", r.created_at ?? now]);
        } else if (label === "scenes") {
          await db.execute(sql, [id, campaignId, r.name ?? "", r.active ? 1 : 0, r.data ?? null, r.created_at ?? now, now]);
        } else {
          const sceneId = typeof r.scene_id === "string" ? remap(r.scene_id) : null;
          await db.execute(sql, [id, campaignId, r.name ?? "", sceneId, r.data ?? null, r.created_at ?? now, now]);
        }
        imported[counter]++;
      } catch (e) {
        failed.push({ what: `${label} row`, error: e instanceof Error ? e.message : String(e) });
      }
    }
  }

  for (const entry of pkg.kv) {
    try {
      await kvSet(campaignId, entry.scope as KvScope, entry.key, entry.value);
    } catch (e) {
      failed.push({ what: `setting ${entry.scope}/${entry.key}`, error: e instanceof Error ? e.message : String(e) });
    }
  }

  return { campaignId, imported, failed };
}

/** A filename that is safe on every platform and says what it holds. */
export function packageFilename(campaign: Campaign): string {
  const safe = campaign.name.replace(/[^\w.-]+/g, "_").replace(/^_+|_+$/g, "") || "campaign";
  const d = new Date();
  const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return `${safe}-${stamp}.wtepack`;
}
