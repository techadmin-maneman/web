import { expect, test } from "../support.ts";
import { axeViolations } from "../a11y.ts";
import { CLIENT, empty, fails, json, NEW_RECORD, RECORD, type Call, type OpsReply } from "./fixtures.ts";
import { RECORD_PATH, READ_RECORD, openClient, meta } from "./clients-fixtures.ts";

const ADD_CREDITS: Call = `POST ${RECORD_PATH}/credits`;

// A discount code on a visit not yet paid for or invoiced (docs/decisions/0108-discount-codes.md), which no board draws.
test("enters a discount code on a visit not yet paid for, says when one does not apply, and takes it off", async ({
  page,
}) => {
  const [coming] = RECORD.visits.upcoming;
  if (coming === undefined) throw new Error("the record has no visit to come");
  const open = {
    ...RECORD,
    visits: { ...RECORD.visits, upcoming: [{ ...coming, prepaid: false, price_open: true }] },
  } satisfies OpsReply<"/api/clients/{id}">;
  const entered = `POST /api/visits/${coming.id}/discount-code` as const;
  const removed = `POST /api/visits/${coming.id}/discount-code/remove` as const;
  let applies = false;
  await openClient(page, `/clients/${CLIENT.id}/visits`, {
    [READ_RECORD]: json(open),
    [entered]: (route) => {
      if (applies) return json({ code: "WEDDNG25", amount_off: 50_000, given_by: "ops" })(route);
      const typed = (route.request().postDataJSON() as { code: string }).code;
      return fails(422, typed === "RPLC2K" ? "code_off" : "code_not_applicable")(route);
    },
    [removed]: empty(),
  });
  const row = page.getByRole("region", { name: "To come" }).getByRole("row").nth(1);
  await row.getByRole("button", { name: "Enter a discount code on the visit of 25 Sep 2027" }).click();
  await row.getByLabel("Discount code").fill("wrong1");
  await row.getByRole("button", { name: "Apply" }).click();
  await expect(row.getByRole("alert")).toHaveText("That code does not apply to this visit.");
  // One ops switched off said only that it did not apply.
  await row.getByLabel("Discount code").fill("RPLC2K");
  await row.getByRole("button", { name: "Apply" }).click();
  await expect(row.getByRole("alert")).toHaveText("That code is switched off.");

  applies = true;
  await row.getByLabel("Discount code").fill("weddng25");
  await row.getByRole("button", { name: "Apply" }).click();
  await expect(row).toContainText("WEDDNG25, Rs. 500 off");
  await expect(row).toContainText("by ops");
  expect(await axeViolations(page)).toEqual([]);

  await row.getByRole("button", { name: "Take the discount code off the visit of 25 Sep 2027" }).click();
  await expect(row.getByRole("button", { name: "Enter a discount code on the visit of 25 Sep 2027" })).toBeVisible();
});

// Once the one visit was booked, ops no longer saw the code the client gave when booking on the site.
test("shows the code the client gave when booking, and starts the box from it", async ({ page }) => {
  const [coming] = RECORD.visits.upcoming;
  if (coming === undefined) throw new Error("the record has no visit to come");
  const asked = {
    ...RECORD,
    visits: {
      ...RECORD.visits,
      upcoming: [{ ...coming, type: "first_fit" as const, prepaid: false, price_open: true, requested_code: "TENPC" }],
    },
  } satisfies OpsReply<"/api/clients/{id}">;
  await openClient(page, `/clients/${CLIENT.id}/visits`, { [READ_RECORD]: json(asked) });
  const row = page.getByRole("region", { name: "To come" }).getByRole("row").nth(1);
  await expect(row).toContainText("Client gave TENPC when booking");
  await row.getByRole("button", { name: "Enter a discount code on the visit of 25 Sep 2027" }).click();
  await expect(row.getByLabel("Discount code")).toHaveValue("TENPC");
});

test("offers no code on a visit already paid for", async ({ page }) => {
  await openClient(page, `/clients/${CLIENT.id}/visits`, { [READ_RECORD]: json(RECORD) });
  const row = page.getByRole("region", { name: "To come" }).getByRole("row").nth(1);
  await expect(row).toContainText("None");
  await expect(row.getByRole("button", { name: /discount code/ })).toHaveCount(0);
});

