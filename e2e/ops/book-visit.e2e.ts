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
import * as opsCopy from "../../apps/ops/src/content.ts";

const AVAILABILITY: Call = "GET /api/visits/availability";
const BOOK: Call = "POST /api/visits";
const HOLD = "44000000-0000-4000-8000-000000000001";
const SANDEEP = { id: "t2", name: "Sandeep Rawat" };
const IMRAN = { id: "t1", name: "Imran Qureshi" };

const SERVICE_PRICE = { amount_ex_gst: 200_000, amount: 200_000, gst_percent: 0 };

/** A start and who can take it, adding no drive. */
const at = (time: string, startsAt: string, technicians: readonly { id: string; name: string }[]) => ({
  time,
  starts_at: startsAt,
  technicians: technicians.map((each) => ({ ...each, added_drive_minutes: 0 })),
});

/** Two days of starts: Thursday's morning is full, its noon has both technicians. */
const WINDOWS = {
  kind: "service",
  needs_profile: false,
  services: [{ tier: "standard", name: "Service visit", minutes: 90, price: SERVICE_PRICE }],
  service: { tier: "standard", name: "Service visit", minutes: 90 },
  recommended: null,
  pays: "link",
  credits: 0,
  owed: [],
  days: [
    {
      date: "2027-09-23",
      windows: [
        { window: "morning", start: "09:00", end: "12:00", technicians: [] },
        { window: "afternoon", start: "12:00", end: "16:00", technicians: [IMRAN, SANDEEP] },
        { window: "evening", start: "16:00", end: "20:00", technicians: [SANDEEP] },
      ],
      starts: [
        at("12:00", "2027-09-23T06:30:00.000Z", [IMRAN, SANDEEP]),
        at("12:30", "2027-09-23T07:00:00.000Z", [IMRAN]),
        at("16:00", "2027-09-23T10:30:00.000Z", [SANDEEP]),
      ],
    },
    {
      date: "2027-09-24",
      windows: [
        { window: "morning", start: "09:00", end: "12:00", technicians: [IMRAN] },
        { window: "afternoon", start: "12:00", end: "16:00", technicians: [] },
        { window: "evening", start: "16:00", end: "20:00", technicians: [] },
      ],
      starts: [at("09:00", "2027-09-24T03:30:00.000Z", [IMRAN]), at("09:30", "2027-09-24T04:00:00.000Z", [IMRAN])],
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
  starts_at: "2027-09-23T06:30:00.000Z",
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

test("books a fitted client’s service visit at a start someone is free at, sending the payment link", async ({
  page,
}) => {
  const sent: unknown[] = [];
  await openVisits(page, {
    [BOOK]: async (route) => {
      sent.push(route.request().postDataJSON());
      await json(LINK_SENT, 201)(route);
    },
  });
  await page.getByRole("button", { name: opsCopy.clients.visits.book.open }).click();
  const booking = panel(page);
  await expect(booking.getByLabel(opsCopy.clients.visits.book.kind, { exact: true })).toHaveValue("service");
  // Thursday's morning is full, so none of its starts is offered.
  await expect(booking.getByLabel(opsCopy.clients.visits.book.start, { exact: true }).getByRole("option")).toHaveText([
    "12 pm",
    "12:30 pm",
    "4 pm",
  ]);
  await booking
    .getByLabel(opsCopy.clients.visits.book.technician, { exact: true })
    .selectOption({ label: "Sandeep Rawat" });
  await expect(booking).toContainText("by payment link");
  expect(await axeViolations(page, (axe) => axe.include("dialog"))).toEqual([]);

  await booking.getByRole("button", { name: opsCopy.clients.visits.book.book }).click();
  await expect(booking.getByRole("status")).toContainText("Payment link sent for Rs. 2,000.");
  await expect(booking.getByRole("status")).toContainText("Service visit, Thu 23 Sep, 12 pm, with Sandeep Rawat.");
  await expect(booking.getByRole("status")).toContainText("https://rzp.io/i/stub4417");
  expect(sent).toEqual([
    {
      client: CLIENT.id,
      kind: "service",
      tier: "standard",
      date: "2027-09-23",
      window: "afternoon",
      starts_at: "2027-09-23T06:30:00.000Z",
      technician: "t2",
    },
  ]);
});

// With a replacement due first, Book a visit opened on a service visit and said nothing of the piece it replaces.
test("opens on the replacement the app offers next, naming the hair system it replaces", async ({ page }) => {
  const due = { ...RECORD, next_visit: { type: "replacement" as const, tier: "standard", due_on: "2027-09-25" } };
  await openVisits(page, { [`GET /api/clients/${CLIENT.id}`]: json(due) });
  await page.getByRole("button", { name: opsCopy.clients.visits.book.open }).click();
  const booking = panel(page);
  await expect(booking.getByLabel(opsCopy.clients.visits.book.kind, { exact: true })).toHaveValue("replacement");
  await expect(booking).toContainText(opsCopy.clients.visits.book.replaces("MM-STD-4417-C"));
});

// The refusal for a first fit with no hair profile came only once the whole form was filled and sent.
test("says a first fit needs the hair profile as soon as First fit is chosen, and holds Book", async ({ page }) => {
  const firstFit = { ...WINDOWS, kind: "first_fit" as const, needs_profile: true };
  await openVisits(page, { [AVAILABILITY]: json(firstFit) });
  await page.getByRole("button", { name: opsCopy.clients.visits.book.open }).click();
  const booking = panel(page);
  await booking.getByLabel(opsCopy.clients.visits.book.kind, { exact: true }).selectOption("first_fit");
  await expect(booking.getByRole("alert")).toHaveText(opsCopy.clients.visits.book.errors.no_profile);
  await expect(booking.getByRole("button", { name: opsCopy.clients.visits.book.book })).toBeDisabled();
});

test("says why a booking was refused, and books nothing", async ({ page }) => {
  await openVisits(page, {
    [BOOK]: json({ error: { code: "taken", request_id: "r-1" } }, 409),
  });
  await page.getByRole("button", { name: opsCopy.clients.visits.book.open }).click();
  await panel(page).getByRole("button", { name: opsCopy.clients.visits.book.book }).click();
  await expect(panel(page).getByRole("alert")).toHaveText(opsCopy.clients.visits.book.errors.taken);
});

test("books a consultation asked for from its Tasks row, at the first start in the window asked, and the task goes", async ({
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
            facts: {
              group: "consultation_request",
              date: "2027-09-24",
              window: "morning",
              one_visit: false,
              discount_code: null,
              first_fit: null,
            },
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
          starts_at: "2027-09-24T03:30:00.000Z",
          technician: IMRAN,
          link: null,
        },
        201,
      )(route);
    },
  });
  await page.goto("/tasks");
  const tasks = page.getByRole("region", { name: /^\d+ open$/ });
  await tasks.getByRole("button", { name: `Book a visit · ${CLIENT.name}` }).click();
  const booking = panel(page);
  await expect(booking.getByLabel(opsCopy.clients.visits.book.kind, { exact: true })).toHaveValue("consultation");
  await expect(booking.getByLabel(opsCopy.clients.visits.book.day, { exact: true })).toHaveValue("2027-09-24");
  await expect(booking).toContainText(opsCopy.clients.visits.book.pays.nothing);
  await booking.getByRole("button", { name: opsCopy.clients.visits.book.book }).click();
  await expect(booking.getByRole("status")).toContainText(opsCopy.clients.visits.book.outcomes.booked);
  expect(sent).toEqual([
    {
      client: CLIENT.id,
      kind: "consultation",
      tier: "standard",
      date: "2027-09-24",
      window: "morning",
      starts_at: "2027-09-24T03:30:00.000Z",
    },
  ]);

  await booking.getByRole("button", { name: opsCopy.CLOSE }).click();
  await expect(tasks.getByRole("listitem")).toHaveCount(0);
});

