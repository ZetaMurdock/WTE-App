// Campaign persistence. For the First Milestone this is backed by localStorage;
// Phase 4 migrates structured data (campaigns, characters, scenes, …) to SQLite.
// Only lightweight UI prefs should stay in localStorage long-term.
import type { Campaign } from "../models/campaign";
import { readJson, writeJson } from "./localJson";

const CAMPAIGNS_KEY = "wte-campaigns";
const ACTIVE_KEY = "wte-active-campaign";

// Guarded. Both halves used to swallow their failure: a corrupt campaign list read
// as "you have no campaigns", and the next create/rename/archive wrote over the
// original bytes — while a full quota reported success having saved nothing.
function read<T>(key: string, fallback: T): T {
  return readJson<T>(key, fallback, { label: "campaign list" }).value;
}

function write(key: string, value: unknown): void {
  writeJson(key, value, { label: "campaign list" });
}

function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return "c-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
}

/** Active (non-archived) campaigns, most-recently-updated first. */
export function listCampaigns(includeArchived = false): Campaign[] {
  const all = read<Campaign[]>(CAMPAIGNS_KEY, []);
  const list = includeArchived ? all : all.filter((c) => !c.archived);
  return list.sort((a, b) => b.updatedAt - a.updatedAt);
}

export function getCampaign(id: string): Campaign | undefined {
  return read<Campaign[]>(CAMPAIGNS_KEY, []).find((c) => c.id === id);
}

export function createCampaign(name: string, system?: string): Campaign {
  const now = Date.now();
  const campaign: Campaign = {
    id: newId(),
    name: name.trim() || "Untitled Campaign",
    system,
    createdAt: now,
    updatedAt: now,
    archived: false,
  };
  const all = read<Campaign[]>(CAMPAIGNS_KEY, []);
  all.push(campaign);
  write(CAMPAIGNS_KEY, all);
  setActiveCampaignId(campaign.id);
  return campaign;
}

export function renameCampaign(id: string, name: string): void {
  const all = read<Campaign[]>(CAMPAIGNS_KEY, []);
  const c = all.find((x) => x.id === id);
  if (!c) return;
  c.name = name.trim() || c.name;
  c.updatedAt = Date.now();
  write(CAMPAIGNS_KEY, all);
}

export function archiveCampaign(id: string, archived = true): void {
  const all = read<Campaign[]>(CAMPAIGNS_KEY, []);
  const c = all.find((x) => x.id === id);
  if (!c) return;
  c.archived = archived;
  c.updatedAt = Date.now();
  write(CAMPAIGNS_KEY, all);
  if (archived && getActiveCampaignId() === id) setActiveCampaignId(null);
}

export function getActiveCampaignId(): string | null {
  return read<string | null>(ACTIVE_KEY, null);
}

export function setActiveCampaignId(id: string | null): void {
  write(ACTIVE_KEY, id);
}
