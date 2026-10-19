import { fullDate, listMonth, shortDate } from "../../packages/web-kit/dates.ts";
import { expect, test } from "../support.ts";
import { axeViolations } from "../a11y.ts";
import { fittedClient } from "./fitted.ts";
import { logIn } from "./signed-in.ts";
import { tab } from "./fitted-fixtures.ts";
import * as appCopy from "../../apps/app/src/content.ts";
import { holdOpen } from "./one-tap.ts";

test("Home shows a fitted client’s next visit, with the technician, and Reschedule", async ({ page }) => {
  const client = fittedClient();
  await logIn(page, client.mobile);
  await expect(page.getByRole("heading", { level: 1, name: appCopy.home.next.label })).toBeVisible();
  await expect(page.getByText(shortDate(client.next.date))).toBeVisible();
  await expect(page.getByText("12–12:30 pm", { exact: true })).toBeVisible();
  await expect(page.getByText("Imran", { exact: true })).toBeVisible();
  await expect(page.getByText("Service visit · 90 minutes")).toBeVisible();
  await expect(page.getByText("Gurgaon 122018")).toBeVisible();
  // Home's one prompt: this client has given no address, which comes before the replacement falling due.
  await expect(page.getByText(appCopy.home.prompt.address)).toBeVisible();
  await expect(page.getByRole("link", { name: appCopy.home.prompt.addAddress })).toHaveAttribute("href", "/profile");
  // Self-serve booking is on locally, so Reschedule opens the move sheet (C7; e2e/app/changes.e2e.ts moves one).
  await page.getByRole("button", { name: appCopy.home.reschedule }).click();
  await expect(page.getByRole("dialog", { name: /^Move \w+day’s visit$/ })).toBeVisible();
});

test("Visits lists what is coming and what is done, and a past visit opens with its photographs", async ({ page }) => {
  const client = fittedClient();
  await logIn(page, client.mobile);
  await tab(page, "Visits").click();
  await expect(page.getByRole("heading", { level: 1, name: appCopy.titles.visits })).toBeVisible();
  await expect(page.getByText("Service visit · 12–12:30 pm · Imran")).toBeVisible();
  // Self-serve booking is on locally: the footer opens the booking sheet (e2e/app/booking.e2e.ts).
  await expect(page.getByRole("button", { name: appCopy.home.next.book })).toBeVisible();

  // Every visit opens its own page: the one coming, then the three done.
  const visits = page.getByRole("main").getByRole("link");
  await expect(visits).toHaveCount(4);
  await expect(visits.nth(0)).toContainText("Service visit · 12–12:30 pm · Imran");
  await expect(visits.nth(1)).toContainText(`${fullDate(client.service.date)}Service visit · Imran`);
  await expect(visits.nth(2)).toContainText(`${fullDate(client.firstFit.date)}First fit · Imran`);
  await expect(visits.nth(3)).toContainText(`${fullDate(client.consultation.date)}Consultation · Imran`);

  await visits.nth(1).click();
  await expect(page.getByRole("heading", { level: 1, name: fullDate(client.service.date) })).toBeVisible();
  await expect(page.getByText("Imran Qureshi")).toBeVisible();
  await expect(page.getByText("85 minutes")).toBeVisible();
  // The visit's "What was done": the checklist the technician ticked, from their phone.
  await expect(page.getByRole("term").filter({ hasText: appCopy.visits.detail.done }).locator("+ dd")).toHaveText(
    "Hair system removed, scalp cleaned, hair system cleaned.",
  );
  // The row shows the thumbnail the technician's phone made, not the whole photograph (ADR 0093).
  const front = page.getByRole("button", { name: `Front, after the visit, ${fullDate(client.service.date)}` });
  await expect.poll(() => front.locator("img").evaluate((image: HTMLImageElement) => image.naturalWidth)).toBe(300);
  await page.getByRole("link", { name: appCopy.visits.detail.back }).click();
  await expect(page.getByRole("heading", { level: 1, name: appCopy.titles.visits })).toBeVisible();

  // The visit coming opens too, as Home's card, with the ways to change it.
  await visits.nth(0).click();
  await expect(page.getByRole("heading", { level: 1, name: appCopy.VISIT_TYPES.service })).toBeVisible();
  await expect(page.getByText("12–12:30 pm", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: appCopy.home.reschedule })).toBeVisible();

  // With self-serve booking on, the note is kept on the visit for the technician, not sent to WhatsApp.
  await page.getByRole("button", { name: appCopy.home.note }).click();
  const sheet = page.getByRole("dialog");
  await sheet.getByRole("textbox", { name: appCopy.note.label }).fill("The lift is out");
  // Two taps, the second inside the first's round trip, save it once (e2e/app/one-tap.ts).
  const held = await holdOpen(page, "**/api/appointments/*/note");
  const save = sheet.locator("button[type=submit]");
  await save.click();
  await save.click({ force: true });
  await expect(sheet.getByRole("heading", { name: /^Saved\./ })).toBeVisible();
  expect(held.asked()).toBe(1);

  // And shown back: on the card, and in the sheet when it opens again.
  await sheet.getByRole("button", { name: appCopy.booking.close }).first().click();
  await expect(page.getByText("Your note: “The lift is out”")).toBeVisible();
  await page.getByRole("button", { name: appCopy.home.note }).click();
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
  await expect(page.getByRole("heading", { level: 1, name: appCopy.titles.visits })).toBeVisible();
  await page.getByRole("main").getByRole("link").first().click();
  const visitPage = page.getByRole("heading", { level: 1, name: appCopy.VISIT_TYPES.service });
  await expect(visitPage).toBeVisible();

  await page.getByRole("button", { name: appCopy.home.note }).click();
  const sheet = page.getByRole("dialog");
  const note = sheet.getByRole("textbox", { name: appCopy.note.label });
  const save = sheet.getByRole("button", { name: appCopy.note.save });
  await note.fill("The lift is out");
  await page.context().setOffline(true);
  await expect(sheet.getByText(appCopy.note.offline)).toBeVisible();
  await expect(note).toHaveValue("The lift is out");
  await expect(save).toBeDisabled();
  await page.context().setOffline(false);
  await expect(save).toBeEnabled();

  await page.goBack();
  await expect(sheet).toBeHidden();
  await expect(visitPage).toBeVisible();

  // Closed by its own button, the sheet leaves nothing behind in the history: Back goes to the list.
  await page.getByRole("button", { name: appCopy.home.note }).click();
  await sheet.getByRole("button", { name: appCopy.booking.close }).click();
  await expect(sheet).toBeHidden();
  await expect.poll(() => page.evaluate(() => window.history.state as unknown)).toBeNull();
  await page.goBack();
  await expect(page.getByRole("heading", { level: 1, name: appCopy.titles.visits })).toBeVisible();
});