// A first fit left partly done once offered only "Close without follow-up", and the console priced the refit again.
test("books a first fit left partly done again, free, from its Tasks row, and the task goes", async ({ page }) => {
  const FIT = "98000000-0000-4000-8000-000000000009";
  const partly = {
    ...TASKS,
    groups: [
      {
        group: "partial_visit",
        count: 1,
        closable: true,
        tasks: [
          {
            id: FIT,
            person: { id: CLIENT.id, name: CLIENT.name },
            facts: {
              group: "partial_visit",
              kind: "first_fit",
              reason_code: "piece_not_ready",
              reason: "Hair system not ready",
            },
            detail: "first_fit Hair system not ready",
            since: "2027-09-19T06:00:00.000Z",
            due: "2027-09-21T06:00:00.000Z",
            owner: null,
          },
        ],
      },
    ],
  } satisfies OpsReply<"/api/tasks">;
  const natural = { tier: "natural", name: "Mane Man Natural", minutes: 180 };
  const firstFit = {
    ...WINDOWS,
    kind: "first_fit",
    services: [{ ...natural, price: { amount_ex_gst: 4_500_000, amount: 4_500_000, gst_percent: 0 } }],
    service: natural,
    owed: [{ id: FIT, why: "partial", piece_code: null, since: "2027-09-19T04:30:00.000Z" }],
  } satisfies OpsReply<"/api/visits/availability">;
  const sent: unknown[] = [];
  await page.clock.setFixedTime(TASKS_READ_ON);
  await answer(page, {
    "GET /api/tasks": json(partly),
    [AVAILABILITY]: json(firstFit),
    [BOOK]: async (route) => {
      sent.push(route.request().postDataJSON());
      await json(
        {
          ...LINK_SENT,
          outcome: "booked",
          visit_id: "33000000-0000-4000-8000-000000000010",
          pays: "nothing",
          service: natural,
          price: { amount_ex_gst: 0, amount: 0, gst_percent: 0 },
          link: null,
        },
        201,
      )(route);
    },
  });
  await page.goto("/tasks");
  const tasks = page.getByRole("region", { name: /^\d+ open$/ });
  await expect(tasks).toContainText("Hair system not ready");
  await tasks.getByRole("button", { name: `${opsCopy.tasks.bookFree} · ${CLIENT.name}` }).click();
  const booking = panel(page);
  const book = opsCopy.clients.visits.book;
  await expect(booking.getByLabel(book.kind, { exact: true })).toHaveValue("first_fit");
  await expect(booking.getByLabel(book.covers, { exact: true })).toHaveValue(FIT);
  await expect(booking).toContainText(book.pays.covered);
  await expect(booking.getByLabel(book.code, { exact: true })).toHaveCount(0);
  expect(await axeViolations(page, (axe) => axe.include("dialog"))).toEqual([]);

  await booking.getByRole("button", { name: book.book }).click();
  await expect(booking.getByRole("status")).toContainText(opsCopy.clients.visits.book.outcomes.booked);
  expect(sent).toEqual([
    {
      client: CLIENT.id,
      kind: "first_fit",
      tier: "natural",
      date: "2027-09-23",
      window: "afternoon",
      starts_at: "2027-09-23T06:30:00.000Z",
      covers: FIT,
    },
  ]);
  await booking.getByRole("button", { name: opsCopy.CLOSE }).click();
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
  const item = page.getByRole("region", { name: opsCopy.clients.visits.autoRefunds.title }).getByRole("listitem");
  await expect(item).toContainText("Service visit, 24 Sep 2027 · Rs. 2,000");
  await expect(item).toContainText("Auto-refunded on 22 Sep 2027: paid after the hold expired.");
  expect(await axeViolations(page)).toEqual([]);
});
