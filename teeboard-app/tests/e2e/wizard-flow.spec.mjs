import { test, expect } from "@playwright/test";
import {
  signupOwner,
  createCourse,
  stubClaude,
  resetClaude,
} from "./helpers.mjs";

/** @typedef {import("@playwright/test").Page} Page */

/**
 * The milestone's headline E2E (M4-T009): a brand-new user signs up, creates
 * a club, sets up a course, uses the AI one-sentence pre-fill ("2-man best
 * ball, 9 holes front, net"), imports players via CSV, forms groups, and
 * publishes a real event — the full signup → published-event happy path,
 * plus the four critical sub-paths:
 *
 *   - AI fallback to the empty wizard on bad input
 *   - CSV per-row error flagging (skip rows, keep clean rows)
 *   - draft-only delete (server-enforced)
 *   - the typed-CHANGE confirmation for live format edits
 *
 * The suite runs against a production build with the throwaway mock Supabase
 * (tests/e2e/mock-supabase.mjs) answering the REST/auth surface; the Claude
 * double answers /v1/messages (see the AI tests). No credentials, no
 * network, no seeded data — every test builds its own club from /sign-up.
 */

test.beforeEach(async () => {
  await resetClaude();
});

const EVENT_DATE = "2026-11-14";

const CLEAN_CSV = [
  "Golfer Name,HCP,E-mail,WHS #",
  "Devon Clarke,12.4,devon@example.test,1234567",
  "Priya Raghavan,8.2,priya@example.test,2345678",
  "Marcus Kowalczyk,17.9,marcus@example.test,3456789",
  "Sofia Lindqvist,4.6,sofia@example.test,4567890",
].join("\n");

/** @param {Page} page */
async function wizard(page) {
  await page.goto("/admin/events/new");
  await expect(
    page.getByText("Five steps from blank page to published event."),
  ).toBeVisible();
  return {
    /**
     * Waits until the step rail unlocks `label` (the rail re-renders from
     * fresh server props after each save), then returns the step button.
     * @param {string} label
     */
    async step(label) {
      const button = page
        .getByRole("button", { name: new RegExp(label, "i") })
        .first();
      // The rail may still hold pre-save props while the action's refresh
      // lands; give the unlock room to arrive (default is 5s).
      await expect(button).toBeEnabled({ timeout: 30_000 });
      return button;
    },
  };
}

