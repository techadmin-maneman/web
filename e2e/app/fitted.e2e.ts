// The client app's read surfaces for a fitted client: Home B1, Visits
// C1 and C9, Photos D1 to D3, and Payments E1 to E3, against the local mm-api
// with the client in its mirrors (e2e/app/fitted.ts). The tests share the
// client, and only read.

import type { Page } from "@playwright/test";
import { fullDate, listMonth, shortDate } from "../../packages/web-kit/dates.ts";
import { assertInContract } from "../contract.ts";
import { expect, test } from "../support.ts";
import { axeViolations } from "../a11y.ts";
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
  await expect(page.getByText("Service visit · 1 hour 30 minutes")).toBeVisible();
  await expect(page.getByText("Gurgaon 122018")).toBeVisible();
  // Home's one prompt: this client has given no address, which comes before the replacement falling due.
  await expect(page.getByText("Add your address, so your technician can find the door.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Add your address" })).toHaveAttribute("href", "/profile");
  // Self-serve booking is on locally, so Reschedule opens the move sheet (C7; e2e/app/changes.e2e.ts moves one).
  await page.getByRole("button", { name: "Reschedule" }).click();
  await expect(page.getByRole("dialog", { name: /^Move \w+day’s visit$/ })).toBeVisible();
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
  // The visit's "What was done": the checklist the technician ticked, from their phone.
  await expect(page.getByRole("term").filter({ hasText: "What was done" }).locator("+ dd")).toHaveText(
    "Hair system removed, Scalp cleaned, Hair system cleaned.",
  );
  // The row shows the thumbnail the technician's phone made, not the whole photograph (ADR 0093).
  const front = page.getByRole("button", { name: `Front, after the visit, ${fullDate(client.service.date)}` });
  await expect.poll(() => front.locator("img").evaluate((image: HTMLImageElement) => image.naturalWidth)).toBe(300);
  await page.getByRole("link", { name: "Back to visits" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Visits" })).toBeVisible();

  // The visit coming opens too, as Home's card, with the ways to change it.
  await visits.nth(0).click();
  await expect(page.getByRole("heading", { level: 1, name: fullDate(client.next.date) })).toBeVisible();
  await expect(page.getByText("Afternoon, 12 to 4 pm")).toBeVisible();
  await expect(page.getByRole("button", { name: "Reschedule" })).toBeVisible();

  // With self-serve booking on, the note is kept on the visit for the technician, not sent to WhatsApp.
  await page.getByRole("button", { name: "Add a note" }).click();
  const sheet = page.getByRole("dialog");
  await sheet.getByRole("textbox", { name: "What should they know at the door?" }).fill("The lift is out");
  await sheet.getByRole("button", { name: "Save the note" }).click();
  await expect(sheet.getByRole("heading", { name: /^Saved\./ })).toBeVisible();

  // And shown back: on the card, and in the sheet when it opens again.
  await sheet.getByRole("button", { name: "Close" }).first().click();
  await expect(page.getByText("Your note: “The lift is out”")).toBeVisible();
  await page.getByRole("button", { name: "Add a note" }).click();
  await expect(page.getByRole("dialog").getByRole("heading", { name: /^Your note for / })).toBeVisible();
  await expect(page.getByRole("dialog").getByRole("textbox")).toHaveValue("The lift is out");
});

// A dropped signal unmounted the note sheet and its words, and Back left the page under it.
test("an open note sheet keeps its words through a dropped signal, and Back closes it on the page", async ({
  page,
}) => {
  const client = fittedClient();
  await logIn(page, client.mobile);
  await tab(page, "Visits").click();
  await expect(page.getByRole("heading", { level: 1, name: "Visits" })).toBeVisible();
  await page.getByRole("main").getByRole("link").first().click();
  const visitPage = page.getByRole("heading", { level: 1, name: fullDate(client.next.date) });
  await expect(visitPage).toBeVisible();

  await page.getByRole("button", { name: "Add a note" }).click();
  const sheet = page.getByRole("dialog");
  const note = sheet.getByRole("textbox", { name: "What should they know at the door?" });
  const save = sheet.getByRole("button", { name: "Save the note" });
  await note.fill("The lift is out");
  await page.context().setOffline(true);
  await expect(sheet.getByText("No connection. Your note stays here until you are back online.")).toBeVisible();
  await expect(note).toHaveValue("The lift is out");
  await expect(save).toBeDisabled();
  await page.context().setOffline(false);
  await expect(save).toBeEnabled();

  await page.goBack();
  await expect(sheet).toBeHidden();
  await expect(visitPage).toBeVisible();

  // Closed by its own button, the sheet leaves nothing behind in the history: Back goes to the list.
  await page.getByRole("button", { name: "Add a note" }).click();
  await sheet.getByRole("button", { name: "Close" }).click();
  await expect(sheet).toBeHidden();
  await expect.poll(() => page.evaluate(() => window.history.state as unknown)).toBeNull();
  await page.goBack();
  await expect(page.getByRole("heading", { level: 1, name: "Visits" })).toBeVisible();
});

