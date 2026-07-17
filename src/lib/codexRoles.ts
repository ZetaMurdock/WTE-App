// Shared-library roles: the OWNER grants publish rights to Google accounts by
// email. Grants live in Firebase RTDB at /role_grants/<emailKey> so every
// install sees the same list; the app enforces them before any publish write
// (and docs/PUBLISH-SETUP.md documents matching RTDB rules for server-side
// enforcement). emailKey = lowercased email with "." → "," (RTDB keys can't
// contain dots).
import { firebaseDb } from "./tauri";

export type LibraryRole = "owner" | "engineer";

export interface RoleGrant {
  email: string;
  role: LibraryRole;
  by?: string;
  at: number;
}

export function emailKey(email: string): string {
  return email.trim().toLowerCase().replace(/\./g, ",");
}

/** The signed-in Firebase user's email, if any. */
export function currentEmail(): string | null {
  try {
    const w = window as unknown as { firebase?: { auth?: () => { currentUser?: { email?: string } | null } } };
    return w.firebase?.auth?.().currentUser?.email ?? null;
  } catch {
    return null;
  }
}

export async function fetchGrants(): Promise<RoleGrant[]> {
  const db = await firebaseDb();
  const snap = await db.ref("role_grants").once("value");
  const val = (snap.val() || {}) as Record<string, RoleGrant>;
  return Object.values(val).filter((g) => g && g.email && (g.role === "owner" || g.role === "engineer"));
}

/** My role under the current grants. NO grants at all = an unclaimed library —
 *  everyone may publish (solo/small-table default) and anyone signed in may
 *  claim ownership to start gating. */
export async function myRole(): Promise<LibraryRole | "open" | "none"> {
  const email = currentEmail();
  const grants = await fetchGrants().catch(() => null);
  if (grants === null) return "open"; // grants unreadable — don't lock people out client-side
  if (grants.length === 0) return "open";
  if (!email) return "none";
  return grants.find((g) => emailKey(g.email) === emailKey(email))?.role ?? "none";
}

/** Throws with a user-facing message when the current user may not publish. */
export async function assertCanPublish(): Promise<void> {
  const role = await myRole();
  if (role === "none") {
    throw new Error("This shared library is role-gated. Ask the owner to grant your Google account publish rights (Codex → Roles).");
  }
}

export async function grantRole(email: string, role: LibraryRole, by?: string): Promise<void> {
  const db = await firebaseDb();
  const grant: RoleGrant = { email: email.trim(), role, by, at: Date.now() };
  await db.ref("role_grants/" + emailKey(email)).set(grant);
}

export async function revokeRole(email: string): Promise<void> {
  const db = await firebaseDb();
  await db.ref("role_grants/" + emailKey(email)).remove();
}

/** First-come ownership claim for an unclaimed library. */
export async function claimOwnership(): Promise<void> {
  const email = currentEmail();
  if (!email) throw new Error("Sign in with Google first (Profile → Sign in).");
  const grants = await fetchGrants();
  if (grants.length > 0) throw new Error("This library already has an owner.");
  await grantRole(email, "owner", email);
}
