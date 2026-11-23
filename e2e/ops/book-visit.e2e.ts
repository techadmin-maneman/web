// Booking a visit for a client from the console: from their Visits tab, and from a Tasks row that is done by booking
// one. A paid visit goes out as a payment link; anything else is booked at once. The API is answered from here, so
// the windows and the outcome read the same on every run; each reply is held to docs/openapi-ops.json.

import type { Locator, Page } from "@playwright/test";
import { expect, test } from "../support.ts";
import { axeViolations } from "../a11y.ts";
import {
  answer,
  CLIENT,
  empty,
  fails,
  json,
  RECORD,
  TASKS,
  TASKS_READ_ON,
  type Call,
  type OpsReply,
} from "./fixtures.ts";
import * as opsCopy from "../../apps/ops/src/content.ts";
import { DISMISS } from "../../packages/ui/words.ts";
import {
  AVAILABILITY,
  HOLD,
  IMRAN,
  SERVICE_PRICE,
  at,
  WINDOWS,
  LINK_SENT,
  openVisits,
  panel,
  gate,
  mark,
  marked,
  inPlace,
} from "./book-visit-fixtures.ts";

const BOOK: Call = "POST /api/visits";

/** What the page brought into view: the element, with its words and the room it kept beneath it, as they were then. */
interface Brought {
  readonly element: Element;
  readonly text: string;
  readonly margin: number;
}

/** Records each element the page brings into view, as the drawer does a line beneath its buttons. */
async function recordScrolls(page: Page): Promise<void> {
  await page.evaluate(() => {
    const brought: Brought[] = [];
    Object.assign(window, { brought });
    type Bring = (this: Element, how?: boolean | ScrollIntoViewOptions) => void;
    const bring = Object.getOwnPropertyDescriptor(Element.prototype, "scrollIntoView")?.value as Bring;
    Element.prototype.scrollIntoView = function (this: Element, how?: boolean | ScrollIntoViewOptions) {
      const margin = parseFloat(getComputedStyle(this).scrollMarginBottom);
      brought.push({ element: this, text: this.textContent, margin });
      bring.call(this, how);
    };
  });
}

/** The words of each element brought into view, as they were when it was. */
const broughtIntoView = (page: Page) =>
  page.evaluate(() => (window as unknown as { brought: Brought[] }).brought.map((each) => each.text));

/**
 * Whether the element was brought into view keeping room beneath it at least the Book bar's height: the margin is the
 * one the element scrolled had then, where alone it acts, and the bar is the sticky box holding the Book button.
 */
const clearsTheBar = (element: Locator) =>
  element.evaluate((node) => {
    const scrolled = (window as unknown as { brought: Brought[] }).brought.findLast((each) =>
      each.element.contains(node),
    );
    const dialog = node.closest("dialog");
    let bar = dialog?.querySelector("button[type=submit]") ?? null;
    while (bar !== null && bar !== dialog && getComputedStyle(bar).position !== "sticky") bar = bar.parentElement;
    if (scrolled === undefined || bar === null || bar === dialog) return false;
    return scrolled.margin >= bar.getBoundingClientRect().height;
  });

/**
 * Whether what is at the middle of each line the element takes is the element itself, not the Book bar or anything
 * else over it: a line of words that wraps is seen only if every line of it is.
 */
const seen = (element: Locator) =>
  element.evaluate((node) =>
    [...node.getClientRects()].every((line) => {
      const at = document.elementFromPoint(line.left + line.width / 2, line.top + line.height / 2);
      return at !== null && node.contains(at);
    }),
  );

