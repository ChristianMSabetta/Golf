import { defineConfig } from "@playwright/test";

/**
 * End-to-end suite (M4-T009). Runs against a production build of the app,
 * pointed at the throwaway in-process mock Supabase started by the
 * webServer bootstrap (tests/e2e/bootstrap.mjs).
 *
 * ```bash
 * npx playwright test           # the whole suite
 * npx playwright test --headed # watch it run
 * ```
 *
 * `npm run test:e2e` builds first (tests/e2e/build.mjs — NEXT_PUBLIC_* is
 * inlined at build time, so the browser bundle points at the mock's fixed
 * port) and then this config's webServer (tests/e2e/bootstrap.mjs) boots
 * `next start` and the mock, killing both on teardown.
 *
 * No Supabase, Claude, Resend, or Cal.com credentials are needed; no network
 * leaves the machine.
 */

export default defineConfig({
  testDir: "tests/e2e",
  // The mock Supabase is one in-process server with shared in-memory state:
  // parallel workers would see each other's clubs, events, and auth users.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  timeout: 120_000,
  use: {
    baseURL: process.env.TEEBOARD_E2E_BASE_URL ?? "http://127.0.0.1:3000",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "node tests/e2e/bootstrap.mjs",
    url: "http://127.0.0.1:3000/api/health/live",
    reuseExistingServer: !process.env.CI,
    timeout: 240_000,
  },
});
