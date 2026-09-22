// The client app's read surfaces for a fitted client (P2-F2): Home B1, Visits
// C1 and C9, Photos D1 to D3, and Payments E1 to E3, against the local mm-api
// with the client in its mirrors (e2e/app/fitted.ts). The tests share the
// client, and only read.

import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { fullDate, shortDate } from "../../packages/web-kit/dates.ts";
import { expect, test } from "../support.ts";
import { fittedClient } from "./fitted.ts";
import { logIn } from "./signed-in.ts";

const tab = (page: Page, name: string) => page.getByRole("navigation").getByRole("link", { name });

test("Home shows a fitted client's next visit, with the technician, and WhatsApp to move it", async ({ page }) => {
  const client = fittedClient();
  await logIn(page, client.mobile);
  await expect(page.getByRole("heading", { level: 1, name: "Your next visit" })).toBeVisible();
  await expect(page.getByText(shortDate(client.next.date))).toBeVisible();
  await expect(page.getByText("Afternoon, 12 to 4 pm")).toBeVisible();
  await expect(page.getByText("Imran", { exact: true })).toBeVisible();
  await expect(page.getByText("Service visit · 90 minutes")).toBeVisible();
  await expect(page.getByText("Gurgaon 122018")).toBeVisible();
  await expect(page.getByRole("link", { name: "Reschedule" })).toHaveAttribute(
    "href",
    new RegExp(`^https://wa\\.me/\\d+\\?text=${encodeURIComponent("I would like to move my service visit on")}`),
  );
});

