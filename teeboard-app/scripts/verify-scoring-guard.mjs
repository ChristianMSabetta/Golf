#!/usr/bin/env node
/**
 * The guard-effectiveness demonstration (M3-T004): a guard that never
 * fails is worse than no guard, so this script proves the
 * no-scoring-math-elsewhere guard actually fails the build.
 *
 * It plants an intentional violation (arithmetic on scores inside a
 * component) in src/components/, asserts that the guard exits non-zero,
 * removes the file, and asserts the guard exits zero again. Nothing is
 * left behind on either exit path.
 *
 * Run: npm run guard:scoring-boundary:prove
 */
import { spawnSync } from "node:child_process";
import { writeFileSync, unlinkSync, existsSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const ROOT = path.resolve(import.meta.dirname, "..");
const GUARD = path.join(ROOT, "scripts", "guard-scoring-boundary.mjs");
const VIOLATION_FILE = path.join(
  ROOT,
  "src",
  "components",
  "proof",
  "guard-violation-demo.tsx",
);

const VIOLATION_SOURCE = `/**
 * Intentional guard violation, planted only by
 * scripts/verify-scoring-guard.mjs to prove the no-scoring-math guard
 * fails the build — never committed.
 */
export function netToPar(net: number, par: number) {
  return net - par;
}
`;

function runGuard() {
  return spawnSync(process.execPath, [GUARD], {
    encoding: "utf8",
    cwd: ROOT,
  });
}

function fail(message) {
  console.error(`prove: ${message}`);
  process.exit(1);
}

let planted = false;
try {
  writeFileSync(VIOLATION_FILE, VIOLATION_SOURCE);
  planted = true;

  const violationRun = runGuard();
  if (violationRun.status === 0) {
    fail(
      "the guard did NOT fail on the intentional violation — the guard is ineffective",
    );
  }
  console.log("prove: 1/3 the guard FAILED on the planted violation (expected):");
  const violationOutput = `${violationRun.stdout ?? ""}\n${violationRun.stderr ?? ""}`;
  for (const line of violationOutput.split("\n")) {
    if (line.trim()) console.log(`        ${line}`);
  }

  unlinkSync(VIOLATION_FILE);
  planted = false;

  const cleanRun = runGuard();
  if (cleanRun.status !== 0) {
    fail("the guard failed on the clean tree after cleanup");
  }
  console.log("prove: 2/3 the guard PASSED on the clean tree after removing the violation");
  console.log("prove: 3/3 guard effectiveness demonstrated — exit codes verified");
  process.exit(0);
} catch (error) {
  if (planted && existsSync(VIOLATION_FILE)) {
    unlinkSync(VIOLATION_FILE);
  }
  fail(String(error));
}
