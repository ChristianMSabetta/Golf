/**
 * Builds the production bundle for the E2E suite (M4-T009) with the mock
 * Supabase's env vars in scope — NEXT_PUBLIC_* is inlined at build time, so
 * the browser bundle must be built pointing at the mock's FIXED port
 * (54321), which the webServer bootstrap re-uses.
 *
 * TEST INFRASTRUCTURE ONLY — never imported by the app.
 */

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const root = `${dirname(fileURLToPath(import.meta.url))}/../..`;

/** The fixed mock port shared by build.mjs and bootstrap.mjs. */
export const MOCK_PORT = 54321;

const env = {
  ...process.env,
  NEXT_PUBLIC_PRODUCT_NAME: "TeeBoard",
  NEXT_PUBLIC_PRODUCT_DOMAIN: "teeboard.test",
  SENDER_EMAIL: "no-reply@teeboard.test",
  NEXT_PUBLIC_SUPABASE_URL: `http://127.0.0.1:${MOCK_PORT}`,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "e2e-anon-key",
  SUPABASE_SERVICE_ROLE_KEY: "e2e-service-role-key",
  ANTHROPIC_API_KEY: "e2e-anthropic-key",
  ANTHROPIC_BASE_URL: `http://127.0.0.1:${MOCK_PORT}`,
  NEXT_TELEMETRY_DISABLED: "1",
};

const built = spawnSync(
  "node",
  ["--max-old-space-size=1536", "node_modules/next/dist/bin/next", "build"],
  { cwd: root, env, stdio: "inherit" },
);

if (built.status !== 0) {
  console.error("Next production build failed for the E2E suite");
  process.exit(1);
}
