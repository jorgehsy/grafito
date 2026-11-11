// Browser checks: the app driven like a person would, with no Claude calls (see e2e/app.ts).
// Run with `pnpm e2e` from the repo root. Locally they use the dev servers if they are already up.
import { defineConfig, devices } from "@playwright/test";

const ci = !!process.env.CI;

export default defineConfig({
  testDir: "e2e",
  fullyParallel: true,
  forbidOnly: ci,
  retries: ci ? 1 : 0,
  reporter: ci ? "github" : "list",
  use: { baseURL: "http://localhost:5173", viewport: { width: 1440, height: 900 }, trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } }],
  webServer: [
    { name: "server", command: "pnpm --filter @grafito/server dev", url: "http://localhost:8787/api/health", reuseExistingServer: !ci, timeout: 60_000 },
    { name: "web", command: "pnpm exec vite", url: "http://localhost:5173", reuseExistingServer: !ci, timeout: 60_000 },
  ],
});