test("Visits lists what is coming and what is done, and a past visit opens with its photographs", async ({ page }) => {
  const client = fittedClient();
  await logIn(page, client.mobile);
  await tab(page, "Visits").click();
  await expect(page.getByRole("heading", { level: 1, name: "Visits" })).toBeVisible();
  await expect(page.getByText("Service visit · 12 to 4 pm · Imran")).toBeVisible();
  // Self-serve booking is on locally: the footer opens the booking sheet (e2e/app/booking.e2e.ts).
  await expect(page.getByRole("button", { name: "Book your next visit" })).toBeVisible();

  const past = page.getByRole("main").getByRole("link");
  await expect(past).toHaveCount(2);
  await expect(past.nth(0)).toContainText(`${fullDate(client.service.date)}Service visit · Imran`);
  await expect(past.nth(1)).toContainText(`${fullDate(client.firstFit.date)}First fit · Imran`);

  await past.nth(0).click();
  await expect(page.getByRole("heading", { level: 1, name: fullDate(client.service.date) })).toBeVisible();
  await expect(page.getByText("Imran Qureshi")).toBeVisible();
  await expect(page.getByText("1 h 25 m")).toBeVisible();
  const front = page.getByRole("button", { name: `Front, after the visit, ${fullDate(client.service.date)}` });
  await expect.poll(() => front.locator("img").evaluate((image: HTMLImageElement) => image.naturalWidth)).toBe(600);
  await page.getByRole("link", { name: "Back to visits" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Visits" })).toBeVisible();
});

test("Photos: the timeline, a photograph saved to the phone, and the compare", async ({ page }) => {
  const client = fittedClient();
  await logIn(page, client.mobile);
  await tab(page, "Photos").click();
  await expect(page.getByRole("heading", { level: 2, name: fullDate(client.service.date) })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: fullDate(client.firstFit.date) })).toBeVisible();

  await page.getByRole("button", { name: `Front, after the visit, ${fullDate(client.service.date)}` }).click();
  const sheet = page.getByRole("dialog", { name: `Front · ${fullDate(client.service.date)}` });
  await expect(sheet.getByText("Downloaded photographs sit in your gallery, outside the app.")).toBeVisible();
  const download = page.waitForEvent("download");
  await sheet.getByRole("link", { name: "Download" }).click();
  expect((await download).suggestedFilename()).toBe(`mane-man-${client.service.date}-after-front.jpg`);
  await sheet.getByRole("button", { name: "Close" }).click();
  await expect(sheet).toBeHidden();

  await page.getByRole("link", { name: "Compare" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Compare" })).toBeVisible();
  await expect(page.getByRole("navigation")).toHaveCount(0);
  await expect(page.getByLabel("From", { exact: true })).toHaveValue(client.firstFit.id);
  await expect(page.getByLabel("To", { exact: true })).toHaveValue(client.service.id);

  const divider = page.getByRole("slider", { name: "Divider between the two photographs" });
  await expect(divider).toHaveAttribute("aria-valuenow", "50");
  await divider.press("ArrowLeft");
  await expect(divider).toHaveAttribute("aria-valuenow", "48");
  await divider.press("End");
  await expect(divider).toHaveAttribute("aria-valuenow", "100");

  // The divider follows the finger, with no snap: dragged a quarter of the way across, it stays there.
  const box = await divider.locator("..").boundingBox();
  if (box === null) throw new Error("the compare has no stage");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 4, box.y + box.height / 2, { steps: 5 });
  await page.mouse.up();
  await expect(divider).toHaveAttribute("aria-valuenow", "25");

  // The first fit has no hairline photograph: its side stays empty.
  await page.getByRole("button", { name: "Hairline" }).click();
  await expect(page.getByRole("button", { name: "Hairline" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByAltText(`Hairline, after the visit, ${fullDate(client.service.date)}`)).toBeVisible();
  await expect(page.getByAltText(`Hairline, after the visit, ${fullDate(client.firstFit.date)}`)).toHaveCount(0);
});

test("Payments: one list of payments and refunds, an entry's invoice, and a document not ready", async ({ page }) => {
  const client = fittedClient();
  await logIn(page, client.mobile);
  await tab(page, "Payments").click();
  const entries = page.getByRole("main").getByRole("link");
  await expect(entries).toHaveCount(3);
  await expect(entries.nth(0)).toContainText("refund to UPI");
  await expect(entries.nth(0)).toContainText("Refund processing");
  await expect(entries.nth(1)).toContainText("Rs. 2,000");
  await expect(entries.nth(1)).toContainText("Rs. 2,100 incl.");
  await expect(entries.nth(1)).toContainText("Paid");
  await expect(entries.nth(2)).toContainText("First fit");
  await expect(entries.nth(2)).toContainText("Rs. 30,000");

  await entries.nth(1).click();
  await expect(page.getByRole("heading", { level: 1, name: "Service visit" })).toBeVisible();
  await expect(page.getByText("Rs. 2,100 including GST at 5%")).toBeVisible();
  await expect(page.getByText(client.reference)).toBeVisible();
  const invoice = page.getByRole("link", { name: "Tax invoice" });
  await expect(invoice).toHaveAttribute("href", `/api/documents/${client.service.id}`);
  // Fetched by the page, whose app.localhost only the browser resolves.
  const served = await page.evaluate(
    async (path) => (await fetch(path)).headers.get("Content-Type"),
    `/api/documents/${client.service.id}`,
  );
  expect(served).toBe("application/pdf");

  await page.getByRole("button", { name: "Receipt" }).click();
  await expect(page.getByText("The receipt is not ready yet.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Notify me" })).toHaveAttribute(
    "href",
    new RegExp(encodeURIComponent(`Please send me the receipt for ${client.reference}.`)),
  );

  await page.getByRole("link", { name: "Back to payments" }).click();
  await entries.nth(0).click();
  await expect(page.getByRole("heading", { level: 1, name: "Service visit · refund" })).toBeVisible();
  await expect(page.getByText("Refund processing · 5 to 7 working days")).toBeVisible();
  await expect(page.getByText("Rs. 1,000", { exact: true })).toBeVisible();
});

test("each read surface meets WCAG 2.2 AA", async ({ page }) => {
  const client = fittedClient();
  const scan = async () => {
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
      .analyze();
    expect(results.violations.map((violation) => violation.id)).toEqual([]);
  };
  await logIn(page, client.mobile);
  await expect(page.getByRole("heading", { name: "Your next visit" })).toBeVisible();
  await scan();
  await tab(page, "Visits").click();
  await expect(page.getByText("Service visit · 12 to 4 pm · Imran")).toBeVisible();
  await scan();
  await page.goto(`/visits/${client.service.id}`);
  await expect(page.getByText("Imran Qureshi")).toBeVisible();
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
  await page.getByRole("main").getByRole("link").nth(1).click();
  await page.getByRole("button", { name: "Receipt" }).click();
  await expect(page.getByText("Notify me")).toBeVisible();
  await scan();
});