/** Whether the element starts beneath the control, not beside it in its row. */
async function beneath(element: Locator, control: Locator): Promise<boolean> {
  const [box, above] = await Promise.all([element.boundingBox(), control.boundingBox()]);
  return (box?.y ?? 0) >= (above?.y ?? 0) + (above?.height ?? 0);
}

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
  await expect(
    booking.getByRole("radio", { name: opsCopy.clients.visits.book.kinds.service, exact: true }),
  ).toBeChecked();
  // Thursday's morning is full, so none of its starts is offered; Book waits for a time.
  for (const time of ["12 pm", "12:30 pm", "4 pm"])
    await expect(booking.getByRole("radio", { name: time, exact: true })).toBeVisible();
  await expect(booking.getByRole("radio", { name: "9 am", exact: true })).toHaveCount(0);
  await expect(booking.getByRole("button", { name: opsCopy.clients.visits.book.chooseTime })).toBeDisabled();
  await booking.getByRole("radio", { name: "12 pm", exact: true }).check();
  await booking
    .getByLabel(opsCopy.clients.visits.book.technician, { exact: true })
    .selectOption({ label: "Sandeep Rawat" });
  await expect(booking).toContainText("by payment link");
  expect(await axeViolations(page, (axe) => axe.include("dialog"))).toEqual([]);

  await booking.getByRole("button", { name: opsCopy.clients.visits.book.bookAt("Thu 23 Sep", "12 pm") }).click();
  const booked = booking.getByRole("status").filter({ hasText: "Payment link sent for Rs. 2,000." });
  await expect(booked).toContainText("Service visit, Thu 23 Sep, 12 pm, with Sandeep Rawat.");
  await expect(booked).toContainText("https://rzp.io/i/stub4417");
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

test("opens on the replacement the app offers next, naming the hair system it replaces", async ({ page }) => {
  const due = { ...RECORD, next_visit: { type: "replacement" as const, tier: "standard", due_on: "2027-09-25" } };
  await openVisits(page, { [`GET /api/clients/${CLIENT.id}`]: json(due) });
  await page.getByRole("button", { name: opsCopy.clients.visits.book.open }).click();
  const booking = panel(page);
  await expect(
    booking.getByRole("radio", { name: opsCopy.clients.visits.book.kinds.replacement, exact: true }),
  ).toBeChecked();
  await expect(booking).toContainText(opsCopy.clients.visits.book.replaces("MM-STD-4417-C"));
});

// The refusal for a first fit with no hair profile came only once the whole form was filled and sent.
test("says a first fit needs the hair profile as soon as First fit is chosen, and holds Book", async ({ page }) => {
  const firstFit = { ...WINDOWS, kind: "first_fit" as const, needs_profile: true };
  await openVisits(page, { [AVAILABILITY]: json(firstFit) });
  await page.getByRole("button", { name: opsCopy.clients.visits.book.open }).click();
  const booking = panel(page);
  await booking.getByRole("radio", { name: opsCopy.clients.visits.book.kinds.first_fit, exact: true }).check();
  await expect(booking.getByRole("alert")).toHaveText(opsCopy.clients.visits.book.errors.no_profile);
  await expect(booking.getByRole("button", { name: opsCopy.clients.visits.book.chooseTime })).toBeDisabled();
});

