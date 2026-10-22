/**
 * The Playwright `webServer` bootstrap (M4-T009): boots the mock Supabase
 * (tests/e2e/mock-supabase.mjs) on the fixed port the production bundle was
 * built against (tests/e2e/build.mjs), then `next start` next to it. Both
 * live in this process's tree, so Playwright's webServer teardown stops
 * everything — the suite leaves nothing behind.
 *
 * TEST INFRASTRUCTURE ONLY — never imported by the app.
 */

import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = `${here}/../..`;

const { createMockSupabase, MOCK_PORT } = await import("./mock-supabase.mjs");

// The fixed port the bundle was built against (NEXT_PUBLIC_* inlining).
const mock = createMockSupabase(MOCK_PORT);
const address = await mock.listening;
const mockUrl = `http://127.0.0.1:${address.port}`;

const env = {
  ...process.env,
  NEXT_PUBLIC_PRODUCT_NAME: "TeeBoard",
  NEXT_PUBLIC_PRODUCT_DOMAIN: "teeboard.test",
  SENDER_EMAIL: "no-reply@teeboard.test",
  NEXT_PUBLIC_SUPABASE_URL: mockUrl,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "e2e-anon-key",
  SUPABASE_SERVICE_ROLE_KEY: "e2e-service-role-key",
  // Route the adapter's single Haiku call into the mock's /v1/messages
  // double; tests steer the answers via POST /e2e/claude (see helpers.mjs).
  ANTHROPIC_API_KEY: "e2e-anthropic-key",
  ANTHROPIC_BASE_URL: mockUrl,
  NEXT_TELEMETRY_DISABLED: "1",
};

const children = [];
function shutdown() {
  for (const child of children) {
    if (!child.killed) child.kill("SIGTERM");
  }
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
process.on("exit", shutdown);

const appPort = Number(process.env.TEEBOARD_APP_PORT ?? "3000");
const next = spawn(
  "node",
  [
    "--max-old-space-size=768",
    "node_modules/next/dist/bin/next",
    "start",
    "-p",
    String(appPort),
  ],
  {
    cwd: root,
    stdio: "inherit",
    env: { ...env, PORT: String(appPort) },
  },
);
next.on("error", (error) => {
  console.error("[e2e] next start failed:", error);
  shutdown();
  process.exit(1);
});
children.push(next);
children.push(mock.server);

async function waitFor(url, budgetMs) {
  const deadline = Date.now() + budgetMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return true;
    } catch {
      // not up yet
    }
    await delay(500);
  }
  return false;
}

const ready = await waitFor(
  `http://127.0.0.1:${appPort}/api/health/live`,
  120_000,
);
if (!ready) {
  console.error("Next server did not become ready in time");
  shutdown();
  process.exit(1);
}

// Keep this process alive alongside the app; Playwright kills the tree.
await new Promise(() => {});
