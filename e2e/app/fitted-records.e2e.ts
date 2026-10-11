import { fullDate } from "../../packages/web-kit/dates.ts";
import { windowSpan } from "../../src/config/scheduling.ts";
import { assertInContract } from "../contract.ts";
import { expect, test } from "../support.ts";
import { axeViolations } from "../a11y.ts";
import { fittedClient } from "./fitted.ts";
import { logIn } from "./signed-in.ts";
import { tab } from "./fitted-fixtures.ts";

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

test("a visit to come offers itself to the client's calendar, at its window; one done does not", async ({ page }) => {
  const client = fittedClient();
  await logIn(page, client.mobile);
  await expect(page.getByRole("heading", { level: 1, name: "Your next visit" })).toBeVisible();
  await page.goto(`/visits/${client.next.id}`);
  const google = new URL((await page.getByRole("link", { name: "Google Calendar" }).getAttribute("href")) ?? "");
  const { start, end } = windowSpan(client.next.date, "afternoon");
  const stamp = (instant: Date) => instant.toISOString().replace(/[-:]|\.\d{3}/g, "");
  expect(Object.fromEntries(google.searchParams)).toMatchObject({
    text: "Mane Man: Service visit",
    dates: `${stamp(start)}/${stamp(end)}`,
    details: "Imran arrives in the window, 12 to 4 pm.",
  });
  const file = page.getByRole("link", { name: "Apple or Outlook" });
  const ics = decodeURIComponent((await file.getAttribute("href"))?.split(",")[1] ?? "");
  expect(ics).toContain(`UID:${client.next.id}@maneman.in`);

  await page.goto(`/visits/${client.service.id}`);
  await expect(page.getByRole("link", { name: "Tax invoice" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Google Calendar" })).toHaveCount(0);
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
