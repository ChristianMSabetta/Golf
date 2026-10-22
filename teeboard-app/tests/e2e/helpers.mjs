/**
 * Shared E2E-suite helpers (M4-T009). TEST INFRASTRUCTURE ONLY — never
 * imported by the app. Every helper drives the real UI: sign-up runs the
 * real first-run provisioning (auth user + club row + owner profile) in the
 * app against the mock Supabase, and course creation runs the real editor,
 * paste parser, validation, and save action.
 */

import { expect } from "@playwright/test";
import { MOCK_PORT } from "./mock-supabase.mjs";

const OWNER = {
  fullName: "Dana Whitley",
  clubName: "Cypress Ridge Golf Club",
  email: "owner@cypressridge.test",
  password: "correct-horse-battery-staple",
};

/**
 * Signs a brand-new owner up through the real /sign-up form and waits for
 * the first-run provisioning to land on the admin dashboard.
 */
export async function signupOwner(page, details = OWNER) {
  const { fullName, clubName, email, password } = details;
  await page.goto("/sign-up");
  await page.getByLabel("Full name").fill(fullName);
  await page.getByLabel("Club name").fill(clubName);
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Create club" }).click();
  await page.waitForURL(/\/admin$/);
  // The admin shell is up once the top bar shows the club identity + sign out
  // (scoped to the banner: the dashboard card repeats the club name).
  await expect(
    page.getByRole("banner").getByText(clubName, { exact: false }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
}

/** A deterministic, schema-valid 18-hole scorecard for the paste parser. */
export function scorecardText() {
  const pars = [
    4, 4, 3, 5, 4, 3, 4, 5, 4, 4, 3, 4, 5, 4, 4, 3, 4, 5,
  ];
  const yards = [
    401, 385, 178, 512, 372, 165, 396, 548, 428, 412, 186, 367, 521, 398,
    433, 158, 402, 536,
  ];
  const sis = [
    7, 11, 15, 1, 5, 17, 9, 3, 13, 8, 16, 6, 2, 10, 12, 18, 4, 14,
  ];
  return pars
    .map((par, i) => `${i + 1} ${par} ${yards[i]} ${sis[i]}`)
    .join("\n");
}

/**
 * Creates a course through the real editor (paste parser → grid → save) and
 * waits for the redirect to the saved course's page.
 */
export async function createCourse(page, name) {
  await page.goto("/admin/courses/new");
  await page.getByLabel("Course name").fill(name);
  // The starter tee ("White", mens) validates empty: fill WHS-legal values.
  await page.getByLabel("Course rating").fill("72.1");
  await page.getByLabel("Slope").fill("128");
  await page.getByRole("button", { name: "Paste from scorecard" }).click();
  await page.getByLabel("Scorecard text").fill(scorecardText());
  await page.getByRole("button", { name: "Fill grid" }).click();
  // The parser runs synchronously into React state; the paste card closes on
  // apply, so the grid itself is the confirmation. The first hole's par input
  // proves the parse landed before saving.
  await expect(page.getByLabel("Hole 1 par")).toHaveValue("4");
  await page.getByRole("button", { name: "Save course" }).first().click();
  // saveCourse answers inline (no redirect): the confirmation is the saved
  // message, and the editor's title switches from "New course" to the name.
  await expect(page.getByText("Course saved.")).toBeVisible();
}

/**
 * Steers the Claude double inside the webServer bootstrap's process (the
 * mock lives there, not in this worker). `rules` are
 * `{ status, payload, onlyWhenTextIncludes? }` — a narrowed rule only
 * answers prompts containing its needle; otherwise `default` answers.
 */
export async function stubClaude({ rules = [], fallback }) {
  const response = await fetch(`http://127.0.0.1:${MOCK_PORT}/e2e/claude`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      rules,
      default: fallback ?? { status: 200, payload: "{}" },
    }),
  });
  if (!response.ok) {
    throw new Error(`Claude stub rejected: ${response.status}`);
  }
}

/** Resets the Claude double between tests (Playwright calls this per worker). */
export async function resetClaude() {
  await fetch(`http://127.0.0.1:${MOCK_PORT}/e2e/claude`, { method: "DELETE" });
}