// A visit that is not this client's, or a payment, says so rather than offering to try again for ever.
test("a visit or a payment that is not the client's says it could not be found", async ({ page }) => {
  await logIn(page, fittedClient().mobile);
  await expect(page.getByRole("heading", { level: 1, name: "Your next visit" })).toBeVisible();
  const nobody = "00000000-0000-4000-8000-000000000000";
  await page.goto(`/visits/${nobody}`);
  await expect(page.getByRole("alert")).toContainText("We couldn’t find this visit.");
  await expect(page.getByRole("button", { name: "Try again" })).toHaveCount(0);
  await page.getByRole("main").getByRole("link", { name: "Back to visits" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Visits" })).toBeVisible();
  await page.goto(`/payments/${nobody}`);
  await expect(page.getByRole("alert")).toContainText("We couldn’t find this payment.");
});

// Home as the API gives it: a visit FSM has not closed stays, saying where it stands, and nothing is booked in its
// place; the credit tile, and each prompt in its own words. The API's answers are altered on
// their way, since the shared client has none of these.
test("Home keeps a visit done but not yet closed, and shows the credit tile and the prompt the API gives", async ({
  page,
}) => {
  const client = fittedClient();
  await logIn(page, client.mobile);
  await expect(page.getByRole("heading", { level: 1, name: "Your next visit" })).toBeVisible();
  // Read by the page, whose app.localhost only the browser resolves.
  const read = (path: string) =>
    page.evaluate(async (url) => (await fetch(url)).json() as Promise<Record<string, unknown>>, path);
  const [me, visits] = [await read("/api/me"), await read("/api/visits")];
  let prompt: object = { kind: "replacement_due", month: client.piece.due.slice(0, 7), tier: null };
  let invoice: object | null = null;
  await page.route("**/api/me", (route) =>
    route.fulfill({
      json: {
        ...me,
        next_visit: { ...(me.next_visit as object), stage: "done" },
        credits: { visits: 2, earliest_expiry: "2028-01-03T00:00:00.000Z", expiring_visits: 1 },
        prompt,
        invoice,
      },
    }),
  );
  const upcoming = (visits.upcoming as object[]).map((visit) => ({ ...visit, stage: "done" }));
  await page.route("**/api/visits", (route) => route.fulfill({ json: { ...visits, upcoming } }));
  await page.reload();
  await expect(page.getByText("Done · notes on the way")).toBeVisible();
  await expect(page.getByRole("button", { name: "Reschedule" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Add a note" })).toHaveCount(0);
  await expect(page.getByText("2 free service visits")).toBeVisible();
  await expect(page.getByText("1 to use by 3 Jan 2028")).toBeVisible();
  const month = listMonth(client.piece.due.slice(0, 7), new Date().getFullYear());
  await expect(page.getByText(`Your replacement is due in ${month}.`)).toBeVisible();
  // The API prompts the replacement only once its month may be booked, so the prompt always offers it, beside the
  // app's own page on what a replacement involves.
  await expect(page.getByRole("link", { name: "See what that involves" })).toHaveAttribute("href", "/replacement");
  await expect(page.getByRole("button", { name: "Book the replacement" })).toBeVisible();
  expect(await axeViolations(page)).toEqual([]);

  await tab(page, "Visits").click();
  await expect(page.getByText("Service visit · Done · notes on the way · Imran")).toBeVisible();
  await expect(page.getByRole("button", { name: "Book your next visit" })).toHaveCount(0);

  // An invoice just issued is a line of its own, beneath whichever prompt leads.
  prompt = { kind: "address" };
  invoice = { visit_id: client.service.id, date: client.service.date, type: "service" };
  await tab(page, "Home").click();
  await page.reload();
  await expect(page.getByText("Add your address, so your technician can find the door.")).toBeVisible();
  await expect(
    page.getByText(`The invoice for your service visit on ${shortDate(client.service.date)} is ready.`),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: /^Open the invoice/ })).toHaveAttribute(
    "href",
    `/api/documents/${client.service.id}`,
  );
});

// The client's own record, above their visits: a client's history belongs in
// the app as well as the console. The replacement is a month and never a day, because the day is
// worked out afresh from FSM on every sync (ADR 0059).
test("Visits heads the client's own record with the month their replacement falls due", async ({ page }) => {
  const client = fittedClient();
  await logIn(page, client.mobile);
  await tab(page, "Visits").click();

  const record = page.getByRole("region", { name: "Your record" });
  const month = listMonth(client.piece.due.slice(0, 7), new Date().getFullYear());
  await expect(record.getByText(`Your replacement is due in ${month}.`)).toBeVisible();
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

// The invoice appears beside the visit, and a free visit says so
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
  // no longer true of it, so the client is told it is late and how to ask for it.
  await page.goto(`/visits/${client.firstFit.id}`);
  await expect(
    page.getByText("The invoice is taking longer than it should. Message us and we’ll send it."),
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
  await expect(page.getByText("Taken for your visit record.", { exact: true })).toBeVisible();
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
  await expect(sheet.getByText("Downloaded photos sit in your gallery, outside the app.")).toBeVisible();
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

  const divider = page.getByRole("slider", { name: "Divider between the two photos" });
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
  // A refund is titled a refund and reads as money coming back, never as a second charge.
  await expect(entries.nth(0)).toContainText("Refund");
  await expect(entries.nth(0)).toContainText("Service visit");
  await expect(entries.nth(0)).toContainText("+ Rs. 1,000");
  await expect(entries.nth(0)).toContainText("back to your UPI");
  await expect(entries.nth(0)).toContainText("Refund processing");
  await expect(entries.nth(1)).toContainText("Service visit");
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
  // Sixty days after the fit, its invoice is late rather than "usually ready within the hour".
  await page.getByRole("button", { name: "Tax invoice" }).click();
  await expect(page.getByText("The invoice is taking longer than it should.")).toBeVisible();
  await page.getByRole("button", { name: "Receipt" }).click();
  const receipt = page.getByRole("status").filter({ hasText: "The receipt isn’t ready yet." });
  await expect(receipt).toBeVisible();
  await expect(receipt.getByRole("link", { name: "Ask us for it" })).toHaveAttribute(
    "href",
    new RegExp(encodeURIComponent(`Please send me the receipt for first fit on ${fullDate(client.firstFit.date)}.`)),
  );

  await page.getByRole("link", { name: "Back to payments" }).click();
  await entries.nth(0).click();
  await expect(page.getByRole("heading", { level: 1, name: "Refund", exact: true })).toBeVisible();
  // Begun eighteen days ago, it is past Razorpay's 5 to 7 working days, and the client is told so.
  await expect(page.getByText("Refund processing · taking longer than it should")).toBeVisible();
  await expect(page.getByRole("link", { name: "Message us" })).toHaveAttribute(
    "href",
    new RegExp(encodeURIComponent("My refund for service visit from")),
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
  await expect(page.getByText("Ask us for it")).toBeVisible();
  await scan();
});

// A visit paid for that FSM has not taken yet, as while FSM refuses it and it waits for ops
// (docs/decisions/0095-a-booking-fsm-refuses-is-held.md): Home neither says it is booked nor that the money is gone,
// and offers nothing to book in its place. The API's answer is altered on its way, as FSM refuses nothing locally.
test("Home says a paid visit FSM has not taken yet is being booked, with the payment in", async ({ page }) => {
  const client = fittedClient();
  await logIn(page, client.mobile);
  await expect(page.getByRole("heading", { level: 1, name: "Your next visit" })).toBeVisible();
  const me = await page.evaluate(async () => (await fetch("/api/me")).json() as Promise<Record<string, unknown>>);
  const waiting = { type: "service", date: "2027-09-25", window: "morning", paid: true, one_visit: null, told: true };
  await page.route("**/api/me", (route) =>
    route.fulfill({ json: { ...me, next_visit: null, prompt: null, being_booked: waiting } }),
  );
  await page.reload();

  const card = page.getByRole("region", { name: "Your next visit" });
  await expect(card).toContainText(shortDate("2027-09-25"));
  await expect(card).toContainText("Morning, 9 am to 12 pm");
  await expect(card).toContainText("Service visit");
  await expect(card).toContainText("Your payment is in. We are booking your visit.");
  await expect(card).toContainText("We’ll message you on WhatsApp when it’s booked.");
  await expect(page.getByRole("button", { name: "Reschedule" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Book your next visit" })).toHaveCount(0);
  expect(await axeViolations(page)).toEqual([]);
});

// While FSM held a booking, Home said it was being booked and Visits said "Nothing booked yet.". A
// consultation and fit booked on /book read "We are booking your visit" while the site had said it was booked. Both
// answers are altered on their way, as above.
test("Visits lists a visit FSM has not taken yet as Home says it, a consultation and fit as booked", async ({
  page,
}) => {
  const client = fittedClient();
  await logIn(page, client.mobile);
  await expect(page.getByRole("heading", { level: 1, name: "Your next visit" })).toBeVisible();
  const me = await page.evaluate(async () => (await fetch("/api/me")).json() as Promise<Record<string, unknown>>);
  const list = await page.evaluate(async () => (await fetch("/api/visits")).json() as Promise<Record<string, unknown>>);
  const price = { amount: 3_000_000, from: false, code: null };
  const waiting = {
    type: "first_fit",
    date: "2027-09-25",
    window: "morning",
    paid: false,
    one_visit: price,
    told: false,
  };
  await page.route("**/api/me", (route) =>
    route.fulfill({ json: { ...me, next_visit: null, prompt: null, being_booked: waiting } }),
  );
  await page.route("**/api/visits", (route) => route.fulfill({ json: { ...list, upcoming: [] } }));
  await page.reload();
  const home = page.getByRole("region", { name: "Your consultation and fit" });
  await expect(home).toContainText(shortDate("2027-09-25"));
  await expect(home).toContainText("Rs. 30,000, only if you go ahead");
  await expect(home).not.toContainText("We are booking your visit.");
  // Nothing paid and no consent to visit messages, so no WhatsApp is promised.
  await expect(home).not.toContainText("We will message you on WhatsApp");

  await tab(page, "Visits").click();
  const card = page.getByRole("main").getByRole("listitem").first();
  await expect(card).toContainText(shortDate("2027-09-25"));
  await expect(card).toContainText("Consultation and fit · 9 am to 12 pm");
  await expect(card).not.toContainText("We are booking your visit.");
  await expect(page.getByText("Nothing booked yet.")).toHaveCount(0);
  expect(await axeViolations(page)).toEqual([]);
});

// A consultation and fit in one visit read "First fit · 180 minutes", with no price and no
// word of the link it is paid by. The API's answers are altered on their way, as the local database books no one visit.
test("Home and Visits name a consultation and fit, what it costs once fitted, and what to expect", async ({ page }) => {
  const client = fittedClient();
  await logIn(page, client.mobile);
  await expect(page.getByRole("heading", { level: 1, name: "Your next visit" })).toBeVisible();
  const me = await page.evaluate(async () => (await fetch("/api/me")).json() as Promise<Record<string, unknown>>);
  const list = await page.evaluate(async () => (await fetch("/api/visits")).json() as Promise<Record<string, unknown>>);
  const oneVisit = {
    ...(me.next_visit as Record<string, unknown>),
    type: "first_fit",
    length_minutes: 180,
    one_visit: { amount: 2_700_000, from: false, code: "TENPC" },
  };
  await page.route("**/api/me", (route) => route.fulfill({ json: { ...me, next_visit: oneVisit, prompt: null } }));
  await page.route("**/api/visits", (route) => route.fulfill({ json: { ...list, upcoming: [oneVisit] } }));
  await page.reload();

  const card = page.getByRole("region", { name: "Your consultation and fit" });
  await expect(card).toContainText("Consultation and fit · 3 hours");
  await expect(card).toContainText("Rs. 27,000, only if you go ahead");
  await expect(card).toContainText("Code TENPC applied");
  await expect(card).toContainText("Paid once fitted, by a link we text you");
  await expect(page.getByRole("region", { name: "What to expect" })).toContainText(
    "Choose your hair system, fitted there and then.",
  );
  expect(await axeViolations(page)).toEqual([]);

  await tab(page, "Visits").click();
  await expect(page.getByRole("main").getByRole("link").first()).toContainText("Consultation and fit · 12 to 4 pm");
});

// Once fitted, the link to pay by lived only in Razorpay's SMS.
test("Home and Payments show a payment owed once fitted, with the link to pay by", async ({ page }) => {
  const client = fittedClient();
  await logIn(page, client.mobile);
  await expect(page.getByRole("heading", { level: 1, name: "Your next visit" })).toBeVisible();
  const me = await page.evaluate(async () => (await fetch("/api/me")).json() as Promise<Record<string, unknown>>);
  const owed = {
    visit_id: client.firstFit.id,
    date: client.firstFit.date,
    amount: 4_500_000,
    product: "Mane Man Natural hair system",
    url: "https://rzp.io/i/natural",
  };
  await page.route("**/api/me", (route) => route.fulfill({ json: { ...me, payment_owed: owed } }));
  await page.reload();

  const home = page.getByRole("region", { name: "To pay" });
  await expect(home).toContainText("Mane Man Natural hair system · Rs. 45,000");
  await expect(home.getByRole("link", { name: /^Pay now ?, opens Razorpay in a new tab$/ })).toHaveAttribute(
    "href",
    owed.url,
  );

  const payments = await page.evaluate(async () => (await fetch("/api/payments")).json() as Promise<object>);
  await page.route("**/api/payments", (route) => route.fulfill({ json: { ...payments, owed: [owed] } }));
  await tab(page, "Payments").click();
  const toPay = page.getByRole("region", { name: "To pay" });
  await expect(toPay.getByRole("link")).toHaveAttribute("href", owed.url);
  await expect(toPay).toContainText("Rs. 45,000");
  expect(await axeViolations(page)).toEqual([]);
});
