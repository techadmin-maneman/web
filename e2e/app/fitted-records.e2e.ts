import type { Locator, Page } from "@playwright/test";
import { fullDate } from "../../packages/web-kit/dates.ts";
import { WINDOW_TIMES, windowSpan } from "../../src/config/scheduling.ts";
import { assertInContract } from "../contract.ts";
import { expect, test } from "../support.ts";
import { axeViolations } from "../a11y.ts";
import { fittedClient } from "./fitted.ts";
import { logIn } from "./signed-in.ts";
import { tab } from "./fitted-fixtures.ts";
import * as appCopy from "../../apps/app/src/content.ts";

/**
 * Taps a document and answers the name of the file the tab it opened was given. Headless Chromium has no PDF viewer,
 * so the tab saves the file rather than showing it; a phone shows it.
 */
async function opensTheFile(page: Page, document: Locator): Promise<string> {
  const opened = page.waitForEvent("popup");
  await document.click();
  const tab = await opened;
  const saved = await tab.waitForEvent("download");
  await tab.close();
  return saved.suggestedFilename();
}

// The invoice appears beside the visit, and a free visit says so
// rather than promising a document that will never come (ADR 0056).
test("a past visit carries its own invoice, or says why there is none", async ({ page }) => {
  const client = fittedClient();
  await logIn(page, client.mobile);
  await expect(page.getByRole("heading", { level: 1, name: "Your next visit" })).toBeVisible();

  await page.goto(`/visits/${client.service.id}`);
  // The whole accessible name, so a screen reader is told the document leaves the app.
  const invoice = page.getByRole("button", { name: "Tax invoice PDF, opens in a new tab", exact: true });
  await expect(invoice).toBeVisible();
  // It opens in a tab of its own once the API has given the file (apps/app/src/lib/documents.ts).
  expect(await opensTheFile(page, invoice)).toMatch(/\.pdf$/);

  // The first fit is billed, and its invoice has not been raised in the sixty days since: "within the hour" is
  // no longer true of it, so the client is told it is late and how to ask for it.
  await page.goto(`/visits/${client.firstFit.id}`);
  await expect(page.getByText(appCopy.visits.detail.invoice.late)).toBeVisible();
  await expect(page.getByRole("link", { name: "Message us" })).toHaveAttribute(
    "href",
    new RegExp(encodeURIComponent("Please send me the invoice for my first fit on")),
  );
  await expect(page.getByRole("link", { name: "Tax invoice" })).toHaveCount(0);

  // The consultation was free, so no invoice will ever exist.
  await page.goto(`/visits/${client.consultation.id}`);
  await expect(page.getByText(appCopy.visits.detail.invoice.free)).toBeVisible();
});

test("a visit to come offers itself to the client’s calendar, at its window; one done does not", async ({ page }) => {
  const client = fittedClient();
  await logIn(page, client.mobile);
  await expect(page.getByRole("heading", { level: 1, name: "Your next visit" })).toBeVisible();
  await page.goto(`/visits/${client.next.id}`);
  const google = new URL((await page.getByRole("link", { name: appCopy.calendar.google }).getAttribute("href")) ?? "");
  const { start, end } = windowSpan(client.next.date, WINDOW_TIMES.afternoon);
  const stamp = (instant: Date) => instant.toISOString().replace(/[-:]|\.\d{3}/g, "");
  expect(Object.fromEntries(google.searchParams)).toMatchObject({
    text: "Mane Man: Service visit",
    dates: `${stamp(start)}/${stamp(end)}`,
    details: "Arriving 12–4 pm, with Imran.",
  });
  const file = page.getByRole("link", { name: appCopy.calendar.file });
  const ics = decodeURIComponent((await file.getAttribute("href"))?.split(",")[1] ?? "");
  expect(ics).toContain(`UID:${client.next.id}@maneman.in`);

  await page.goto(`/visits/${client.service.id}`);
  await expect(page.getByRole("button", { name: "Tax invoice PDF, opens in a new tab", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: appCopy.calendar.google })).toHaveCount(0);
});