// Choosing in the panel redraws it in place: the panel is the same node, no entrance plays again, and where nothing
// changes height nothing scrolls. While the windows for a new kind are read, the last kind's times stay where they
// are but cannot be taken, and Book waits, so a time free for one kind is never booked for another.
test("redraws each choice in place, and takes no time from the last kind's windows", async ({ page }) => {
  const book = opsCopy.clients.visits.book;
  const standard = { tier: "standard", name: "Service visit", minutes: 90, price: SERVICE_PRICE };
  const premium = { tier: "premium", name: "Premium service", minutes: 120, price: SERVICE_PRICE };
  const reached = gate();
  const released = gate();
  // Short, so the panel scrolls, and a redraw that moved it would show.
  await page.setViewportSize({ width: 1440, height: 520 });
  await openVisits(page);
  await page.route("**/api/visits/availability**", async (route) => {
    const asked = new URL(route.request().url()).searchParams;
    const kind = asked.get("kind") ?? "service";
    if (kind === "first_fit") {
      reached.open();
      await released.passed;
    }
    const { price: _price, ...service } = asked.get("tier") === "premium" ? premium : standard;
    const start =
      kind === "first_fit"
        ? at("14:00", "2027-09-23T08:30:00.000Z", [IMRAN])
        : at("12:00", "2027-09-23T06:30:00.000Z", [IMRAN]);
    const days = [{ ...WINDOWS.days[0], starts: [start] }, ...WINDOWS.days.slice(1)];
    await route.fulfill({ json: { ...WINDOWS, kind, services: [standard, premium], service, days } });
  });
  await page.getByRole("button", { name: book.open }).click();
  const booking = panel(page);
  await expect(booking.getByRole("radio", { name: "12 pm", exact: true })).toBeVisible();
  await mark(booking.locator("form"));

  // A first fit's windows are read: the service visit's 12 pm stays drawn but cannot be taken, nor its services
  // chosen, and Book waits.
  await inPlace(booking, booking.getByRole("radio", { name: book.kinds.first_fit, exact: true }), async (kind) => {
    await kind.check();
    await reached.passed;
    const stale = booking.getByRole("radio", { name: "12 pm", exact: true });
    await expect(stale.locator("xpath=ancestor::*[@inert]")).toHaveCount(1);
    await expect(booking.getByLabel(book.hairSystem)).toBeDisabled();
    await expect(booking.getByRole("button", { name: book.chooseTime })).toBeDisabled();
    await expect(booking.getByRole("status").filter({ hasText: book.loading })).toHaveCount(1);
    released.open();
    await expect(booking.getByRole("radio", { name: "2 pm", exact: true })).toBeVisible();
  });
  await inPlace(booking, booking.getByLabel(book.hairSystem), async (tier) => {
    await tier.selectOption("premium");
    await expect(tier).toHaveValue("premium");
  });
  await inPlace(booking, booking.getByRole("button", { name: book.later }), (later) => later.click());
  await inPlace(booking, booking.getByRole("button", { name: book.earlier }), (earlier) => earlier.click());
  await inPlace(booking, booking.getByRole("radio", { name: /24 Sep/ }), (day) => day.check());
  await inPlace(booking, booking.getByRole("radio", { name: "9 am", exact: true }), (time) => time.check());
  await inPlace(booking, booking.getByLabel(book.technician), async (who) => {
    await who.selectOption(IMRAN.id);
    await expect(booking.getByRole("button", { name: /^Book Fri 24 Sep, 9/ })).toBeEnabled();
  });
});

test("says why a booking was refused, and books nothing", async ({ page }) => {
  await openVisits(page, {
    [BOOK]: json({ error: { code: "taken", request_id: "r-1" } }, 409),
  });
  await page.getByRole("button", { name: opsCopy.clients.visits.book.open }).click();
  await panel(page).getByRole("radio", { name: "12 pm", exact: true }).check();
  await mark(panel(page).locator("form"));
  await panel(page)
    .getByRole("button", { name: /^Book Thu/ })
    .click();
  await expect(panel(page).getByRole("alert")).toHaveText(opsCopy.clients.visits.book.errors.taken);
  // The start refused is not offered again in the panel, though the days read afresh still list it; the days are
  // read again behind the panel as it stands, not from an empty one.
  await expect(panel(page).getByRole("radio", { name: "12 pm", exact: true })).toHaveCount(0);
  expect(await marked(panel(page).locator("form"))).toBe(true);
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
          // Nobody chosen: the engine's technician, fixed the evening before.
          technician_draft: true,
          link: null,
        },
        201,
      )(route);
    },
  });
  await page.goto("/tasks");
  const tasks = page.getByRole("region", { name: opsCopy.tasks.title });
  await tasks.getByRole("button", { name: `Book a visit · ${CLIENT.name}` }).click();
  const booking = panel(page);
  await expect(
    booking.getByRole("radio", { name: opsCopy.clients.visits.book.kinds.consultation, exact: true }),
  ).toBeChecked();
  await expect(booking.getByRole("radio", { name: /^Friday 24 September/ })).toBeChecked();
  await expect(booking).toContainText(opsCopy.clients.visits.book.pays.nothing);
  await booking.getByRole("button", { name: /^Book Fri 24 Sep/ }).click();
  await expect(booking.getByRole("status")).toContainText(opsCopy.clients.visits.book.outcomes.booked);
  await expect(booking.getByRole("status")).toContainText("with Imran Qureshi, a draft until the evening before.");
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
  await expect(tasks.getByRole("row")).toHaveCount(0);
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
              not_fitted: null,
              ask: null,
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
  const tasks = page.getByRole("region", { name: opsCopy.tasks.title });
  await expect(tasks).toContainText("Hair system not ready");
  await tasks.getByRole("button", { name: `${opsCopy.tasks.bookFree} · ${CLIENT.name}` }).click();
  const booking = panel(page);
  const book = opsCopy.clients.visits.book;
  await expect(booking.getByRole("radio", { name: book.kinds.first_fit, exact: true })).toBeChecked();
  await expect(booking.getByLabel(book.covers, { exact: true })).toHaveValue(FIT);
  await expect(booking).toContainText(book.pays.covered);
  await expect(booking.getByLabel(book.code, { exact: true })).toHaveCount(0);
  expect(await axeViolations(page, (axe) => axe.include("dialog"))).toEqual([]);

  await booking.getByRole("radio", { name: "12 pm", exact: true }).check();
  await booking.getByRole("button", { name: book.bookAt("Thu 23 Sep", "12 pm") }).click();
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
  await expect(tasks.getByRole("row")).toHaveCount(0);
});

