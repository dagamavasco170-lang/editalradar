import { defineConfig, configDefaults } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
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