// A visit left partly done that ops closed without a follow-up, from the Tasks board (ADR 0092).
test("says who closed a visit left partly done without a follow-up, when and why", async ({ page }) => {
  const [done] = RECORD.visits.past;
  if (done === undefined) throw new Error("the record has no visit done");
  const closed = {
    ...RECORD,
    visits: {
      ...RECORD.visits,
      past: [
        {
          ...done,
          outcome: "partial" as const,
          closed_without_follow_up: {
            by: "priya@maneman.in",
            at: "2027-09-01T06:00:00.000Z",
            reason: "Moving to Pune; wants no more visits.",
          },
        },
      ],
    },
  } satisfies OpsReply<"/api/clients/{id}">;
  await openClient(page, `/clients/${CLIENT.id}/visits`, { [READ_RECORD]: json(closed) });
  await expect(page.getByRole("region", { name: "Done" }).getByRole("row").nth(1)).toContainText(
    "Closed without a follow-up by priya@maneman.in, 1 Sep 2027: Moving to Pune; wants no more visits.",
  );
});

test("lists what the client has paid, and what for", async ({ page }) => {
  await openClient(page, `/clients/${CLIENT.id}/payments`);
  const payment = page.getByRole("region", { name: "Payments and refunds" }).getByRole("row").nth(1);
  await expect(payment).toContainText("20 Aug 2027");
  await expect(payment).toContainText("Service visit of 22 Aug 2027");
  await expect(payment).toContainText("Rs. 2,360");
  await expect(payment).toContainText("Paid · Ref MM-2027-0841");
});

test("names the discount code a payment was made with, and what it took off", async ({ page }) => {
  const [paid] = RECORD.payments;
  const withCode = {
    ...RECORD,
    payments: paid === undefined ? [] : [{ ...paid, discount_code: { code: "AUDTEST", amount_off: 100_000 } }],
  } satisfies OpsReply<"/api/clients/{id}">;
  await openClient(page, `/clients/${CLIENT.id}/payments`, { [READ_RECORD]: json(withCode) });
  const payment = page.getByRole("region", { name: "Payments and refunds" }).getByRole("row").nth(1);
  await expect(payment).toContainText("Code AUDTEST, Rs. 1,000 off");
});

// A booking paid for and not yet a visit read as a bare "Payment".
test("names a payment for a booking not yet a visit by what is being booked", async ({ page }) => {
  const [paid] = RECORD.payments;
  const forBooking = {
    ...RECORD,
    payments:
      paid === undefined
        ? []
        : [{ ...paid, visit: null, booking: { type: "first_fit", date: "2027-10-04", under_way: true } }],
  } satisfies OpsReply<"/api/clients/{id}">;
  await openClient(page, `/clients/${CLIENT.id}/payments`, { [READ_RECORD]: json(forBooking) });
  const payment = page.getByRole("region", { name: "Payments and refunds" }).getByRole("row").nth(1);
  await expect(payment).toContainText("First fit of 4 Oct 2027");
});

// A client who lost Razorpay's text could not be sent the link again; the address sat only in D1.
test("lists the payment links sent, and copies an open one's address to send again", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await openClient(page, `/clients/${CLIENT.id}/payments`);
  const links = page.getByRole("region", { name: "Payment links" });
  const open = links.getByRole("row").nth(1);
  await expect(open).toContainText("21 Sep 2027");
  await expect(open).toContainText("Service visit, visit of 2 Oct 2027");
  await expect(open).toContainText("Rs. 2,360");
  await expect(open).toContainText("Waiting to be paid · Ref MM-2027-0902");
  await expect(open).toContainText("https://rzp.io/i/MMsv902");

  const copy = open.getByRole("button");
  await expect(copy).toHaveAccessibleName("Copy link · Service visit, visit of 2 Oct 2027");
  await copy.click();
  await expect(copy).toHaveAccessibleName("Copied · Service visit, visit of 2 Oct 2027");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("https://rzp.io/i/MMsv902");

  const paidLink = links.getByRole("row").nth(2);
  await expect(paidLink).toContainText("Paid 20 Aug 2027 · Ref MM-2027-0841");
  await expect(paidLink.getByRole("button")).toHaveCount(0);
});

