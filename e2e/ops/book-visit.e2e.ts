// Booking a visit for a client from the console: from their Visits tab, and from a Tasks row that is done by booking
// one. A paid visit goes out as a payment link; anything else is booked at once. The API is answered from here, so
// the windows and the outcome read the same on every run; each reply is held to docs/openapi-ops.json.

import type { Page } from "@playwright/test";
import { expect, test } from "../support.ts";
import { axeViolations } from "../a11y.ts";
import {
  answer,
  CLIENT,
  CONSENTS,
  json,
  PIECES,
  RECORD,
  TASKS,
  TASKS_READ_ON,
  type Answers,
  type Call,
  type OpsReply,
} from "./fixtures.ts";

const AVAILABILITY: Call = "GET /api/visits/availability";
const BOOK: Call = "POST /api/visits";
const HOLD = "44000000-0000-4000-8000-000000000001";
const SANDEEP = { id: "t2", name: "Sandeep Rawat" };
const IMRAN = { id: "t1", name: "Imran Qureshi" };

const SERVICE_PRICE = { amount_ex_gst: 200_000, amount: 200_000, gst_percent: 0 };

/** Two days of windows: Thursday's morning is full, its afternoon has both technicians. */
const WINDOWS = {
  kind: "service",
  services: [{ tier: "standard", name: "Service visit", minutes: 90, price: SERVICE_PRICE }],
  service: { tier: "standard", name: "Service visit", minutes: 90 },
  pays: "link",
  credits: 0,
  days: [
    {
      date: "2027-09-23",
      windows: [
        { window: "morning", start: "09:00", end: "12:00", technicians: [] },
        { window: "afternoon", start: "12:00", end: "16:00", technicians: [IMRAN, SANDEEP] },
        { window: "evening", start: "16:00", end: "20:00", technicians: [SANDEEP] },
      ],
    },
    {
      date: "2027-09-24",
      windows: [
        { window: "morning", start: "09:00", end: "12:00", technicians: [IMRAN] },
        { window: "afternoon", start: "12:00", end: "16:00", technicians: [] },
        { window: "evening", start: "16:00", end: "20:00", technicians: [] },
      ],
    },
  ],
} satisfies OpsReply<"/api/visits/availability">;

const LINK_SENT = {
  hold_id: HOLD,
  outcome: "awaiting_payment",
  visit_id: null,
  pays: "link",
  service: WINDOWS.service,
  price: SERVICE_PRICE,
  date: "2027-09-23",
  window: "afternoon",
  technician: SANDEEP,
  link: { url: "https://rzp.io/i/stub4417", open_until: "2027-09-23T04:30:00.000Z" },
} satisfies OpsReply<"/api/visits", "post", 201>;

async function openVisits(page: Page, over: Answers = {}): Promise<void> {
  await page.clock.setFixedTime(TASKS_READ_ON);
  await answer(page, {
    [`GET /api/clients/${CLIENT.id}`]: json(RECORD),
    [`GET /api/clients/${CLIENT.id}/pieces`]: json(PIECES),
    [`GET /api/clients/${CLIENT.id}/consents`]: json(CONSENTS),
    [AVAILABILITY]: json(WINDOWS),
    ...over,
  });
  await page.goto(`/clients/${CLIENT.id}/visits`);
}

const panel = (page: Page) => page.getByRole("dialog", { name: `Book a visit for ${CLIENT.name}` });

test("books a fitted client's service visit in a window someone is free in, sending the payment link", async ({
  page,
}) => {
  const sent: unknown[] = [];
  await openVisits(page, {
    [BOOK]: async (route) => {
      sent.push(route.request().postDataJSON());
      await json(LINK_SENT, 201)(route);
    },
  });
  await page.getByRole("button", { name: "Book a visit" }).click();
  const booking = panel(page);
  await expect(booking.getByLabel("Visit", { exact: true })).toHaveValue("service");
  // Thursday's morning is full, so it is not offered.
  await expect(booking.getByLabel("Window", { exact: true }).getByRole("option")).toHaveText([
    "afternoon, 12:00 to 16:00",
    "evening, 16:00 to 20:00",
  ]);
  await booking.getByLabel("Technician", { exact: true }).selectOption({ label: "Sandeep Rawat" });
  await expect(booking).toContainText("They get a payment link by SMS");
  expect(await axeViolations(page, (axe) => axe.include("dialog"))).toEqual([]);

  await booking.getByRole("button", { name: "Book" }).click();
  await expect(booking.getByRole("status")).toContainText("Payment link sent for Rs. 2,000.");
  await expect(booking.getByRole("status")).toContainText("Service visit, Thu 23 Sep, afternoon, with Sandeep Rawat.");
  await expect(booking.getByRole("status")).toContainText("https://rzp.io/i/stub4417");
  expect(sent).toEqual([
    { client: CLIENT.id, kind: "service", tier: "standard", date: "2027-09-23", window: "afternoon", technician: "t2" },
  ]);
});