// An arrived custom piece waited on the board with no way to book its fit.
test("books the fit of an arrived custom piece from its Tasks row, as a replacement for a client fitted before", async ({
  page,
}) => {
  const ORDER = "8a000000-0000-4000-8000-000000000001";
  const arrived = {
    ...TASKS,
    groups: [
      {
        group: "custom_piece_to_fit",
        count: 1,
        closable: false,
        tasks: [
          {
            id: ORDER,
            person: { id: CLIENT.id, name: CLIENT.name },
            facts: {
              group: "custom_piece_to_fit",
              order: 42,
              piece_code: "MM-0042",
              held_at: "Sandeep Yadav",
              fit: "replacement",
            },
            detail: "CU-0042 · Sandeep Yadav",
            since: "2027-09-19T06:00:00.000Z",
            due: "2027-09-21T06:00:00.000Z",
            owner: null,
          },
        ],
      },
    ],
  } satisfies OpsReply<"/api/tasks">;
  const natural = { tier: "natural", name: "Mane Man Natural", minutes: 180 };
  const replacement = {
    ...WINDOWS,
    kind: "replacement",
    services: [{ ...natural, price: { amount_ex_gst: 4_500_000, amount: 4_500_000, gst_percent: 0 } }],
    service: natural,
    owed: [],
  } satisfies OpsReply<"/api/visits/availability">;
  await page.clock.setFixedTime(TASKS_READ_ON);
  await answer(page, { "GET /api/tasks": json(arrived), [AVAILABILITY]: json(replacement) });
  await page.goto("/tasks");
  const tasks = page.getByRole("region", { name: opsCopy.tasks.title });
  await expect(tasks).toContainText("CU-0042 · at Sandeep Yadav");
  await expect(tasks.getByRole("link", { name: CLIENT.name, exact: true })).toHaveAttribute(
    "href",
    `/clients/${CLIENT.id}/visits`,
  );
  await tasks.getByRole("button", { name: `${opsCopy.tasks.book} · ${CLIENT.name}` }).click();
  const kinds = opsCopy.clients.visits.book.kinds;
  await expect(panel(page).getByRole("radio", { name: kinds.replacement, exact: true })).toBeChecked();
});

// A one visit refused by a consultation still to come was named as a first fit, and a paid booking offered "Let it go".
test("names a consultation that refuses a one visit as a consultation, and lets no paid booking go", async ({
  page,
}) => {
  await openVisits(page, {
    [BOOK]: json({ error: { code: "already_booked", request_id: "r-1" } }, 409),
    [`GET /api/clients/${CLIENT.id}/held-bookings`]: json({
      visit: { kind: "consultation", date: "2027-09-24", window: "morning", starts_at: "2027-09-24T04:30:00.000Z" },
      held: [
        {
          hold_id: HOLD,
          type: "service",
          date: "2027-09-22",
          starts_at: "2027-09-22T06:30:00.000Z",
          amount: 200000,
          url: "https://rzp.io/i/stub4417",
          open_until: "2027-09-22T02:00:00.000Z",
          paid: true,
        },
      ],
    }),
  });
  await page.getByRole("button", { name: opsCopy.clients.visits.book.open }).click();
  await panel(page).getByRole("radio", { name: "12 pm", exact: true }).check();
  await panel(page)
    .getByRole("button", { name: /^Book Thu/ })
    .click();
  const inTheWay = opsCopy.clients.visits.book.inTheWay;
  await expect(panel(page)).toContainText(inTheWay.visit("consultation", "Fri 24 Sep, 10 am"));
  await expect(panel(page)).toContainText(inTheWay.paid("service visit", "Wed 22 Sep, 12 pm"));
  await expect(panel(page).getByRole("button", { name: inTheWay.letGo })).toHaveCount(0);
  await expect(panel(page).getByRole("button", { name: opsCopy.tasks.link.copy })).toHaveCount(0);
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
  await expect(item).toContainText("Service visit, 24 Sep · Rs. 2,000");
  await expect(item).toContainText("Auto-refunded on 22 Sep 2027: paid after the hold expired.");
  expect(await axeViolations(page)).toEqual([]);
});

