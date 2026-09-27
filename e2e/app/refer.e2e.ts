// Refer in the app (boards F1 to F6) for the fitted client of e2e/app/fitted.ts, and for a client not yet fitted,
// against the local mm-api. Neither has credits or anybody fitted yet, so this covers the invite, the card choice,
// the preview and the empty tracker; the grant itself is covered in the worker tests.

import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import sharp from "sharp";
import { expect, test } from "../support.ts";
import { fittedClient } from "./fitted.ts";
import { holdOpen } from "./one-tap.ts";
import { logIn, signIn } from "./signed-in.ts";

test.use({ permissions: ["clipboard-read", "clipboard-write"] });

const scan = async (page: Page) => {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(results.violations.map((violation) => violation.id)).toEqual([]);
};

async function toRefer(page: Page) {
  await logIn(page, fittedClient().mobile);
  await page.getByRole("navigation").getByRole("link", { name: "Refer" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Refer" })).toBeVisible();
}

test("Refer: the invite, the house card, the preview, and the empty tracker", async ({ page }) => {
  await toRefer(page);
  await expect(page.getByText("When a friend you refer is fitted, you both get 3 service visits free.")).toBeVisible();
  await expect(page.getByText("No other discount applies.")).toBeVisible();

  await page.getByRole("button", { name: "Share an invite" }).click();
  const sheet = page.getByRole("dialog", { name: "Which card?" });
  await expect(sheet.getByText("This is what he sees in the chat. No name on it, and no copy.")).toBeVisible();
  await scan(page);
  await sheet.getByRole("radio", { name: /A Mane Man example/ }).click();
  await sheet.getByRole("button", { name: "Continue to share" }).click();

  // Board F4: the chat's bubble, exactly as the friend will see it, with the house card itself in it.
  const preview = page.getByRole("dialog", { name: "Preview · what your friend sees" });
  await expect(preview.getByText("You have a Mane Man invite")).toBeVisible();
  await expect(
    preview.getByText(/Had my hair system fitted at home by these people\. Worth a look — .*\/r\/[A-Z0-9]{6}/),
  ).toBeVisible();
  await expect(preview.locator("img").first()).toHaveAttribute("src", /invite-house/);
  await expect(preview.getByRole("link", { name: "WhatsApp" })).toHaveAttribute("href", /^https:\/\/wa\.me\/\?text=/);
  await preview.getByRole("button", { name: "Copy link" }).click();
  await expect(preview.getByRole("button", { name: "Link copied" })).toBeVisible();
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toMatch(/\/r\/[A-Z0-9]{6}$/);
  await scan(page);

  await preview.getByRole("button", { name: "Close" }).click();
  await page.getByRole("link", { name: "See who has been fitted" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Who has been fitted" })).toBeVisible();
  await expect(page.getByText("Nobody you have referred has been fitted yet.")).toBeVisible();
  await scan(page);

  // Board F6: the empty tracker is not a dead end.
  await page.getByRole("button", { name: "Share an invite" }).click();
  await expect(page.getByRole("dialog", { name: "Which card?" })).toBeVisible();
});

// Board F6's "Share failed": a way to share that fails, not one the client backs out of, says nothing was sent.
test("says when the link could not be shared, and tries again", async ({ page }) => {
  await toRefer(page);
  await page.getByRole("button", { name: "Share an invite" }).click();
  await page.getByRole("radio", { name: /A Mane Man example/ }).click();
  await page.getByRole("button", { name: "Continue to share" }).click();
  await page.evaluate(() => {
    const writeText = navigator.clipboard.writeText.bind(navigator.clipboard);
    let refused = false;
    navigator.clipboard.writeText = (text: string) => {
      if (refused) return writeText(text);
      refused = true;
      return Promise.reject(new DOMException("The page may not write to the clipboard.", "NotAllowedError"));
    };
  });
  await page.getByRole("button", { name: "Copy link" }).click();
  await expect(page.getByRole("alert")).toContainText("The link did not generate. Nothing was sent.");
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByRole("button", { name: "Link copied" })).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
});

// "Without consent, the first option opens F3 instead of selecting." And nothing is agreed to for a card the
// phone could not make: this client's first fit has an after photograph and no before (e2e/app/fitted.ts).
test("asks for the consent before choosing their own card, and records none when the card cannot be made", async ({
  page,
}) => {
  await toRefer(page);
  await page.getByRole("button", { name: "Share an invite" }).click();
  await page.getByRole("radio", { name: /My before and after/ }).click();
  await expect(page.getByRole("heading", { name: "Before you send your own photographs" })).toBeVisible();
  await expect(page.getByText("Your first name appears on your invite.")).toBeVisible();

  const consents = await holdOpen(page, "**/api/consents/*");
  let builds = 0;
  page.on("request", (sent) => {
    if (sent.method() === "GET" && sent.url().endsWith("/api/photos")) builds += 1;
  });
  const allow = page.getByRole("button", { name: "Allow for referral cards" });
  await allow.click();
  // Forced, because the tap this guards against is one the client makes whether it is taken or not.
  await allow.click({ force: true });

  await expect(page.getByRole("heading", { name: "Preview · what your friend sees" })).toBeVisible();
  await expect(page.getByRole("alert")).toHaveText("We could not make your card. The house example is used instead.");
  expect({ consents: consents.asked(), builds }).toEqual({ consents: 0, builds: 1 });
});

// The whole of their own card: composed in a Worker from the two front photographs, then the consent recorded,
// then the card stored, once each however often Allow is tapped. The photographs and the store are answered here,
// so the shared client is left with the house card.
test("makes their own card, records one consent and stores one card, when Allow is tapped twice", async ({ page }) => {
  const block = async (background: string) =>
    sharp({ create: { width: 600, height: 800, channels: 3, background } })
      .jpeg()
      .toBuffer();
  const [before, after] = await Promise.all([block("#131c2e"), block("#1a2740")]);
  const front = (url: string) => ({ angle: "front", url, width: 600, height: 800 });
  await page.route("**/api/photos", (route) =>
    route.fulfill({
      json: {
        visits: [
          {
            visit_id: fittedClient().firstFit.id,
            date: fittedClient().firstFit.date,
            type: "first_fit",
            photos: { before: [front("/e2e/before.jpg")], after: [front("/e2e/after.jpg")] },
          },
        ],
      },
    }),
  );
  await page.route("**/e2e/before.jpg", (route) => route.fulfill({ body: before, contentType: "image/jpeg" }));
  await page.route("**/e2e/after.jpg", (route) => route.fulfill({ body: after, contentType: "image/jpeg" }));
  const stored: number[] = [];
  await page.route("**/api/refer/card", async (route) => {
    if (route.request().method() !== "PUT") return route.continue();
    stored.push(route.request().postDataBuffer()?.byteLength ?? 0);
    return route.fulfill({ json: { version: 2 } });
  });
  // The consent itself is answered here too, so the shared client is not left agreeing to anything. The card is
  // composed before it is asked for, so a second tap lands while the first is still at work.
  let consents = 0;
  await page.route("**/api/consents/*", (route) => {
    consents += 1;
    return route.fulfill({
      json: { purpose: "photos_referral_cards", granted: true, since: new Date().toISOString() },
    });
  });

  await toRefer(page);
  await page.getByRole("button", { name: "Share an invite" }).click();
  await page.getByRole("radio", { name: /My before and after/ }).click();
  const allow = page.getByRole("button", { name: "Allow for referral cards" });
  await allow.click();
  await allow.click({ force: true });

  const preview = page.getByRole("dialog", { name: "Preview · what your friend sees" });
  await expect(preview).toBeVisible();
  await expect(preview.getByRole("alert")).toHaveCount(0);
  await expect(preview.locator("img").first()).toHaveAttribute("src", /^blob:/);
  expect({ consents, stored: stored.length }).toEqual({ consents: 1, stored: 1 });
  // A JPEG, and under the 300 KB WhatsApp takes.
  expect(stored[0]).toBeGreaterThan(0);
  expect(stored[0]).toBeLessThan(300 * 1024);
});

// The owner's ruling of 27 September 2026: everyone signed in can share an invite, where board B2 drew Refer empty
// for a lead (ADR 0083). With no photographs of their own yet, the invite is the house card, in words true for them.
test("a client not yet fitted shares the house card, in words true for them, and the link opens the landing", async ({
  page,
  request,
}) => {
  await signIn(page, request);
  await page.getByRole("navigation").getByRole("link", { name: "Refer" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Refer" })).toBeVisible();
  await expect(page.getByText("When a friend you refer is fitted, you both get 3 service visits free.")).toBeVisible();
  await expect(page.getByText("No other discount applies.")).toBeVisible();
  await scan(page);

  await page.getByRole("button", { name: "Share an invite" }).click();
  const preview = page.getByRole("dialog", { name: "Preview · what your friend sees" });
  await expect(preview).toBeVisible();
  await expect(preview.getByRole("radio")).toHaveCount(0);
  await expect(preview.locator("img").first()).toHaveAttribute("src", /invite-house/);
  await expect(
    preview.getByText(/^These people fit hair systems at home, across Delhi NCR\. Worth a look — .*\/r\/[A-Z0-9]{6}$/),
  ).toBeVisible();
  await expect(preview.getByText(/Had my hair system fitted/)).toHaveCount(0);
  await preview.getByRole("button", { name: "Copy link" }).click();
  await expect(preview.getByRole("button", { name: "Link copied" })).toBeVisible();
  const link = await page.evaluate(() => navigator.clipboard.readText());
  expect(link).toMatch(/\/r\/[A-Z0-9]{6}$/);
  await scan(page);

  await preview.getByRole("button", { name: "Close" }).click();
  await page.getByRole("link", { name: "See who has been fitted" }).click();
  await expect(page.getByText("Nobody you have referred has been fitted yet.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Share an invite" })).toBeVisible();

  // The landing reads a lead's invite as any other: valid, with the visits, and naming nobody without consent.
  await page.goto(link);
  await expect(page.getByText("Get fitted and you both get 3 service visits free.")).toBeVisible();
  await expect(page.getByText("We do not recognise this invite")).toHaveCount(0);
  await expect(page.getByText(/sent you this/)).toHaveCount(0);
});