test("says where each finished visit's invoice stands in Books", async ({ page }) => {
  const withDraft = {
    ...RECORD,
    invoices: [
      {
        visit_id: "33000000-0000-4000-8000-000000000003",
        date: "2027-09-01",
        type: "replacement",
        state: "draft",
        issued_at: null,
      },
      ...RECORD.invoices,
    ],
  } satisfies OpsReply<"/api/clients/{id}">;
  await openClient(page, `/clients/${CLIENT.id}/payments`, { [READ_RECORD]: json(withDraft) });
  const invoices = page.getByRole("region", { name: "Invoices" }).getByRole("row");
  await expect(invoices.nth(1)).toContainText("Replacement of 1 Sep 2027");
  await expect(invoices.nth(1)).toContainText("Draft in Books, not sent");
  await expect(invoices.nth(2)).toContainText("Service visit of 22 Aug 2027");
  await expect(invoices.nth(2)).toContainText("Sent 22 Aug 2027");
});

test("says so when nothing was linked or invoiced yet", async ({ page }) => {
  await openClient(page, `/clients/${CLIENT.id}/payments`, { [READ_RECORD]: json(NEW_RECORD) });
  await expect(page.getByRole("region", { name: "Payment links" })).toContainText("No payment links yet.");
  await expect(page.getByRole("region", { name: "Invoices" })).toContainText("No finished visit to invoice yet.");
});

// A credit given or taken in error once needed SQL to put right.
test("puts a client's credits right, with the reason, and shows the balance it answers", async ({ page }) => {
  await openClient(page, `/clients/${CLIENT.id}/payments`, {
    [ADD_CREDITS]: json({ visits: 1, earliest_expiry: "2028-01-03T06:00:00.000Z" }),
  });
  const credits = page.getByRole("region", { name: "Free service visits" });
  await expect(credits).toContainText("2 visits · use by 3 Jan 2028");
  const save = credits.getByRole("button", { name: "Put the credits right" });
  await expect(save).toBeDisabled();

  await credits.getByLabel("Visits to add, or to take away with a minus").fill("-1");
  await credits.getByRole("radio", { name: "Correction: given or taken in error" }).check();
  const sent = page.waitForRequest((request) => request.url().endsWith("/credits") && request.method() === "POST");
  await save.click();
  expect((await sent).postDataJSON()).toEqual({ visits: -1, reason: "correction" });

  await expect(credits.getByRole("status")).toHaveText("Done. They now hold 1 visit.");
  // The head reads the balance the API answered, without the record being read again.
  await expect(meta(page).nth(1)).toHaveText("1 · use by 3 Jan 2028");
});

test("offers no change of nought, or of more than twelve visits either way", async ({ page }) => {
  await openClient(page, `/clients/${CLIENT.id}/payments`);
  const credits = page.getByRole("region", { name: "Free service visits" });
  await credits.getByRole("radio", { name: "Goodwill: to make up for something" }).check();
  const field = credits.getByLabel("Visits to add, or to take away with a minus");
  const save = credits.getByRole("button", { name: "Put the credits right" });
  for (const typed of ["0", "13", "-13", "two"]) {
    await field.fill(typed);
    await expect(save, typed).toBeDisabled();
  }
  await field.fill("12");
  await expect(save).toBeEnabled();
});

test("says so when the API would take away more than the client holds", async ({ page }) => {
  await openClient(page, `/clients/${CLIENT.id}/payments`, {
    [ADD_CREDITS]: fails(400, "invalid_request"),
  });
  const credits = page.getByRole("region", { name: "Free service visits" });
  await credits.getByLabel("Visits to add, or to take away with a minus").fill("-5");
  await credits.getByRole("radio", { name: "Correction: given or taken in error" }).check();
  await credits.getByRole("button", { name: "Put the credits right" }).click();
  await expect(credits.getByRole("alert")).toContainText("That would take away more visits than they hold");
});
