// Refer in the app (boards F1 to F6) for the fitted client of e2e/app/fitted.ts, against the local mm-api. The
// client has no credits and nobody fitted yet, so this covers the invite, the card choice, the preview and the
// empty tracker; the grant itself is covered in the worker tests.

import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "../support.ts";
import { fittedClient } from "./fitted.ts";
import { holdOpen } from "./one-tap.ts";
import { logIn } from "./signed-in.ts";

test.use({ permissions: ["clipboard-read", "clipboard-write"] });

test("Refer: the invite, the house card, the preview, and the empty tracker", async ({ page }) => {
  await logIn(page, fittedClient().mobile);
  await page.getByRole("navigation").getByRole("link", { name: "Refer" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Refer" })).toBeVisible();
  await expect(page.getByText("When a friend you refer is fitted, you both get 3 service visits free.")).toBeVisible();
  await expect(page.getByText("No other discount applies.")).toBeVisible();

  await page.getByRole("button", { name: "Share an invite" }).click();
  const sheet = page.getByRole("dialog", { name: "Which card?" });
  await expect(sheet.getByText("This is what he sees in the chat. No name on it, and no copy.")).toBeVisible();
  await sheet.getByRole("radio", { name: /A Mane Man example/ }).click();
  await sheet.getByRole("button", { name: "Continue to share" }).click();

  const preview = page.getByRole("dialog", { name: /^Preview/ });
  await expect(
    preview.getByText(/Had my hair system fitted at home by these people\. Worth a look — .*\/r\/[A-Z0-9]{6}/),
  ).toBeVisible();
  await expect(preview.getByRole("link", { name: "Share via WhatsApp" })).toHaveAttribute(
    "href",
    /^https:\/\/wa\.me\/\?text=/,
  );
  await preview.getByRole("button", { name: "Copy link" }).click();
  await expect(preview.getByRole("button", { name: "Link copied" })).toBeVisible();
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toMatch(/\/r\/[A-Z0-9]{6}$/);

  await page.getByRole("button", { name: "Close" }).click();
  await page.getByRole("link", { name: "See who has been fitted" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Who has been fitted" })).toBeVisible();
  await expect(page.getByText("Nobody you have referred has been fitted yet.")).toBeVisible();

  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(results.violations.map((violation) => violation.id)).toEqual([]);
});

test("records one consent, and builds one card, when Allow is tapped twice", async ({ page }) => {
  await logIn(page, fittedClient().mobile);
  await page.getByRole("navigation").getByRole("link", { name: "Refer" }).click();
  await page.getByRole("button", { name: "Share an invite" }).click();
  const sheet = page.getByRole("dialog", { name: "Which card?" });
  await sheet.getByRole("radio", { name: "My before and after" }).click();
  await sheet.getByRole("button", { name: "Continue to share" }).click();

  // The consent ledger is append-only by trigger, so a second row is a permanent record of an
  // agreement given once; and each Allow builds the whole card again. The timeline is the first
  // of that pipeline's four fetches, and the only one this fixture reaches: its first fit has an
  // after photograph and no before, so nothing is composed or uploaded here (e2e/app/fitted.ts).
  const consents = await holdOpen(page, "**/api/consents/*");
  let builds = 0;
  page.on("request", (sent) => {
    if (sent.method() === "GET" && sent.url().endsWith("/api/photos")) builds += 1;
  });

  const allow = page.getByRole("button", { name: "Allow for referral cards" });
  await allow.click();
  const liveWhileBusy = await allow.isEnabled();
  // Forced, because the tap this guards against is one the client makes whether it is taken or not.
  await allow.click({ force: true });

  await expect(page.getByRole("heading", { name: /^Preview/ })).toBeVisible();
  expect({ consents: consents.asked(), builds, liveWhileBusy }).toEqual({
    consents: 1,
    builds: 1,
    liveWhileBusy: false,
  });
});
