import { defineConfig } from "vite";
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
});