test("Photos: the timeline, a photograph saved to the phone, and the compare", async ({ page }) => {
  const client = fittedClient();
  await logIn(page, client.mobile);
  await tab(page, "Photos").click();
  await expect(page.getByText(appCopy.photos.basis, { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: fullDate(client.service.date) })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: fullDate(client.firstFit.date) })).toBeVisible();

  // A row shows the small copy the technician's phone made, and a photograph with none, as from FSM, shows itself.
  const cell = (angle: string) =>
    page.getByRole("button", { name: `${angle}, after the visit, ${fullDate(client.service.date)}` }).locator("img");
  await expect(cell("Front")).toHaveAttribute("src", /\/api\/photos\/small\//);
  await expect(cell("Hair")).toHaveAttribute("src", /\/api\/photos\/file\//);
  await expect.poll(() => cell("Front").evaluate((image: HTMLImageElement) => image.naturalWidth)).toBe(300);

  await page.getByRole("button", { name: `Front, after the visit, ${fullDate(client.service.date)}` }).click();
  const sheet = page.getByRole("dialog", { name: `Front · ${fullDate(client.service.date)}` });
  // Opened, it is the whole photograph.
  await expect(sheet.locator("img")).toHaveAttribute("src", /\/api\/photos\/file\//);
  await expect.poll(() => sheet.locator("img").evaluate((image: HTMLImageElement) => image.naturalWidth)).toBe(600);
  await expect(sheet.getByText(appCopy.photos.downloaded)).toBeVisible();
  const download = page.waitForEvent("download");
  await sheet.getByRole("link", { name: appCopy.photos.download }).click();
  expect((await download).suggestedFilename()).toBe(`mane-man-${client.service.date}-after-front.jpg`);
  await sheet.getByRole("button", { name: "Close" }).click();
  await expect(sheet).toBeHidden();

  await page.getByRole("link", { name: "Compare" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Compare" })).toBeVisible();
  await expect(page.getByRole("navigation")).toHaveCount(0);
  await expect(page.getByLabel(appCopy.photos.from, { exact: true })).toHaveValue(client.firstFit.id);
  await expect(page.getByLabel("To", { exact: true })).toHaveValue(client.service.id);

  const divider = page.getByRole("slider", { name: appCopy.photos.divider });
  await expect(divider).toHaveValue("50");
  await divider.press("ArrowLeft");
  await expect(divider).toHaveValue("49");
  await divider.press("End");
  await expect(divider).toHaveValue("100");

  // The divider follows the finger: dragged a quarter of the way across, it stays there, give or take the handle.
  const box = await divider.locator("..").boundingBox();
  if (box === null) throw new Error("the compare has no stage");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 4, box.y + box.height / 2, { steps: 5 });
  await page.mouse.up();
  await expect.poll(async () => Math.abs(Number(await divider.inputValue()) - 25)).toBeLessThanOrEqual(2);

  // The first fit has no hairline photograph: its side stays empty.
  await page.getByRole("button", { name: appCopy.photos.compareAngles.hair }).click();
  await expect(page.getByRole("button", { name: appCopy.photos.compareAngles.hair })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.getByAltText(`Hairline, after the visit, ${fullDate(client.service.date)}`)).toBeVisible();
  await expect(page.getByAltText(`Hairline, after the visit, ${fullDate(client.firstFit.date)}`)).toHaveCount(0);
});

// A photograph's link lasts 15 minutes, and a page left open past them is read again rather than left blank.
test("a photograph whose link has run out is shown again through a fresh one", async ({ page }) => {
  const client = fittedClient();
  let refused = 0;
  // The first small copy asked for answers as a link that has run out does.
  await page.route("**/api/photos/small/**", async (route) => {
    if (refused > 0) return route.continue();
    refused += 1;
    return route.fulfill({ status: 403, body: "" });
  });
  let timelines = 0;
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/photos") timelines += 1;
  });
  await logIn(page, client.mobile);
  await tab(page, "Photos").click();

  const front = page
    .getByRole("button", { name: `Front, after the visit, ${fullDate(client.service.date)}` })
    .locator("img");
  await expect.poll(() => front.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBe(300);
  await expect(page.getByText(appCopy.photos.reload)).toHaveCount(0);
  expect(refused).toBe(1);
  expect(timelines).toBeGreaterThanOrEqual(2);
});

test("Payments: one list of payments and refunds, an entry’s documents, and a document not ready", async ({ page }) => {
  const client = fittedClient();
  await logIn(page, client.mobile);
  await tab(page, "Payments").click();
  const entries = page.getByRole("main").getByRole("link");
  await expect(entries).toHaveCount(3);
  // A refund is titled a refund and reads as money coming back, never as a second charge.
  await expect(entries.nth(0)).toContainText(appCopy.payments.refund);
  await expect(entries.nth(0)).toContainText(appCopy.VISIT_TYPES.service);
  await expect(entries.nth(0)).toContainText("+ Rs. 1,000");
  await expect(entries.nth(0)).toContainText("back to your UPI");
  await expect(entries.nth(0)).toContainText(appCopy.payments.status.created);
  await expect(entries.nth(1)).toContainText(appCopy.VISIT_TYPES.service);
  await expect(entries.nth(1)).toContainText("Rs. 2,000");
  await expect(entries.nth(1)).not.toContainText("incl.");
  await expect(entries.nth(1)).toContainText("Paid");
  await expect(entries.nth(2)).toContainText("First fit");
  await expect(entries.nth(2)).toContainText("Rs. 30,000");

  await entries.nth(1).click();
  await expect(page.getByRole("heading", { level: 1, name: "Service visit" })).toBeVisible();
  await expect(page.getByText("Rs. 2,000", { exact: true })).toBeVisible();
  // No rate was recorded for this payment, so nothing is said of GST at all.
  await expect(page.getByText(/GST at/)).toHaveCount(0);
  await expect(page.getByText(client.reference)).toBeVisible();
  for (const name of ["Tax invoice", "Receipt"]) {
    const document = page.getByRole("button", { name: `${name} PDF, opens in a new tab`, exact: true });
    expect(await opensTheFile(page, document)).toMatch(/\.pdf$/);
  }

  await page.getByRole("link", { name: appCopy.payments.back }).click();
  await entries.nth(2).click();
  await expect(page.getByRole("heading", { level: 1, name: "First fit" })).toBeVisible();
  // Sixty days after the fit, its invoice is late rather than "usually ready within the hour".
  await page.getByRole("button", { name: "Tax invoice" }).click();
  await expect(page.getByText(appCopy.payments.unavailable.invoiceLate)).toBeVisible();
  await page.getByRole("button", { name: appCopy.payments.receipt }).click();
  const receipt = page.getByRole("status").filter({ hasText: appCopy.payments.unavailable.receipt });
  await expect(receipt).toBeVisible();
  await expect(receipt.getByRole("link", { name: appCopy.payments.unavailable.notify })).toHaveAttribute(
    "href",
    new RegExp(encodeURIComponent(`Please send me the receipt for first fit on ${fullDate(client.firstFit.date)}.`)),
  );

  await page.getByRole("link", { name: appCopy.payments.back }).click();
  await entries.nth(0).click();
  await expect(page.getByRole("heading", { level: 1, name: "Refund", exact: true })).toBeVisible();
  // Begun eighteen days ago, it is past Razorpay's 5 to 7 working days, and the client is told so.
  await expect(page.getByText(appCopy.payments.lateRefund)).toBeVisible();
  await expect(page.getByRole("link", { name: "Message us" })).toHaveAttribute(
    "href",
    new RegExp(encodeURIComponent("My refund for my service visit on")),
  );
  await expect(page.getByText("+ Rs. 1,000", { exact: true })).toBeVisible();
});

// After paying, the entry did not say the code the visit was booked with. No route puts a code on the seeded
// payment, so its entry is answered with one, held to the API's contract.
test("a payment made with a discount code names the code, and what it took off", async ({ page }) => {
  const client = fittedClient();
  await logIn(page, client.mobile);
  await expect(page.getByRole("heading", { level: 1, name: "Your next visit" })).toBeVisible();
  const path = `/api/payments/${client.servicePayment}`;
  // Read by the page, whose app.localhost only the browser resolves.
  const entry = await page.evaluate(async (url) => (await fetch(url)).json() as Promise<object>, path);
  const body = { ...entry, discount_code: { code: "AUDTEST", amount_off: 100_000 } };
  assertInContract("client", "GET", path, 200, body);
  await page.route(`**${path}`, (route) => route.fulfill({ json: body }));
  await page.goto(`/payments/${client.servicePayment}`);
  await expect(page.getByRole("heading", { level: 1, name: "Service visit" })).toBeVisible();
  await expect(page.getByText("AUDTEST: Rs. 1,000 off")).toBeVisible();
});

test("each read surface meets WCAG 2.2 AA", async ({ page }) => {
  const client = fittedClient();
  const scan = async () => {
    expect(await axeViolations(page)).toEqual([]);
  };
  await logIn(page, client.mobile);
  await expect(page.getByRole("heading", { name: appCopy.home.next.label })).toBeVisible();
  await scan();
  await tab(page, "Visits").click();
  await expect(page.getByText("Service visit · 12–4 pm · Imran")).toBeVisible();
  await scan();
  await page.goto(`/visits/${client.service.id}`);
  await expect(page.getByRole("button", { name: "Tax invoice PDF, opens in a new tab", exact: true })).toBeVisible();
  await scan();
  // The same screen with no invoice to open, which reads as a line rather than a link.
  await page.goto(`/visits/${client.consultation.id}`);
  await expect(page.getByText(appCopy.visits.detail.invoice.free)).toBeVisible();
  await scan();
  // The visit still to come, drawn as Home's card.
  await page.goto(`/visits/${client.next.id}`);
  await expect(page.getByRole("button", { name: appCopy.home.reschedule })).toBeVisible();
  await scan();
  await tab(page, "Photos").click();
  await page.getByRole("button", { name: `Front, after the visit, ${fullDate(client.service.date)}` }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await scan();
  await page.goto("/photos/compare");
  await expect(page.getByRole("slider")).toBeVisible();
  await scan();
  await page.goto("/payments");
  await expect(page.getByRole("main").getByRole("link")).toHaveCount(3);
  await scan();
  // The first fit's payment, whose receipt Books has not issued yet.
  await page.getByRole("main").getByRole("link").nth(2).click();
  await page.getByRole("button", { name: appCopy.payments.receipt }).click();
  await expect(page.getByText(appCopy.payments.unavailable.notify)).toBeVisible();
  await scan();
});