// Most paid bookings go out as a link with the technician a draft until the evening's lock.
test("says a link booking's technician is a draft, and still offers its link's buttons", async ({ page }) => {
  await openVisits(page, { [BOOK]: json({ ...LINK_SENT, technician_draft: true }, 201) });
  await page.getByRole("button", { name: opsCopy.clients.visits.book.open }).click();
  await panel(page).getByRole("radio", { name: "12 pm", exact: true }).check();
  await panel(page)
    .getByRole("button", { name: /^Book Thu/ })
    .click();
  const booked = panel(page).getByRole("status").filter({ hasText: "Payment link sent for Rs. 2,000." });
  await expect(booked).toContainText(opsCopy.clients.visits.book.draftTechnician("Sandeep Rawat"));
  await expect(panel(page).getByRole("button", { name: opsCopy.tasks.link.copy, exact: true })).toBeVisible();
  await expect(panel(page).getByRole("button", { name: opsCopy.tasks.link.resend, exact: true })).toBeVisible();
});

test("says a link that was not texted, and sends it again on asking", async ({ page }) => {
  await openVisits(page, {
    [BOOK]: json({ ...LINK_SENT, link: { ...LINK_SENT.link, texted: false } }, 201),
    "POST /api/holds/{id}/send-link": json({ outcome: "not_texted" }),
  });
  await page.getByRole("button", { name: opsCopy.clients.visits.book.open }).click();
  await panel(page).getByRole("radio", { name: "12 pm", exact: true }).check();
  await panel(page)
    .getByRole("button", { name: /^Book Thu/ })
    .click();
  await expect(panel(page).getByRole("status").first()).toContainText("Payment link made for Rs. 2,000, not texted.");
  await panel(page).getByRole("button", { name: opsCopy.tasks.link.resend }).click();
  await expect(panel(page)).toContainText(opsCopy.tasks.link.outcomes.not_texted);

  // Copied, it says so beneath the buttons, in no toast.
  await page.evaluate(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: () => Promise.resolve() },
    });
  });
  await panel(page).getByRole("button", { name: opsCopy.tasks.link.copy, exact: true }).click();
  await expect(panel(page).getByRole("status").filter({ hasText: opsCopy.tasks.link.copied })).toBeVisible();
  expect(await panel(page).locator("[data-toasts] [role=status]").count()).toBe(0);

  // The browser will not copy it: beneath the buttons, it says so, the link being written out above; no toast.
  await page.evaluate(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: () => Promise.reject(new Error("denied")) },
    });
  });
  await panel(page).getByRole("button", { name: opsCopy.tasks.link.copy, exact: true }).click();
  await expect(
    panel(page).getByRole("alert").filter({ hasText: opsCopy.clients.visits.book.inTheWay.notCopied }),
  ).toBeVisible();
  expect(await panel(page).locator("[data-toasts] [role=status]").count()).toBe(0);

  // Sent again once the booking has closed: why, in the booking's own words, beneath the buttons.
  await page.route("**/api/holds/*/send-link", fails(409, "hold_expired"));
  const sendAgain = panel(page).getByRole("button", { name: opsCopy.tasks.link.resend, exact: true });
  await sendAgain.click();
  const refused = panel(page)
    .getByRole("alert")
    .filter({ hasText: opsCopy.clients.visits.book.inTheWay.errors.hold_expired });
  await expect(refused).toBeVisible();
  expect(await beneath(refused, sendAgain)).toBe(true);
  await expect(sendAgain).toBeFocused();
});

