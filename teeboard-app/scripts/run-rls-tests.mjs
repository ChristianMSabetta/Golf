#!/usr/bin/env node
/**
 * Runs the supabase/tests/*.test.sql pgTAP suites against a Postgres
 * instance.  On Supabase the same files run unchanged through
 * `supabase test db` (pgTAP is provisioned by the platform); this runner
 * exists so CI and local development can execute them against any Postgres
 * 15+ reachable through a connection string, with no external services.
 *
 * Configuration (all optional; sensible localhost defaults for local dev):
 *   POSTGRES_URL / SUPABASE_DB_URL  base connection string.  The runner
 *                                  creates a throwaway scratch database,
 *                                  applies scripts/rls-bootstrap.sql (no-op
 *                                  on Supabase) plus every migration in
 *                                  filename order, runs the suites, and
 *                                  drops the scratch database again.
 *
 * The connecting user must be allowed to CREATE DATABASE (a superuser such
 * as the postgres owner, or the supabase_admin role on hosted Supabase).
 */

import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const ROOT = join(import.meta.dirname, "..");
const MIGRATIONS_DIR = join(ROOT, "supabase", "migrations");
const TESTS_DIR = join(ROOT, "supabase", "tests");
const BOOTSTRAP = join(ROOT, "scripts", "rls-bootstrap.sql");

const CONNECTION =
  process.env.POSTGRES_URL ??
  process.env.SUPABASE_DB_URL ??
  "postgresql://postgres:postgres@localhost:5432/postgres";

const SCRATCH_DB = `teeboard_rls_test`;

function psql(connection, args, label, { check = true } = {}) {
  const result = spawnSync(
    "psql",
    ["--no-psqlrc", "--set", "ON_ERROR_STOP=1", "--quiet", "--dbname", connection, ...args],
    { encoding: "utf8" },
  );
  if (check && result.status !== 0) {
    console.error(`✗ ${label} failed (psql exit ${result.status})\n${result.stdout ?? ""}${result.stderr ?? ""}`);
    process.exit(1);
  }
  return result;
}

async function main() {
  let exitCode = 0;
  const migrations = (await readdir(MIGRATIONS_DIR))
    .filter((name) => name.endsWith(".sql"))
    .sort();
  const tests = (await readdir(TESTS_DIR))
    .filter((name) => name.endsWith(".test.sql"))
    .sort();

  if (tests.length === 0) {
    console.error("No pgTAP suites found under supabase/tests/");
    process.exit(1);
  }

  // fresh scratch database so the run never mutates an existing one
  psql(CONNECTION, ["-c", `drop database if exists "${SCRATCH_DB}"`], "drop scratch database", { check: false });
  psql(CONNECTION, ["-c", `create database "${SCRATCH_DB}"`], "create scratch database");
  const scratch = rewriteDbName(CONNECTION, SCRATCH_DB);

  try {
    // bootstrap first: it provisions pgtap, the supabase roles, the auth
    // schema stub, and auth.uid() — all idempotent no-ops on Supabase
    psql(scratch, ["--file", BOOTSTRAP], "test bootstrap (roles, auth.uid, pgtap)");

    for (const name of migrations) {
      psql(scratch, ["--file", join(MIGRATIONS_DIR, name)], `migration ${name}`);
    }

    let failed = 0;
    for (const name of tests) {
      const result = psql(scratch, ["--file", join(TESTS_DIR, name)], `suite ${name}`, { check: false });
      const failedTests = (result.stdout ?? "").match(/^ not ok/gm)?.length ?? 0;
      const ok = result.status === 0 && failedTests === 0;
      if (ok) {
        const passed = (result.stdout ?? "").match(/^ ok /gm)?.length ?? 0;
        console.log(`✓ ${name} (${passed} assertions)`);
      } else {
        failed += 1;
        console.error(`✗ ${name}\n${result.stdout ?? ""}${result.stderr ?? ""}`);
      }
    }

    if (failed > 0) {
      console.error(`\n${failed} test suite(s) failed`);
      exitCode = 1;
    } else {
      console.log(`\nAll ${tests.length} pgTAP suite(s) passed`);
    }
  } finally {
    psql(CONNECTION, ["-c", `drop database if exists "${SCRATCH_DB}"`], "drop scratch database", { check: false });
  }
  process.exit(exitCode);
}

function rewriteDbName(connection, name) {
  // keep host/port/user/params, swap the path dbname
  try {
    const url = new URL(connection);
    url.pathname = `/${name}`;
    return url.toString();
  } catch {
    // plain "postgresql:///dbname" or unix-socket form
    return connection.replace(/\/[^/?]+$/, `/${name}`);
  }
}

main();
