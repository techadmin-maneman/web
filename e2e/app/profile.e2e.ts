// The client app's profile (boards G1 and G2), against the local mm-api, logged
// in with the local fixed code (OTP_FIXED_CODE in playwright.config.ts).

import AxeBuilder from "@axe-core/playwright";
import type { APIRequestContext, Page } from "@playwright/test";
import { expect, randomMobile, test } from "../support.ts";
import { CODE, signIn } from "./signed-in.ts";

async function loggedIn(page: Page, request: APIRequestContext): Promise<string> {
  const mobile = await signIn(page, request);
  await page.getByRole("link", { name: "Your profile" }).click();
  await expect(page.getByRole("heading", { name: "Where we come" })).toBeVisible();
  return mobile;
}

test("opens from Home's button, with the client's name and a way back", async ({ page, request }) => {
  await loggedIn(page, request);
  await expect(page.getByRole("banner")).toContainText("Rohit Malhotra");
  await page.getByRole("link", { name: "Back" }).click();
  await expect(page.getByRole("heading", { name: "Your consultation" })).toBeVisible();
});

test("keeps the tabs at the foot of the screen, and scrolls only the page, however long it is", async ({
  page,
  request,
}) => {
  await loggedIn(page, request);
  const tabs = await page.getByRole("navigation").boundingBox();
  expect((tabs?.y ?? 0) + (tabs?.height ?? 0)).toBe(844);
  const heights = await page.evaluate(() => ({
    document: document.documentElement.scrollHeight,
    page: document.querySelector("main")?.scrollHeight ?? 0,
  }));
  expect(heights.document).toBe(844);
  expect(heights.page).toBeGreaterThan(844);
});

test("shows board B3's loading shape while the profile comes", async ({ page, request }) => {
  await signIn(page, request);
  let release: () => void = () => undefined;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/profile", async (route) => {
    await held;
    await route.continue();
  });
  await page.getByRole("link", { name: "Your profile" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Loading" })).toBeAttached();
  release();
  await expect(page.getByRole("heading", { name: "Where we come" })).toBeVisible();
});

test("takes an address and its access notes, and shows them", async ({ page, request }) => {
  await loggedIn(page, request);
  await expect(page.getByText("No address yet.")).toBeVisible();
  await page.getByRole("button", { name: "Add your address and access notes" }).click();
  await page.getByLabel("House, flat or building").fill("House 4417, Tower C");
  await page.getByLabel("Sector or area").fill("Sector 65");
  await page.getByLabel("City").fill("Gurgaon");
  await page.getByLabel("Pincode").fill("122018");
  await page.getByLabel("Access notes (optional)").fill("Gate code 4417 · park in visitor bay B");
  await page.getByRole("button", { name: "Save" }).click();

  await expect(page.getByText("House 4417, Tower C, Sector 65, Gurgaon 122018")).toBeVisible();
  await expect(page.getByText("Gate code 4417 · park in visitor bay B")).toBeVisible();
  await expect(page.getByRole("button", { name: "Edit address and access notes" })).toBeVisible();

  // Home's consultation card now shows the address.
  await page.getByRole("link", { name: "Back" }).click();
  await expect(page.getByText("Sector 65, Gurgaon 122018")).toBeVisible();
});

test("refuses an address without a six-digit pincode", async ({ page, request }) => {
  await loggedIn(page, request);
  await page.getByRole("button", { name: "Add your address and access notes" }).click();
  await page.getByLabel("House, flat or building").fill("House 1");
  await page.getByLabel("Sector or area").fill("Sector 65");
  await page.getByLabel("City").fill("Gurgaon");
  await page.getByLabel("Pincode").fill("1220");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("alert")).toHaveText("Fill in the house, the area, the city and a six-digit pincode.");
});