test("names the booking held on its link that refuses another of its kind, and lets it go", async ({ page }) => {
  let letGo = false;
  let answer: () => void = () => undefined;
  const answered = new Promise<void>((resolve) => {
    answer = resolve;
  });
  await openVisits(page, {
    [BOOK]: json({ error: { code: "already_booked", request_id: "r-1" } }, 409),
    [`GET /api/clients/${CLIENT.id}/held-bookings`]: json({
      visit: null,
      held: [
        {
          hold_id: HOLD,
          type: "service",
          date: "2027-09-22",
          starts_at: "2027-09-22T06:30:00.000Z",
          amount: 200000,
          url: "https://rzp.io/i/stub4417",
          open_until: "2027-09-22T02:00:00.000Z",
          paid: false,
        },
      ],
    }),
    "POST /api/holds/{id}/let-go": async (route) => {
      letGo = true;
      await answered;
      await empty()(route);
    },
  });
  await page.getByRole("button", { name: opsCopy.clients.visits.book.open }).click();
  await panel(page).getByRole("radio", { name: "12 pm", exact: true }).check();
  await panel(page)
    .getByRole("button", { name: /^Book Thu/ })
    .click();
  await expect(panel(page).getByRole("alert")).toHaveText(opsCopy.clients.visits.book.errors.already_booked);
  await expect(panel(page)).toContainText(
    opsCopy.clients.visits.book.inTheWay.held(
      "service visit",
      "Wed 22 Sep, 12 pm",
      opsCopy.clients.visits.book.inTheWay.thatDay("7:30 am"),
    ),
  );
  const inTheWay = opsCopy.clients.visits.book.inTheWay;
  await panel(page)
    .getByRole("button", { name: `${inTheWay.letGo} · service visit, Wed 22 Sep, 12 pm`, exact: true })
    .click();
  // Asked once more, since its link stops working, on its safe answer; kept, nothing is let go, and the focus is
  // back where it was.
  const asked = panel(page).getByRole("group", { name: inTheWay.letGoAsk });
  await expect(asked.getByRole("button", { name: DISMISS.keep, exact: true })).toBeFocused();
  await asked.getByRole("button", { name: DISMISS.keep, exact: true }).click();
  expect(letGo).toBe(false);
  await expect(
    panel(page).getByRole("button", { name: `${inTheWay.letGo} · service visit, Wed 22 Sep, 12 pm` }),
  ).toBeFocused();
  await panel(page)
    .getByRole("button", { name: `${inTheWay.letGo} · service visit, Wed 22 Sep, 12 pm` })
    .click();
  await asked.getByRole("button", { name: inTheWay.letGo, exact: true }).click();
  // While it is let go, keeping it is no longer a choice.
  await expect(asked.getByRole("button", { name: DISMISS.keep, exact: true })).toBeDisabled();
  answer();
  await expect(panel(page)).toContainText(inTheWay.letGone);
  // The ask went with the refusal: the focus is on the panel's heading, not lost.
  await expect(panel(page).getByRole("heading", { name: `Book a visit for ${CLIENT.name}` })).toBeFocused();

  // Said once: another try refused, then another time chosen, says nothing of the let-go again.
  await panel(page)
    .getByRole("button", { name: /^Book Thu/ })
    .click();
  await expect(panel(page).getByRole("alert")).toHaveText(opsCopy.clients.visits.book.errors.already_booked);
  await panel(page).getByRole("radio", { name: "12:30 pm", exact: true }).check();
  await expect(panel(page).getByRole("alert")).toHaveCount(0);
  // Read once, at once: the toast goes by itself in six seconds, so a retrying read could pass without the fix.
  expect(await page.getByText(inTheWay.letGone).count()).toBe(0);
  expect(letGo).toBe(true);
});

