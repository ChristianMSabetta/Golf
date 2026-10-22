import { test, expect } from "@playwright/test";
import { signupOwner, createCourse, stubClaude } from "./helpers.mjs";

const EVENT_DATE = "2026-11-14";

test("debug happy path rail", async ({ page }) => {
  await signupOwner(page, {
    fullName: "Happy Owner",
    clubName: "Happy Debug Club Three",
    email: "happy3@dbg.test",
    password: "correct-horse-battery-staple",
  });
  await createCourse(page, "Happy Debug Course Three");

  await page.goto("/admin/events/new");
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
  await page.getByLabel("Event description").fill("2-man best ball, 9 holes front, net");
  await page.getByRole("button", { name: "Auto-fill the wizard" }).click();
  await expect(page.locator('[data-slot="autofill-badge"]').first()).toBeVisible();
  await expect(page.getByLabel("Event name")).toHaveValue("Saturday Best Ball");
  console.log("A: prefill ok, URL:", page.url());
  await page.getByRole("button", { name: "Create draft" }).click();
  await page.getByText("Basics saved").waitFor({ state: "visible", timeout: 30000 });
  console.log("B: basics saved, URL:", page.url());
  await page.waitForTimeout(4000);
  console.log("C: after wait, URL:", page.url());
  const fmt = page.getByRole("button", { name: /^2 Format|Format$/i }).first();
  console.log("D: format enabled:", await fmt.isEnabled().catch(() => "err"));
  const heading = await page.locator("h1").first().innerText();
  console.log("E: wizard heading:", heading);
  const railButtons = await page.locator("ol button").allInnerTexts();
  console.log("F: rail:", JSON.stringify(railButtons));
  await page.reload();
  await page.waitForTimeout(3000);
  const heading2 = await page.locator("h1").first().innerText();
  console.log("G: heading after reload:", heading2, "URL:", page.url());
  const fmt2 = page.getByRole("button", { name: /Format/i }).first();
  console.log("H: format enabled after reload:", await fmt2.isEnabled().catch(() => "err"));
});