test("lists the five consents off, and switches one on with its date and off again", async ({ page, request }) => {
  await loggedIn(page, request);
  const switches = page.getByRole("switch");
  await expect(switches).toHaveCount(5);
  for (const name of [
    "Photographs for your own record",
    "Photographs on referral cards",
    "Photographs in our marketing",
    "WhatsApp about your visits",
    "WhatsApp about launches",
  ]) {
    await expect(page.getByRole("switch", { name })).toHaveAttribute("aria-checked", "false");
  }

  const visits = page.getByRole("switch", { name: "WhatsApp about your visits" });
  await visits.click();
  await expect(visits).toHaveAttribute("aria-checked", "true");
  await expect(page.getByText(/^Given \d{1,2} [A-Z][a-z]{2} \d{4}$/)).toBeVisible();
  await page.reload();
  await expect(page.getByRole("switch", { name: "WhatsApp about your visits" })).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await page.getByRole("switch", { name: "WhatsApp about your visits" }).click();
  await expect(page.getByRole("switch", { name: "WhatsApp about your visits" })).toHaveAttribute(
    "aria-checked",
    "false",
  );
});

test("shows the referral card's four lines before that consent can be switched on", async ({ page, request }) => {
  await loggedIn(page, request);
  const cards = page.getByRole("switch", { name: "Photographs on referral cards" });
  await cards.click();
  await expect(page.getByText("Anyone you send this card to can see your photographs.")).toBeVisible();
  await expect(
    page.getByText("Cards already delivered stay in people’s chats. We cannot take those back."),
  ).toBeVisible();
  await page.getByRole("button", { name: "Keep it off" }).click();
  await expect(cards).toHaveAttribute("aria-checked", "false");

  await cards.click();
  await page.getByRole("button", { name: "Switch on" }).click();
  await expect(cards).toHaveAttribute("aria-checked", "true");
});

test("changes the number: a code to each, then it waits for us", async ({ page, request }) => {
  await loggedIn(page, request);
  await page.getByRole("textbox", { name: "New number" }).fill(randomMobile());
  await page.getByRole("button", { name: "Start the change" }).click();
  await expect(page.getByText("Enter the code sent to each number.")).toBeVisible();
  await page.getByLabel("Code sent to your current number").fill(CODE);
  await page.getByLabel(/^Code sent to \+91 /).fill(CODE);
  await page.getByRole("button", { name: "Check the codes" }).click();
  await expect(
    page.getByText(/^We will confirm the change to \+91 \d{2}xxx x\d{4} with you, then it takes effect\.$/),
  ).toBeVisible();
});

test("refuses the client's own number as the new one", async ({ page, request }) => {
  const mobile = await loggedIn(page, request);
  await page.getByRole("textbox", { name: "New number" }).fill(mobile);
  await page.getByRole("button", { name: "Start the change" }).click();
  await expect(page.getByRole("alert")).toHaveText("Enter a ten-digit mobile number, not the one you use now.");
});

test("offers support on WhatsApp, with the design's line", async ({ page, request }) => {
  await loggedIn(page, request);
  await expect(page.getByRole("link", { name: "Message us on WhatsApp" })).toHaveAttribute(
    "href",
    "https://wa.me/919007973247",
  );
  await expect(page.getByText("Replies within a working day. Everything in writing.")).toBeVisible();
});

test("asks before requesting deletion, then says it is requested", async ({ page, request }) => {
  await loggedIn(page, request);
  await expect(
    page.getByText("Photographs deleted within seven days. Invoices kept eight years, by law."),
  ).toBeVisible();
  await page.getByRole("button", { name: "Request deletion" }).click();
  await page.getByRole("button", { name: "Keep my account" }).click();
  await expect(page.getByRole("button", { name: "Request deletion" })).toBeVisible();

  await page.getByRole("button", { name: "Request deletion" }).click();
  await page.getByRole("button", { name: "Yes, request deletion" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Deletion requested" })).toHaveText(
    /^Deletion requested on \d{1,2} [A-Z][a-z]{2} \d{4}\. We will confirm on WhatsApp\.$/,
  );
});

test("logs out from the foot of the profile", async ({ page, request }) => {
  await loggedIn(page, request);
  await page.getByRole("button", { name: "Log out" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Your mobile number" })).toBeVisible();
});

test("meets WCAG 2.2 AA, with the address form and the card's lines open", async ({ page, request }) => {
  await loggedIn(page, request);
  const scan = async () => {
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
      .analyze();
    expect(results.violations.map((violation) => violation.id)).toEqual([]);
  };
  await scan();
  await page.getByRole("button", { name: "Add your address and access notes" }).click();
  await page.getByRole("switch", { name: "Photographs on referral cards" }).click();
  await scan();
});
