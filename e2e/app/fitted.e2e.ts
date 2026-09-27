// The client app's read surfaces for a fitted client (P2-F2): Home B1, Visits
// C1 and C9, Photos D1 to D3, and Payments E1 to E3, against the local mm-api
// with the client in its mirrors (e2e/app/fitted.ts). The tests share the
// client, and only read.

import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { fullDate, listMonth, shortDate } from "../../packages/web-kit/dates.ts";
import { expect, test } from "../support.ts";
import { fittedClient } from "./fitted.ts";
import { logIn } from "./signed-in.ts";

const tab = (page: Page, name: string) => page.getByRole("navigation").getByRole("link", { name });

test("Home shows a fitted client's next visit, with the technician, and Reschedule", async ({ page }) => {
  const client = fittedClient();
  await logIn(page, client.mobile);
  await expect(page.getByRole("heading", { level: 1, name: "Your next visit" })).toBeVisible();
  await expect(page.getByText(shortDate(client.next.date))).toBeVisible();
  await expect(page.getByText("Afternoon, 12 to 4 pm")).toBeVisible();
  await expect(page.getByText("Imran", { exact: true })).toBeVisible();
  await expect(page.getByText("Service visit · 90 minutes")).toBeVisible();
  await expect(page.getByText("Gurgaon 122018")).toBeVisible();
  // Board B1's one prompt: this client has given no address, which comes before the replacement falling due.
  await expect(page.getByText("Add your address, so your technician can find the door.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Add your address" })).toHaveAttribute("href", "/profile");
  // Self-serve booking is on locally, so Reschedule opens the move sheet (C7). This visit has no work order in
  // FSM, so the sheet sends the client to ops on WhatsApp instead.
  await page.getByRole("button", { name: "Reschedule" }).click();
  const sheet = page.getByRole("dialog", { name: "This visit can no longer be changed here." });
  await expect(sheet.getByRole("link", { name: "Message us" })).toHaveAttribute(
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

  // Every visit opens its own page: the one coming, then the three done.
  const visits = page.getByRole("main").getByRole("link");
  await expect(visits).toHaveCount(4);
  await expect(visits.nth(0)).toContainText("Service visit · 12 to 4 pm · Imran");
  await expect(visits.nth(1)).toContainText(`${fullDate(client.service.date)}Service visit · Imran`);
  await expect(visits.nth(2)).toContainText(`${fullDate(client.firstFit.date)}First fit · Imran`);
  await expect(visits.nth(3)).toContainText(`${fullDate(client.consultation.date)}Consultation · Imran`);

  await visits.nth(1).click();
  await expect(page.getByRole("heading", { level: 1, name: fullDate(client.service.date) })).toBeVisible();
  await expect(page.getByText("Imran Qureshi")).toBeVisible();
  await expect(page.getByText("1 h 25 m")).toBeVisible();
  // Board C9's "What was done": the checklist the technician ticked, from his phone.
  await expect(page.getByRole("term").filter({ hasText: "What was done" }).locator("+ dd")).toHaveText(
    "PLACEHOLDER Piece removed, PLACEHOLDER Scalp cleaned, PLACEHOLDER Piece cleaned.",
  );
  const front = page.getByRole("button", { name: `Front, after the visit, ${fullDate(client.service.date)}` });
  await expect.poll(() => front.locator("img").evaluate((image: HTMLImageElement) => image.naturalWidth)).toBe(600);
  await page.getByRole("link", { name: "Back to visits" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Visits" })).toBeVisible();

  // The visit coming opens too, as Home's card, with the ways to change it (CLI-26).
  await visits.nth(0).click();
  await expect(page.getByRole("heading", { level: 1, name: fullDate(client.next.date) })).toBeVisible();
  await expect(page.getByText("Afternoon, 12 to 4 pm")).toBeVisible();
  await expect(page.getByRole("button", { name: "Reschedule" })).toBeVisible();

  // With self-serve booking on, the note is kept on the visit for the technician, not sent to WhatsApp (REQ-04).
  await page.getByRole("button", { name: "Add a note" }).click();
  const sheet = page.getByRole("dialog");
  await sheet.getByRole("textbox", { name: "What should they know at the door?" }).fill("The lift is out");
  await sheet.getByRole("button", { name: "Save the note" }).click();
  await expect(sheet.getByRole("heading", { name: /^Saved\./ })).toBeVisible();
});

// A visit that is not this client's, or a payment, says so rather than offering to try again for ever (CLI-33).
test("a visit or a payment that is not the client's says it could not be found", async ({ page }) => {
  await logIn(page, fittedClient().mobile);
  await expect(page.getByRole("heading", { level: 1, name: "Your next visit" })).toBeVisible();
  const nobody = "00000000-0000-4000-8000-000000000000";
  await page.goto(`/visits/${nobody}`);
  await expect(page.getByRole("alert")).toContainText("We could not find this visit.");
  await expect(page.getByRole("button", { name: "Try again" })).toHaveCount(0);
  await page.getByRole("main").getByRole("link", { name: "Back to visits" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Visits" })).toBeVisible();
  await page.goto(`/payments/${nobody}`);
  await expect(page.getByRole("alert")).toContainText("We could not find this payment.");
});

// Home as the API gives it: a visit FSM has not closed stays, saying where it stands, and nothing is booked in its
// place (LIFE-03); the credit tile, and each prompt in its own words (LIFE-08). The API's answers are altered on
// their way, since the shared client has none of these.
test("Home keeps a visit being closed, and shows the credit tile and the prompt the API gives", async ({ page }) => {
  const client = fittedClient();
  await logIn(page, client.mobile);
  await expect(page.getByRole("heading", { level: 1, name: "Your next visit" })).toBeVisible();
  // Read by the page, whose app.localhost only the browser resolves.
  const read = (path: string) =>
    page.evaluate(async (url) => (await fetch(url)).json() as Promise<Record<string, unknown>>, path);
  const [me, visits] = [await read("/api/me"), await read("/api/visits")];
  let prompt: object = { kind: "replacement_due", month: client.piece.due.slice(0, 7) };
  await page.route("**/api/me", (route) =>
    route.fulfill({
      json: {
        ...me,
        next_visit: { ...(me.next_visit as object), stage: "closing" },
        credits: { visits: 2, earliest_expiry: "2028-01-03T00:00:00.000Z" },
        prompt,
      },
    }),
  );
  const upcoming = (visits.upcoming as object[]).map((visit) => ({ ...visit, stage: "closing" }));
  await page.route("**/api/visits", (route) => route.fulfill({ json: { ...visits, upcoming } }));
  await page.reload();
  await expect(page.getByText("Being closed")).toBeVisible();
  await expect(page.getByRole("button", { name: "Reschedule" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Add a note" })).toBeVisible();
  await expect(page.getByText("2 visit credits")).toBeVisible();
  await expect(page.getByText("Expire 3 Jan 2028")).toBeVisible();
  const month = listMonth(client.piece.due.slice(0, 7), new Date().getFullYear());
  await expect(page.getByText(`Your replacement piece is due in ${month}.`)).toBeVisible();
  await expect(page.getByRole("link", { name: "See what that involves" })).toHaveAttribute(
    "href",
    /^https:\/\/wa\.me\/\d+\?text=/,
  );
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(results.violations.map((violation) => violation.id)).toEqual([]);

  await tab(page, "Visits").click();
  await expect(page.getByText("Service visit · Being closed · Imran")).toBeVisible();
  await expect(page.getByRole("button", { name: "Book your next visit" })).toHaveCount(0);

  prompt = { kind: "invoice_ready", visit_id: client.service.id, date: client.service.date, type: "service" };
  await tab(page, "Home").click();
  await page.reload();
  await expect(
    page.getByText(`The invoice for your service visit on ${shortDate(client.service.date)} is ready.`),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: /^Open the invoice/ })).toHaveAttribute(
    "href",
    `/api/documents/${client.service.id}`,
  );
});

// The client's own record, above their visits: the owner's ruling of 24
// September 2026 that a client's history belongs in the app as well as the
// console. The replacement is a month and never a day, because the day is
// worked out afresh from FSM on every sync (ADR 0059).
test("Visits heads the client's own record with the month their replacement falls due", async ({ page }) => {
  const client = fittedClient();
  await logIn(page, client.mobile);
  await tab(page, "Visits").click();

  const record = page.getByRole("region", { name: "Your record" });
  const month = listMonth(client.piece.due.slice(0, 7), new Date().getFullYear());
  await expect(record.getByText(`Your replacement piece is due in ${month}.`)).toBeVisible();
  await expect(
    record.getByText("We give the month rather than a day, because the date can still change."),
  ).toBeVisible();
  // Never the day, however the month is written.
  await expect(record).not.toContainText(fullDate(client.piece.due));

  const fact = (label: string) =>
    record
      .getByRole("term")
      .filter({ hasText: new RegExp(`^${label}$`) })
      .locator("+ dd");
  await expect(fact("First fit")).toHaveText(fullDate(client.firstFit.date));
  await expect(fact("Service visits")).toHaveText("1");
  // A true nought, written as one: this client has bought no replacement.
  await expect(fact("Replacements")).toHaveText("0");
  await expect(fact("Total paid")).toContainText("Rs. 32,000");
});

// The owner's ruling of 23 September 2026: the invoice appears beside the visit, and a free visit says so
// rather than promising a document that will never come (ADR 0056).
test("a past visit carries its own invoice, or says why there is none", async ({ page }) => {
  const client = fittedClient();
  await logIn(page, client.mobile);
  await expect(page.getByRole("heading", { level: 1, name: "Your next visit" })).toBeVisible();

  await page.goto(`/visits/${client.service.id}`);
  const invoice = page.getByRole("link", { name: "Tax invoice" });
  await expect(invoice).toHaveAttribute("href", `/api/documents/${client.service.id}`);
  await expect(invoice).toHaveAttribute("target", "_blank");
  // The whole accessible name, so a screen reader is told the link leaves the app.
  await expect(invoice).toHaveAccessibleName("Tax invoice PDF, opens in a new tab");
  const served = await page.evaluate(
    async (url) => (await fetch(url)).headers.get("Content-Type"),
    `/api/documents/${client.service.id}`,
  );
  expect(served).toBe("application/pdf");

  // The first fit is billed, and its invoice has not been raised in the sixty days since: "within the hour" is
  // no longer true of it, so the client is told it is late and how to ask for it (CLI-25).
  await page.goto(`/visits/${client.firstFit.id}`);
  await expect(
    page.getByText("The invoice is taking longer than it should. Message us and we will send it."),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Message us" })).toHaveAttribute(
    "href",
    new RegExp(encodeURIComponent("Please send me the invoice for my first fit on")),
  );
  await expect(page.getByRole("link", { name: "Tax invoice" })).toHaveCount(0);

  // The consultation was free, so no invoice will ever exist.
  await page.goto(`/visits/${client.consultation.id}`);
  await expect(page.getByText("No charge for this visit, so there is no invoice.")).toBeVisible();
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

test("Payments: one list of payments and refunds, an entry's documents, and a document not ready", async ({ page }) => {
  const client = fittedClient();
  await logIn(page, client.mobile);
  await tab(page, "Payments").click();
  const entries = page.getByRole("main").getByRole("link");
  await expect(entries).toHaveCount(3);
  await expect(entries.nth(0)).toContainText("refund to UPI");
  await expect(entries.nth(0)).toContainText("Refund processing");
  await expect(entries.nth(1)).toContainText("Rs. 2,000");
  await expect(entries.nth(1)).toContainText("Rs. 2,000 incl.");
  await expect(entries.nth(1)).toContainText("Paid");
  await expect(entries.nth(2)).toContainText("First fit");
  await expect(entries.nth(2)).toContainText("Rs. 30,000");

  await entries.nth(1).click();
  await expect(page.getByRole("heading", { level: 1, name: "Service visit" })).toBeVisible();
  await expect(page.getByText("Rs. 2,000 including GST at 0%")).toBeVisible();
  await expect(page.getByText(client.reference)).toBeVisible();
  const documents = {
    "Tax invoice": `/api/documents/${client.service.id}`,
    Receipt: `/api/payments/${client.servicePayment}/receipt`,
  };
  for (const [name, path] of Object.entries(documents)) {
    await expect(page.getByRole("link", { name })).toHaveAttribute("href", path);
    // Fetched by the page, whose app.localhost only the browser resolves.
    const served = await page.evaluate(async (url) => (await fetch(url)).headers.get("Content-Type"), path);
    expect(served).toBe("application/pdf");
  }

  await page.getByRole("link", { name: "Back to payments" }).click();
  await entries.nth(2).click();
  await expect(page.getByRole("heading", { level: 1, name: "First fit" })).toBeVisible();
  // Sixty days after the fit, its invoice is late rather than "usually ready within the hour" (CLI-25).
  await page.getByRole("button", { name: "Tax invoice" }).click();
  await expect(page.getByText("The invoice is taking longer than it should.")).toBeVisible();
  await page.getByRole("button", { name: "Receipt" }).click();
  const receipt = page.getByRole("status").filter({ hasText: "The receipt is not ready yet." });
  await expect(receipt).toBeVisible();
  await expect(receipt.getByRole("link", { name: "Notify me" })).toHaveAttribute(
    "href",
    new RegExp(encodeURIComponent(`Please send me the receipt for first fit on ${fullDate(client.firstFit.date)}.`)),
  );

  await page.getByRole("link", { name: "Back to payments" }).click();
  await entries.nth(0).click();
  await expect(page.getByRole("heading", { level: 1, name: "Service visit · refund" })).toBeVisible();
  // Begun eighteen days ago, it is past Razorpay's 5 to 7 working days, and the client is told so (CLI-25).
  await expect(page.getByText("Refund processing · taking longer than it should")).toBeVisible();
  await expect(page.getByRole("link", { name: "Message us" })).toHaveAttribute(
    "href",
    new RegExp(encodeURIComponent("My refund for service visit from")),
  );
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
  await expect(page.getByRole("link", { name: "Tax invoice" })).toBeVisible();
  await scan();
  // The same screen with no invoice to open, which reads as a line rather than a link.
  await page.goto(`/visits/${client.consultation.id}`);
  await expect(page.getByText("No charge for this visit, so there is no invoice.")).toBeVisible();
  await scan();
  // The visit still to come, drawn as Home's card.
  await page.goto(`/visits/${client.next.id}`);
  await expect(page.getByRole("button", { name: "Reschedule" })).toBeVisible();
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
  await page.getByRole("button", { name: "Receipt" }).click();
  await expect(page.getByText("Notify me")).toBeVisible();
  await scan();
});
