/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Desktop OAuth client secret, injected at BUILD time by CI from a GitHub
   *  Actions secret. For a Google "Desktop app" client this value is not a
   *  true secret (Google embeds it in installed apps by design), but the repo
   *  is public, so it is injected rather than committed. Empty in dev builds. */
  readonly VITE_GOOGLE_CLIENT_SECRET?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
