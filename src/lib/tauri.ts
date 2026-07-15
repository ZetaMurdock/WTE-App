// Thin, typed wrappers over the withGlobalTauri globals (window.__TAURI__).
// Outside the desktop app (plain browser) __TAURI__ is undefined and these no-op.
// The Google/Firebase sign-in flow is ported ~1:1 from the old index.html shell.

declare global {
  interface Window {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    __TAURI__?: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    firebase?: any;
    __wteFirebase?: Promise<void> | null;
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function T(): any | null {
  return typeof window !== "undefined" ? window.__TAURI__ ?? null : null;
}

export function isTauri(): boolean {
  return T() != null;
}

export async function getVersion(): Promise<string | null> {
  const t = T();
  if (!t?.app?.getVersion) return null;
  try {
    return await t.app.getVersion();
  } catch {
    return null;
  }
}

export interface WteUpdate {
  version?: string;
  downloadAndInstall(): Promise<void>;
}

export async function checkUpdate(): Promise<WteUpdate | null> {
  const t = T();
  if (!t?.updater?.check) return null;
  try {
    const update = await t.updater.check();
    return update && update.available ? (update as WteUpdate) : null;
  } catch {
    return null; // offline or updater endpoint unreachable
  }
}

export async function installUpdate(update: WteUpdate): Promise<void> {
  const t = T();
  if (!t) return;
  await update.downloadAndInstall();
  if (t.process?.relaunch) await t.process.relaunch();
}

// ── Google account (beta) ────────────────────────────────────────────────
const DEFAULT_OAUTH_CLIENT_ID =
  "147593598636-a8gn087e5oj75ikglcpvkl65u687gkal.apps.googleusercontent.com";

// The built-in shared-library project, so publishing works out of the box for
// everyone with no setup. A Firebase web config/apiKey is a PUBLIC client
// identifier (not a secret); writes are still gated by the RTDB rules
// (`/published_pages` write requires auth, which the app does anonymously).
// A user can override this with their own project via the Lobby settings.
const DEFAULT_FB_CONFIG = {
  apiKey: "AIzaSyCCYi1dAM8cVw2UrCDJdrazJ7FnKFrohAg",
  authDomain: "codex-753ac.firebaseapp.com",
  databaseURL: "https://codex-753ac-default-rtdb.firebaseio.com",
  projectId: "codex-753ac",
  storageBucket: "codex-753ac.firebasestorage.app",
  messagingSenderId: "1014842817225",
  appId: "1:1014842817225:web:0986dde5740bb5fd4d6b18",
  measurementId: "G-PLG5GXCERZ",
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getFbConfig(): any | null {
  try {
    const override = JSON.parse(localStorage.getItem("wte-fb-config") || "null");
    if (override && override.databaseURL) return override;
  } catch {
    /* fall through to the built-in default */
  }
  return DEFAULT_FB_CONFIG;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getOAuth(): any {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let o: any;
  try {
    o = JSON.parse(localStorage.getItem("wte-oauth") || "null");
  } catch {
    /* ignore */
  }
  o = o || {};
  if (!o.clientId) o.clientId = DEFAULT_OAUTH_CLIENT_ID;
  return o;
}

function b64url(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function ensureFirebase(cfg: any): Promise<void> {
  if (window.__wteFirebase) return window.__wteFirebase;
  window.__wteFirebase = new Promise<void>((res, rej) => {
    function load(src: string, cb: () => void) {
      const s = document.createElement("script");
      s.src = src;
      s.onload = cb;
      s.onerror = () => rej(new Error("load fail"));
      document.head.appendChild(s);
    }
    load("https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js", () => {
      load("https://www.gstatic.com/firebasejs/10.12.0/firebase-auth-compat.js", () => {
        try {
          const fb = window.firebase;
          if (!fb.apps.length) fb.initializeApp(cfg);
          res();
        } catch (e) {
          rej(e as Error);
        }
      });
    });
  });
  return window.__wteFirebase;
}

export interface AuthUser {
  displayName?: string;
  email?: string;
}

/**
 * Toggle Google auth: signs out if already signed in, otherwise runs the desktop
 * loopback OAuth flow (via the `google_signin` Rust command) and signs into Firebase.
 * Returns the resulting user (or null when signed out). Throws Error with a
 * user-facing message on failure.
 */
export async function signInWithGoogle(): Promise<AuthUser | null> {
  const t = T();
  if (!t) throw new Error("Google sign-in works in the desktop app.");
  const cfg = getFbConfig();
  if (!cfg || !cfg.authDomain || !cfg.projectId) {
    throw new Error(
      "First set your full Firebase config (with authDomain + projectId) in the VTT/Sheet table settings, then try again."
    );
  }
  try {
    await ensureFirebase(cfg);
  } catch {
    throw new Error("Could not load Firebase Auth.");
  }
  const fb = window.firebase;
  if (fb.auth().currentUser) {
    await fb.auth().signOut();
    return null;
  }
  const oauth = getOAuth();
  if (!oauth.clientSecret) {
    const sec = prompt(
      'Paste the Google OAuth CLIENT SECRET (not the client ID).\nGoogle Cloud Console → APIs & Services → Credentials → your "W.T.E Desktop" client → Client secret (starts with GOCSPX-).\nStored only on this device.',
      ""
    );
    if (!sec) return (fb.auth().currentUser as AuthUser) ?? null;
    oauth.clientSecret = sec.trim();
    try {
      localStorage.setItem("wte-oauth", JSON.stringify(oauth));
    } catch {
      /* ignore */
    }
  }
  try {
    const verifier = b64url(crypto.getRandomValues(new Uint8Array(48)));
    const challenge = b64url(
      new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)))
    );
    const idToken: string = await t.core.invoke("google_signin", {
      clientId: oauth.clientId,
      clientSecret: oauth.clientSecret,
      codeChallenge: challenge,
      codeVerifier: verifier,
    });
    const cred = fb.auth.GoogleAuthProvider.credential(idToken);
    const res = await fb.auth().signInWithCredential(cred);
    return res.user as AuthUser;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (e: any) {
    let msg = e && e.message ? e.message : String(e);
    // a token-exchange/client error usually means a wrong secret → clear it so the next try re-prompts
    if (/token exchange|rejected the token|invalid_client|401/i.test(msg)) {
      try {
        const o = getOAuth();
        delete o.clientSecret;
        localStorage.setItem("wte-oauth", JSON.stringify(o));
      } catch {
        /* ignore */
      }
      msg +=
        "\n\nThe saved client secret was cleared — click Sign in again to re-enter it. Make sure it is the *Client secret* of the SAME Desktop OAuth client whose ID ends in ...687gkal.";
    }
    throw new Error(msg);
  }
}

/** Restore any persisted Firebase session on launch; calls back with the user (or null). */
export async function restoreAuth(cb: (user: AuthUser | null) => void): Promise<void> {
  if (!isTauri()) return;
  const cfg = getFbConfig();
  if (!cfg || !cfg.authDomain) return;
  try {
    await ensureFirebase(cfg);
    window.firebase.auth().onAuthStateChanged((u: AuthUser | null) => cb(u));
  } catch {
    /* ignore */
  }
}

// ── Firebase Realtime Database access (for shared/published Codex content) ──

/** The user's Firebase config (localStorage). Publishing needs a databaseURL. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getFirebaseConfig(): any | null {
  return getFbConfig();
}

/** True when a Firebase config with a Realtime-Database URL is present. */
export function firebasePublishConfigured(): boolean {
  const cfg = getFbConfig();
  return !!(cfg && cfg.databaseURL && cfg.projectId);
}

/** Raw stored Firebase config text (for the settings editor). */
export function getFirebaseConfigRaw(): string {
  return localStorage.getItem("wte-fb-config") || "";
}
/** Save the Firebase config from pasted JSON (or a `const firebaseConfig = {…}`
 *  snippet). Returns an error string on invalid JSON, or null on success. */
export function saveFirebaseConfig(text: string): string | null {
  const t = text.trim();
  if (!t) {
    localStorage.removeItem("wte-fb-config");
    return null;
  }
  // tolerate a pasted `const firebaseConfig = { … };` block
  const m = t.match(/\{[\s\S]*\}/);
  const jsonish = m ? m[0] : t;
  try {
    // allow unquoted keys / trailing commas from console snippets
    // eslint-disable-next-line no-new-func
    const obj = Function(`"use strict";return (${jsonish})`)();
    if (!obj || typeof obj !== "object") return "That doesn't look like a config object.";
    if (!obj.databaseURL) return "Missing databaseURL — enable the Realtime Database and copy its config.";
    localStorage.setItem("wte-fb-config", JSON.stringify(obj));
    return null;
  } catch {
    return "Couldn't parse that — paste the whole firebaseConfig object.";
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let __wteFbDb: Promise<any> | null = null;
/** Load Firebase app+auth+database and return the database() handle. Throws with a
 *  user-facing message if the config lacks a databaseURL. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function firebaseDb(): Promise<any> {
  const cfg = getFbConfig();
  if (!cfg || !cfg.databaseURL) {
    return Promise.reject(new Error("Add your Firebase config with a databaseURL (Netplay settings) to use shared/published pages."));
  }
  if (__wteFbDb) return __wteFbDb;
  __wteFbDb = (async () => {
    await ensureFirebase(cfg);
    if (!window.firebase.database) {
      await new Promise<void>((res, rej) => {
        const s = document.createElement("script");
        s.src = "https://www.gstatic.com/firebasejs/10.12.0/firebase-database-compat.js";
        s.onload = () => res();
        s.onerror = () => rej(new Error("Could not load Firebase Database."));
        document.head.appendChild(s);
      });
    }
    return window.firebase.database();
  })();
  return __wteFbDb;
}

/** Display name of the signed-in Firebase user, if any. */
export function firebaseUserName(): string | null {
  try {
    const u = window.firebase?.auth?.().currentUser;
    return u ? u.displayName || u.email || u.uid : null;
  } catch {
    return null;
  }
}