test("says why a booking was refused, and books nothing", async ({ page }) => {
  await openVisits(page, {
    [BOOK]: json({ error: { code: "taken", request_id: "r-1" } }, 409),
  });
  await page.getByRole("button", { name: "Book a visit" }).click();
  await panel(page).getByRole("button", { name: "Book" }).click();
  await expect(panel(page).getByRole("alert")).toHaveText("That window was just taken. Choose another.");
});

test("books a consultation asked for from its Tasks row, on the day and window asked, and the task goes", async ({
  page,
}) => {
  const asked = {
    ...TASKS,
    groups: [
      {
        group: "consultation_request",
        count: 1,
        closable: false,
        tasks: [
          {
            id: "95000000-0000-4000-8000-000000000001",
            person: { id: CLIENT.id, name: CLIENT.name },
            detail: "2027-09-24 morning",
            since: "2027-09-21T06:00:00.000Z",
            due: "2027-09-23T06:00:00.000Z",
            owner: null,
          },
        ],
      },
    ],
  } satisfies OpsReply<"/api/tasks">;
  const consultation = {
    ...WINDOWS,
    kind: "consultation",
    services: [
      { tier: "standard", name: "Consultation", minutes: 60, price: { ...SERVICE_PRICE, amount: 0, amount_ex_gst: 0 } },
    ],
    service: { tier: "standard", name: "Consultation", minutes: 60 },
    pays: "nothing",
  } satisfies OpsReply<"/api/visits/availability">;
  const sent: unknown[] = [];
  await page.clock.setFixedTime(TASKS_READ_ON);
  await answer(page, {
    "GET /api/tasks": json(asked),
    [AVAILABILITY]: json(consultation),
    [BOOK]: async (route) => {
      sent.push(route.request().postDataJSON());
      await json(
        {
          ...LINK_SENT,
          outcome: "booked",
          visit_id: "33000000-0000-4000-8000-000000000009",
          pays: "nothing",
          service: consultation.service,
          price: { ...SERVICE_PRICE, amount: 0, amount_ex_gst: 0 },
          date: "2027-09-24",
          window: "morning",
          technician: IMRAN,
          link: null,
        },
        201,
      )(route);
    },
  });
  await page.goto("/tasks");
  const tasks = page.getByRole("region", { name: "Tasks" });
  await tasks.getByRole("button", { name: `Book a visit · ${CLIENT.name}` }).click();
  const booking = panel(page);
  await expect(booking.getByLabel("Visit", { exact: true })).toHaveValue("consultation");
  await expect(booking.getByLabel("Day", { exact: true })).toHaveValue("2027-09-24");
  await expect(booking).toContainText("Nothing to pay.");
  await booking.getByRole("button", { name: "Book" }).click();
  await expect(booking.getByRole("status")).toContainText("Booked.");
  expect(sent).toEqual([
    { client: CLIENT.id, kind: "consultation", tier: "standard", date: "2027-09-24", window: "morning" },
  ]);

  await booking.getByRole("button", { name: "Close" }).click();
  await expect(tasks.getByRole("listitem")).toHaveCount(0);
});

// A booking that refunded its payment by itself showed nowhere in the console.
test("lists a booking that refunded its payment by itself beneath the visits, and why", async ({ page }) => {
  const refunded = {
    hold_id: "66000000-0000-4000-8000-000000000002",
    type: "service",
    service: "Service visit",
    date: "2027-09-24",
    amount: 200_000,
    reason: "lapsed",
    refunded_at: "2027-09-22T06:00:00.000Z",
  } satisfies Extract<OpsReply<"/api/clients/{id}">, { auto_refunds: unknown }>["auto_refunds"][number];
  await openVisits(page, { [`GET /api/clients/${CLIENT.id}`]: json({ ...RECORD, auto_refunds: [refunded] }) });
  const item = page.getByRole("region", { name: "Refunded bookings" }).getByRole("listitem");
  await expect(item).toContainText("Service visit, 24 Sep 2027 · Rs. 2,000");
  await expect(item).toContainText("Auto-refunded on 22 Sep 2027: paid after the hold expired.");
  expect(await axeViolations(page)).toEqual([]);
});
