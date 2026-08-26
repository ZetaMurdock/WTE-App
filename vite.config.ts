import { defineConfig } from "vite";
import { configDefaults } from "vitest/config";
import react from "@vitejs/plugin-react";

// Tauri drives this: `beforeDevCommand` runs `vite` on a fixed port, and
// `beforeBuildCommand` runs `vite build` into ../dist (frontendDist).
// Files in public/ (the legacy sheet/vtt/wiki tools) are copied verbatim to dist/.
export default defineConfig({
  plugins: [react()],
  root: ".",
  publicDir: "public",
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
  },
  build: {
    outDir: "dist",
    target: "esnext",
    emptyOutDir: true,
  },
  test: {
    // A git worktree checked out under the repo is a SECOND copy of every test
    // file, pinned at whatever commit it was cut from. Left in scope it doubles
    // the gate and — worse — a name filter matches the stale copy first, so
    // `vitest run src/foo.test.ts` can report green for a file that no longer
    // even parses in the tree being shipped.
    exclude: [...configDefaults.exclude, "**/.claude/worktrees/**", "**/worktrees/**"],
    // Threads rather than forks: the happy-dom suites (sanitizeHtml, codexCorpus)
    // pay a real startup cost, and under load the forks pool intermittently gave
    // "Timeout waiting for worker to respond" — which SKIPPED those files while
    // still printing "passed" for the rest. Silently not running the security
    // tests is the worst possible failure mode, so use the cheaper-to-start pool
    // and give the handshake room.
    pool: "threads",
    testTimeout: 30000,
    hookTimeout: 30000,
    teardownTimeout: 30000,
  },
});
