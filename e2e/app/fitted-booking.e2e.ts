import { shortDate } from "../../packages/web-kit/dates.ts";
import { expect, test } from "../support.ts";
import { axeViolations } from "../a11y.ts";
import { fittedClient } from "./fitted.ts";
import { logIn } from "./signed-in.ts";
import { tab } from "./fitted-fixtures.ts";

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
