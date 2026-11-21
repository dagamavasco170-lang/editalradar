import { defineConfig, configDefaults } from "vitest/config";
import react from "@vitejs/plugin-react";

const appCommit = process.env.GITHUB_SHA || process.env.VERCEL_GIT_COMMIT_SHA || "local";

export default defineConfig({
  define: {
    __EDITALRADAR_COMMIT__: JSON.stringify(appCommit)
  },
  plugins: [react()],
  // GitHub Pages publica em subpasta; Vercel e desenvolvimento usam a raiz.
  base: process.env.GITHUB_ACTIONS === "true" ? "/editalradar/" : "/",
  test: {
    environment: "jsdom",
    setupFiles: "./src/test-setup.js",
    exclude: [...configDefaults.exclude, "e2e/**"],
    clearMocks: true,
    restoreMocks: true
  }
});