// A hold for a visit booked days ahead ends on an earlier day; a let-go refused says why, and the hold stays.
test("names the day a hold ends before its visit, and says why a let-go was refused", async ({ page }) => {
  await openVisits(page, {
    [BOOK]: json({ error: { code: "already_booked", request_id: "r-1" } }, 409),
    [`GET /api/clients/${CLIENT.id}/held-bookings`]: json({
      visit: null,
      held: [
        {
          hold_id: HOLD,
          type: "service",
          date: "2027-09-24",
          starts_at: "2027-09-24T06:30:00.000Z",
          amount: 200000,
          url: "https://rzp.io/i/stub4417",
          open_until: "2027-09-22T13:30:00.000Z",
          paid: false,
        },
      ],
    }),
    "POST /api/holds/{id}/let-go": json({ error: { code: "hold_expired", request_id: "r-2" } }, 409),
    "POST /api/holds/{id}/send-link": json({ error: { code: "unavailable", request_id: "r-3" } }, 503),
  });
  await page.getByRole("button", { name: opsCopy.clients.visits.book.open }).click();
  await panel(page).getByRole("radio", { name: "12 pm", exact: true }).check();
  await panel(page)
    .getByRole("button", { name: /^Book Thu/ })
    .click();
  const inTheWay = opsCopy.clients.visits.book.inTheWay;
  await expect(panel(page)).toContainText(inTheWay.held("service visit", "Fri 24 Sep, 12 pm", "Wed 22 Sep, 7 pm"));

  // Asked at a phone's width: the ask brought into view clear of the Book bar, on its safe answer.
  await page.setViewportSize({ width: 360, height: 800 });
  await recordScrolls(page);
  const letGo = panel(page).getByRole("button", {
    name: `${inTheWay.letGo} · service visit, Fri 24 Sep, 12 pm`,
    exact: true,
  });
  await letGo.click();
  const asked = panel(page).getByRole("group", { name: inTheWay.letGoAsk });
  await expect(asked.getByRole("button", { name: DISMISS.keep, exact: true })).toBeFocused();
  expect(await broughtIntoView(page)).toContain(`${inTheWay.letGoAsk}${inTheWay.letGo}${DISMISS.keep}`);
  expect(await clearsTheBar(asked)).toBe(true);
  expect(await seen(asked)).toBe(true);
  // Refused, the ask goes and the focus is back on Let it go.
  await asked.getByRole("button", { name: inTheWay.letGo, exact: true }).click();
  await expect(panel(page)).toContainText(inTheWay.errors.hold_expired);
  await expect(asked).toHaveCount(0);
  await expect(letGo).toBeFocused();
  await expect(panel(page)).not.toContainText(inTheWay.letGone);

  // The browser will not copy its link: the link on its own line beneath the buttons, brought into view clear of the
  // Book bar with the buttons still in view, and in no toast.
  await page.evaluate(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: () => Promise.reject(new Error("denied")) },
    });
  });
  const copyLink = panel(page).getByRole("button", {
    name: `${opsCopy.tasks.link.copy} · service visit, Fri 24 Sep, 12 pm`,
    exact: true,
  });
  await copyLink.click();
  const line = panel(page)
    .getByRole("alert")
    .filter({ hasText: opsCopy.clients.visits.book.inTheWay.notCopiedHere("https://rzp.io/i/stub4417") });
  await expect(line).toBeVisible();
  expect(await beneath(line, copyLink)).toBe(true);
  expect(await broughtIntoView(page)).toContain(
    opsCopy.clients.visits.book.inTheWay.notCopiedHere("https://rzp.io/i/stub4417"),
  );
  expect(await clearsTheBar(line)).toBe(true);
  expect(await seen(line)).toBe(true);
  await expect(copyLink).toBeInViewport();
  expect(await panel(page).locator("[data-toasts] [role=status]").count()).toBe(0);
  // Pressed again, it is said again: a new message, the last one gone.
  const first = await line.elementHandle();
  await copyLink.click();
  await expect.poll(() => first.evaluate((node) => node.isConnected)).toBe(false);
  await expect(line).toBeVisible();

  // Sent again while Razorpay does not answer: why, beneath the buttons, brought into view clear of the bar.
  const sendAgain = panel(page).getByRole("button", {
    name: `${opsCopy.tasks.link.resend} · service visit, Fri 24 Sep, 12 pm`,
    exact: true,
  });
  await sendAgain.click();
  const refused = panel(page).getByRole("alert").filter({ hasText: opsCopy.tasks.link.errors.unavailable });
  await expect(refused).toBeVisible();
  await expect(sendAgain).toBeFocused();
  expect(await beneath(refused, sendAgain)).toBe(true);
  expect(await broughtIntoView(page)).toContain(opsCopy.tasks.link.errors.unavailable);
  expect(await clearsTheBar(refused)).toBe(true);
  expect(await seen(refused)).toBe(true);
  await expect(sendAgain).toBeInViewport();
  // The next press says only what it came to.
  await copyLink.click();
  await expect(refused).toHaveCount(0);
});