test("signup → club → course → AI pre-fill → CSV import → groups → publish", async ({
  page,
}) => {
  test.setTimeout(240_000);

  // ── 1. Sign up: the first-run provisioning creates the club. ─────────
  await signupOwner(page);
  await expect(
    page.getByRole("banner").getByText("Cypress Ridge Golf Club"),
  ).toBeVisible();

  // ── 2. Course setup: paste-from-scorecard → grid → save. ──────────────
  await createCourse(page, "Cypress Ridge Championship");

  // ── 3. Wizard: AI one-sentence pre-fill. ─────────────────────────────
  const w = await wizard(page);

  // The Claude double answers the exact wizard JSON contract for the
  // sentence; nothing else may pre-fill.
  await stubClaude({
    rules: [
      {
        status: 200,
        onlyWhenTextIncludes: "2-man best ball",
        payload: JSON.stringify({
          name: "Saturday Best Ball",
          startDate: EVENT_DATE,
          holesCount: 9,
          nineOption: "front",
          format: "best_ball",
          teamSize: 2,
          scoringBasis: "net",
        }),
      },
    ],
  });

  await page
    .getByLabel("Event description")
    .fill("2-man best ball, 9 holes front, net");
  await page.getByRole("button", { name: "Auto-fill the wizard" }).click();
  // The badges are the '[data-slot="autofill-badge"]' spans (scoped: the
  // status line also says "Auto-filled", and many badges may show at once).
  await expect(
    page.locator('[data-slot="autofill-badge"]').first(),
  ).toBeVisible();

  // The Basics step carries the pre-filled name; save (creates the draft).
  await expect(page.getByLabel("Event name")).toHaveValue("Saturday Best Ball");
  await expect(page.getByLabel("Date")).toHaveValue(EVENT_DATE);
  await page.getByRole("button", { name: "Create draft" }).click();
  await expect(page.getByText("Basics saved")).toBeVisible();

  // ── 4. Format step: the pre-fill switched format + team size. ─────────
  (await w.step("Format")).click();
  await expect(
    page.getByRole("radio", { name: "Best ball", exact: false }),
  ).toBeChecked();
  await page.getByRole("button", { name: "Save format" }).click();
  await expect(page.getByText("Format saved")).toBeVisible();

  // ── 5. Players step: CSV import with auto column mapping. ─────────────
  (await w.step("Players")).click();
  await page
    .getByLabel("CSV text to import")
    .fill(CLEAN_CSV);
  await expect(page.getByText("4 mapped")).toBeVisible();
  await page
    .getByRole("button", { name: /Add \d players? to the event/ })
    .click();
  await expect(
    page.getByText(/Attached \d player/i),
  ).toBeVisible();

  // ── 6. Groups & teams: auto-pairing. ───────────────────────────────────
  (await w.step("Groups")).click();
  await expect(page.getByText("4 waiting")).toBeVisible();
  await page.getByRole("button", { name: "Save groups" }).click();
  await expect(page.getByText(/Groups saved/i)).toBeVisible();

  // ── 7. Extras & publish: flights/side games then Publish. ─────────────
  (await w.step("Extras")).click();
  await expect(page.getByText("Publishing locks the wizard")).toBeVisible();
  await page.getByRole("button", { name: "Publish event" }).click();
  await expect(page.getByText(/Published\. The scorer PIN is/i)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Publish" })).toBeVisible();

  // The shareable links surface with the minted short code.
  await expect(page.getByText(/\/e\/[a-z2-9]{6}/)).toBeVisible();

  // ── 8. The events list links the published event to its admin page. ────
  await page.goto("/admin/events");
  await expect(
    page.getByRole("link", { name: "Saturday Best Ball" }),
  ).toBeVisible();
  await expect(page.getByText("Scheduled")).toBeVisible();
});

test("AI fallback: bad model output leaves the wizard empty with the failure message", async ({
  page,
}) => {
  await signupOwner(page, {
    fullName: "Fall Owner",
    clubName: "Fallback Fields Club",
    email: "fallback@fields.test",
    password: "correct-horse-battery-staple",
  });
  await createCourse(page, "Fallback Fields");

  await stubClaude({
    fallback: {
      // Model output that fails the Zod prefill contract (unknown shape).
      status: 200,
      payload: "Sorry, I could not read that description.",
    },
  });

  const w = await wizard(page);
  await page.getByLabel("Event description").fill("totally valid text");
  await page.getByRole("button", { name: "Auto-fill the wizard" }).click();

  await expect(page.getByText("Couldn't read that")).toBeVisible();
  // No Auto-filled badge survives a failed parse.
  await expect(page.locator('[data-slot="autofill-badge"]')).toHaveCount(0);
  // The wizard is left empty: no pre-filled name, no badge anywhere.
  await expect(page.getByLabel("Event name")).toHaveValue("");
});

test("CSV import flags invalid rows by line and still imports clean rows", async ({
  page,
}) => {
  await signupOwner(page, {
    fullName: "Flag Owner",
    clubName: "Flagged Fairways Club",
    email: "flags@fairways.test",
    password: "correct-horse-battery-staple",
  });
  await createCourse(page, "Flagged Fairways");

  // Create a draft first so the roster step attaches.
  const w = await wizard(page);
  await page.getByLabel("Event name").fill("Flagged Invitational");
  await page.getByLabel("Date").fill(EVENT_DATE);
  await page.getByRole("button", { name: "Create draft" }).click();
  await expect(page.getByText("Basics saved")).toBeVisible();

  // Players unlocks only once the Format step has saved (the rail gates on
  // a persisted primary format before the roster becomes reachable).
  (await w.step("Format")).click();
  await page.getByRole("button", { name: "Save format" }).click();
  await expect(page.getByText("Format saved")).toBeVisible();

  (await w.step("Players")).click();

  const messyCsv = [
    "Golfer Name,HCP,E-mail,WHS #",
    "Good Player,10.2,good@example.test,1111111",
    "Bad Email,12.0,not-an-email,2222222", // invalid email → flagged
    "Out Of Range,99.9,range@example.test,3333333", // HI out of range → flagged
    "Missing Name,,missing@example.test,4444444", // missing name → flagged
  ].join("\n");
  await page.getByLabel("CSV text to import").fill(messyCsv);

  // Three rows are flagged with per-row, actionable messages.
  await expect(page.getByText(/Flagged rows \(3\)/)).toBeVisible();
  await expect(
    page.getByText(/Line 3:/, { exact: false }),
  ).toBeVisible();
  await expect(page.getByText(/Line 4:/, { exact: false })).toBeVisible();
  await expect(page.getByText(/Line 5:/, { exact: false })).toBeVisible();

  // Only the clean row reaches the preview (the flagged rows are excluded).
  await expect(page.getByText("1 mapped")).toBeVisible();
  await expect(page.getByRole("cell", { name: "Good Player" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "Bad Email" })).toHaveCount(0);
});

test("draft-only delete: the server refuses to delete a published event", async ({
  page,
}) => {
  await signupOwner(page, {
    fullName: "Delete Owner",
    clubName: "Delete Denial Club",
    email: "delete@denial.test",
    password: "correct-horse-battery-staple",
  });
  await createCourse(page, "Delete Denial Links");

  // Build a minimal but real published event: draft → players → groups → publish.
  const w = await wizard(page);
  await page.getByLabel("Event name").fill("Delete Denial Open");
  await page.getByLabel("Date").fill(EVENT_DATE);
  await page.getByRole("button", { name: "Create draft" }).click();
  await expect(page.getByText("Basics saved")).toBeVisible();

  (await w.step("Format")).click();
  await page.getByRole("button", { name: "Save format" }).click();
  await expect(page.getByText("Format saved")).toBeVisible();

  (await w.step("Players")).click();
  await page
    .getByLabel("CSV text to import")
    .fill("Golfer Name,HCP,E-mail\nAda Flagler,11.1,ada@example.test");
  await page
    .getByRole("button", { name: /Add \d players? to the event/ })
    .click();
  await expect(page.getByText(/Attached \d player/i)).toBeVisible();

  (await w.step("Groups")).click();
  await page.getByRole("button", { name: "Save groups" }).click();
  await expect(page.getByText(/Groups saved/i)).toBeVisible();

  (await w.step("Extras")).click();
  await page.getByRole("button", { name: "Publish event" }).click();
  await expect(page.getByText(/Published\. The scorer PIN is/i)).toBeVisible();

  // The published event's admin page shows NO delete (draft-only server-side).
  await page.goto("/admin/events");
  await page
    .getByRole("link", { name: "Delete Denial Open" })
    .click();
  await expect(
    page.getByText("Delete is restricted to drafts server-side"),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Delete draft" }),
  ).toHaveCount(0);

  // The events list keeps the event.
  await page.goto("/admin/events");
  await expect(
    page.getByRole("link", { name: "Delete Denial Open" }),
  ).toBeVisible();
});

test("live format edit requires the typed CHANGE confirmation", async ({
  page,
}) => {
  await signupOwner(page, {
    fullName: "Confirm Owner",
    clubName: "Confirm Cup Club",
    email: "confirm@cup.test",
    password: "correct-horse-battery-staple",
  });
  await createCourse(page, "Confirm Cup Course");

  // Publish a stroke-play event through the real flow.
  const w = await wizard(page);
  await page.getByLabel("Event name").fill("Confirm Cup");
  await page.getByLabel("Date").fill(EVENT_DATE);
  await page.getByRole("button", { name: "Create draft" }).click();
  await expect(page.getByText("Basics saved")).toBeVisible();

  (await w.step("Format")).click();
  await page.getByRole("button", { name: "Save format" }).click();
  await expect(page.getByText("Format saved")).toBeVisible();

  (await w.step("Players")).click();
  await page
    .getByLabel("CSV text to import")
    .fill("Golfer Name,HCP,E-mail\nBea Confirm,14.0,bea@example.test");
  await page
    .getByRole("button", { name: /Add \d players? to the event/ })
    .click();
  await expect(page.getByText(/Attached \d player/i)).toBeVisible();

  (await w.step("Groups")).click();
  await page.getByRole("button", { name: "Save groups" }).click();
  await expect(page.getByText(/Groups saved/i)).toBeVisible();

  (await w.step("Extras")).click();
  await page.getByRole("button", { name: "Publish event" }).click();
  await expect(page.getByText(/Published\. The scorer PIN is/i)).toBeVisible();

  // Open the published event's Settings tab.
  await page.goto("/admin/events");
  await page.getByRole("link", { name: "Confirm Cup" }).click();
  await page.getByRole("tab", { name: "Settings" }).click();

  // Changing the format reveals the confirmation panel; the save stays
  // locked until CHANGE is typed.
  await page
    .getByRole("radio", { name: "Best ball", exact: false })
    .check();
  await expect(
    page.getByText(/Type CHANGE to confirm/i),
  ).toBeVisible();
  const saveButton = page.getByRole("button", { name: "Save settings" });
  await expect(saveButton).toBeDisabled();
  await page
    .getByLabel("Type CHANGE to confirm the format change")
    .fill("CHANG");
  await expect(saveButton).toBeDisabled();
  await page
    .getByLabel("Type CHANGE to confirm the format change")
    .fill("CHANGE");
  await expect(saveButton).toBeEnabled();
  await saveButton.click();
  await expect(page.getByText("Settings saved")).toBeVisible();
});