// A visit that is not this client's, or a payment, says so rather than offering to try again for ever.
test("a visit or a payment that is not the client’s says it could not be found", async ({ page }) => {
  await logIn(page, fittedClient().mobile);
  await expect(page.getByRole("heading", { level: 1, name: appCopy.home.next.label })).toBeVisible();
  const nobody = "00000000-0000-4000-8000-000000000000";
  await page.goto(`/visits/${nobody}`);
  await expect(page.getByRole("alert")).toContainText(appCopy.visits.notFound);
  await expect(page.getByRole("button", { name: appCopy.problem.tryAgain })).toHaveCount(0);
  await page.getByRole("main").getByRole("link", { name: appCopy.visits.detail.back }).click();
  await expect(page.getByRole("heading", { level: 1, name: appCopy.titles.visits })).toBeVisible();
  await page.goto(`/payments/${nobody}`);
  await expect(page.getByRole("alert")).toContainText(appCopy.payments.notFound);
});

// Home as the API gives it: a visit FSM has not closed stays, saying where it stands, and nothing is booked in its
// place; the credit tile, and each prompt in its own words. The API's answers are altered on
// their way, since the shared client has none of these.
test("Home keeps a visit done but not yet closed, and shows the credit tile and the prompt the API gives", async ({
  page,
}) => {
  const client = fittedClient();
  await logIn(page, client.mobile);
  await expect(page.getByRole("heading", { level: 1, name: appCopy.home.next.label })).toBeVisible();
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
  await expect(page.getByText(appCopy.home.stages.done)).toBeVisible();
  await expect(page.getByRole("button", { name: appCopy.home.reschedule })).toHaveCount(0);
  await expect(page.getByRole("button", { name: appCopy.home.note })).toHaveCount(0);
  await expect(page.getByText("2 free service visits")).toBeVisible();
  await expect(page.getByText("1 to use by 3 Jan 2028")).toBeVisible();
  const month = listMonth(client.piece.due.slice(0, 7), new Date().getFullYear());
  await expect(page.getByText(`Your replacement is due in ${month}.`)).toBeVisible();
  // The API prompts the replacement only once its month may be booked, so the prompt always offers it, beside the
  // app's own page on what a replacement involves.
  await expect(page.getByRole("link", { name: appCopy.home.prompt.involves })).toHaveAttribute("href", "/replacement");
  await expect(page.getByRole("button", { name: appCopy.home.prompt.bookReplacement })).toBeVisible();
  expect(await axeViolations(page)).toEqual([]);

  await tab(page, "Visits").click();
  await expect(page.getByText("Service visit · Done · record on its way · Imran")).toBeVisible();
  await expect(page.getByRole("button", { name: appCopy.home.next.book })).toHaveCount(0);

  // An invoice just issued is a line of its own, beneath whichever prompt leads.
  prompt = { kind: "address" };
  invoice = { visit_id: client.service.id, date: client.service.date, type: "service" };
  await tab(page, "Home").click();
  await page.reload();
  await expect(page.getByText(appCopy.home.prompt.address)).toBeVisible();
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
test("Visits heads the client’s own record with the month their replacement falls due", async ({ page }) => {
  const client = fittedClient();
  await logIn(page, client.mobile);
  await tab(page, "Visits").click();

  const record = page.getByRole("region", { name: appCopy.visits.record.label });
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
