import { defineConfig } from "@playwright/test";

const productionBaseURL = process.env.PLAYWRIGHT_BASE_URL;
const localBasePath = process.env.GITHUB_ACTIONS === "true" ? "/editalradar/" : "/";
const localBaseURL = `http://127.0.0.1:4173${localBasePath}`;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: [["list"], ["html", { outputFolder: "playwright-report", open: "never" }]],
  use: {
    baseURL: productionBaseURL || localBaseURL,
    browserName: "chromium",
    headless: true,
    screenshot: "only-on-failure",
    trace: "retain-on-failure"
  },
  // Quando PLAYWRIGHT_BASE_URL estiver definido, testa o site remoto publicado.
  // Caso contrário, sobe o preview local do build.
  webServer: productionBaseURL ? undefined : {
    command: "npm run preview -- --host 127.0.0.1",
    url: localBaseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000
  }
});
