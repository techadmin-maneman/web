// Every page of the client app on a phone, held at 390 and 360 px and at 360 with its text at 130% (./text-sizes.ts;
// docs/prompts/client-redesign.md, "Acceptance"): sign-in, its code and help screens; each of the app's pages with a
// visit to come, a past one, a payment open and an issue; the offline bar, the account that would not load, a page
// loading and one that failed; the change sheet, its move and its cancel, free and inside the notice; and the booking
// sheet's day and time, its review, a payment refused, the hold run out, its wait, the visit booked, slow to book, or
// refunded. The sheets and the visit's day on Home are ./large-text-sheets.e2e.ts's.

import type { Page } from "@playwright/test";
import { expect, randomMobile, test } from "../support.ts";
import { AGREE_TERMS, openSheet, passedThrough, PAY_SERVICE, profileAs } from "./booking-fixtures.ts";
import {
  confirmedByRazorpay,
  fakeCheckout,
  noRealCheckout,
  paidNotYetBooked,
  refundedAfterPaying,
} from "./checkout-fakes.ts";
import { continueToPayment, OPEN_DAYS, WHEN_STEP } from "./picking.ts";
import { holds, named, signedIn, SIZES } from "./text-sizes.ts";
import { LOCAL_PRICES } from "../prices.ts";
import { booking, change, errors, home, login, states, titles } from "../../apps/app/src/content.ts";

const PAGES = [
  "/",
  "/visits",
  "/visits/issues",
  "/visits/issues/new",
  "/photos",
  "/rewards",
  "/rewards/invited",
  "/profile",
  "/profile/payments",
  "/profile/address",
  "/profile/privacy",
  "/profile/account",
  "/alerts",
  "/hair-system",
  "/hair-systems",
] as const;

/** A report the client raised, answered by Care, its words long enough to wrap: the issue log's one entry. */
const ISSUE = {
  kind: "report",
  id: "6f0f8a52-2f53-4c39-9d43-3b1f5f0b6d21",
  reference: "MM-ISS-4417",
  category: "edges_lifting",
  state: "in_progress",
  raised_at: new Date().toISOString(),
  visit_id: null,
  text: "The front edge lifts by the evening, most days since the last service visit, and the tape shows at the hairline.",
  photos: 2,
  events: [
    { at: new Date().toISOString(), kind: "you", name: null, text: "It lifted again this morning, on the left side." },
    {
      at: new Date().toISOString(),
      kind: "care",
      name: "Priyanka",
      text: "Thank you. Your technician will look at the edge first thing on your next visit.",
    },
  ],
} as const;

/** The booking sheet at its review, Checkout faked as `paid` or refused, nothing real loaded. */
async function atReview(page: Page, outcome: "paid" | "failed") {
  await noRealCheckout(page);
  await fakeCheckout(page, outcome);
  await openSheet(page);
  await expect(page.getByRole("dialog", { name: WHEN_STEP })).toBeVisible();
  await continueToPayment(page);
  const review = page.getByRole("dialog", { name: booking.pay.title });
  await expect(review).toBeVisible();
  return review;
}

/** Pays from the review, its terms agreed to. */
async function pay(page: Page) {
  const review = page.getByRole("dialog", { name: booking.pay.title });
  await review.getByRole("checkbox", { name: AGREE_TERMS }).check();
  await review.getByRole("button", { name: PAY_SERVICE }).click();
}

/** The hold's word once paid held back, answered once `answer` is called, or never. */
async function pollHeld(page: Page) {
  let paying = false;
  let answer: () => void = () => undefined;
  const answered = new Promise<void>((resolve) => {
    answer = resolve;
  });
  await page.route(/\/api\/holds\/[0-9a-f-]{36}$/, async (route) => {
    if (paying && route.request().method() === "GET") await answered;
    await route.fallback();
  });
  return {
    paying: () => {
      paying = true;
    },
    answer: () => {
      answer();
    },
  };
}

/** What a change inside the notice costs: the move charged or a late fee, the cancel keeping all or a fee. */
type Late = { readonly move: "charged" | "late_fee"; readonly cancelKeeps: "all" | "fee" };

/**
 * The visit's change terms answered as inside its notice, as `late()` says each time they are read, and as paid for
 * ahead, which is what a late change keeps.
 */
async function lateTerms(page: Page, late: () => Late) {
  const paid = LOCAL_PRICES.service;
  await passedThrough(page, "**/api/appointments/*/reschedule", (terms: Record<string, unknown>) =>
    "visit_id" in terms ? { ...terms, notice: "late", cost: late().move, paid } : terms,
  );
  await passedThrough(page, "**/api/appointments/*/cancel", (terms: Record<string, unknown>) => {
    if (!("visit_id" in terms)) return terms;
    const kept = late().cancelKeeps === "all" ? paid : Math.round(paid / 4);
    return { ...terms, notice: "late", paid, kept, refund: paid - kept };
  });
}

for (const size of SIZES) {
  test(`signing in, its code and its help hold at ${named(size)}`, async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1, name: login.mobile.title })).toBeVisible();
    await holds(page, size, "number");
    await page.getByRole("textbox", { name: login.mobile.label }).fill(randomMobile());
    await page.getByRole("button", { name: login.mobile.send }).click();
    await expect(page.getByRole("heading", { level: 1, name: login.code.title })).toBeVisible();
    await holds(page, size, "code");
    await page.getByRole("button", { name: login.code.noBooking }).click();
    await expect(page.getByRole("heading", { level: 1, name: login.code.noBooking })).toBeVisible();
    await holds(page, size, "help");
  });

  test(`every page holds at ${named(size)}`, async ({ page }) => {
    test.setTimeout(120_000);
    // Counts drawn over the bell and the tabs, as a client with news has them, whatever other tests have left.
    // The fake leaves an answer that is not the client's alone, as sign-in's refusal, as it was.
    await passedThrough(page, "**/api/me", (me: Record<string, unknown>) =>
      "alerts_unread" in me ? { ...me, alerts_unread: 2, issues_open: 1 } : me,
    );
    // An issue raised and answered, in the log and on its own page, without raising one for every other test to see.
    await page.route("**/api/me/problems", (route) =>
      route.request().method() === "GET" ? route.fulfill({ json: { issues: [ISSUE] } }) : route.fallback(),
    );
    const fitted = await signedIn(page);
    const opened = [
      `/visits/${fitted.next.id}`,
      `/visits/${fitted.service.id}`,
      `/profile/payments/${fitted.servicePayment}`,
      `/visits/issues/${ISSUE.reference}`,
    ];
    for (const path of [...PAGES, ...opened]) {
      await page.goto(path);
      // An issue's page heads its header with its reference and its body with what it is about: two first headings.
      await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
      await expect(page.getByRole("heading", { level: 1, name: login.mobile.title })).toHaveCount(0);
      // A page's heading comes before what it reads, as the hair systems' list: each is measured once it has read it.
      await page.waitForLoadState("networkidle");
      await holds(page, size, path);
    }
  });

  test(`the offline bar, the account not loaded, and pages loading or failed hold at ${named(size)}`, async ({
    page,
  }) => {
    await signedIn(page);
    await page.context().setOffline(true);
    await expect(page.getByRole("status").filter({ hasText: states.offline })).toBeVisible();
    await holds(page, size, "offline");
    await page.context().setOffline(false);
    await expect(page.getByText(states.offline)).toBeHidden();

    // The account refused as the app opens: the design's own failure, with its two ways on.
    await page.route("**/api/me", (route) => route.abort());
    await page.reload();
    await expect(page.getByRole("heading", { level: 1, name: states.error.title })).toBeVisible();
    await holds(page, size, "account not loaded");
    await page.unroute("**/api/me");

    // A page's read held unanswered, the page loading; the photographs' own skeleton, then the shared one.
    await page.route("**/api/photos", () => undefined);
    await page.goto("/photos");
    await expect(page.getByRole("heading", { level: 1, name: titles.photos })).toBeVisible();
    await holds(page, size, "photos loading");
    await page.route("**/api/me/alerts", () => undefined);
    await page.goto("/alerts");
    await expect(page.getByRole("heading", { level: 1, name: titles.alerts })).toBeVisible();
    await holds(page, size, "loading");
    // Then refused, the page failed.
    await page.unroute("**/api/me/alerts");
    await page.route("**/api/me/alerts", (route) => route.abort());
    await page.goto("/alerts");
    await expect(page.getByRole("button", { name: errors.retry })).toBeVisible();
    await holds(page, size, "failed");
  });

  test(`changing a visit, its move and its cancel, hold at ${named(size)}`, async ({ page }) => {
    // A profile with its address whole, so the move opens on its days, whatever other tests leave on the client's.
    await profileAs(page, {});
    await signedIn(page);
    await page.getByRole("button", { name: home.reschedule }).click();
    // The sheet opens loading what moving costs; it is measured once it says, its move row there.
    const sheet = page.getByRole("dialog");
    await expect(sheet.getByRole("button", { name: change.move.pick })).toBeVisible();
    await holds(page, size, "change");
    await sheet.getByRole("button", { name: change.move.pick }).click();
    await expect(page.getByRole("dialog", { name: booking.when.titleMove }).locator(OPEN_DAYS).first()).toBeVisible();
    await holds(page, size, "move");
    // Nothing is moved or cancelled: the page opens again, and the sheet with it, for the cancel's own step.
    await page.reload();
    await page.getByRole("button", { name: home.reschedule }).click();
    await sheet.getByRole("button", { name: change.move.cancelInstead }).click();
    await expect(page.getByRole("dialog", { name: /^Cancel \w+day’s visit$/ })).toBeVisible();
    await holds(page, size, "cancel");
  });

  test(`a change inside the notice, charged or a late fee, holds at ${named(size)}`, async ({ page }) => {
    const ways = [
      { move: "charged", cancelKeeps: "all" },
      { move: "late_fee", cancelKeeps: "fee" },
    ] as const satisfies readonly Late[];
    let late: Late = ways[0];
    await lateTerms(page, () => late);
    await signedIn(page);
    const sheet = page.getByRole("dialog");
    for (const way of ways) {
      late = way;
      await page.reload();
      await page.getByRole("button", { name: home.reschedule }).click();
      await expect(sheet.getByRole("button", { name: change.move.accept })).toBeVisible();
      await holds(page, size, `late move, ${way.move}`);
      await sheet.getByRole("button", { name: change.move.cancelInstead }).click();
      await expect(sheet.getByRole("button", { name: change.cancel.accept })).toBeVisible();
      await holds(page, size, `late cancel, keeping ${way.cancelKeeps}`);
    }
  });

  test(`booking's day and time, its review, its wait and the visit booked hold at ${named(size)}`, async ({ page }) => {
    test.setTimeout(120_000);
    await confirmedByRazorpay(page);
    const poll = await pollHeld(page);
    await noRealCheckout(page);
    await fakeCheckout(page, "paid");
    await openSheet(page);
    await expect(page.getByRole("dialog", { name: WHEN_STEP })).toBeVisible();
    await holds(page, size, "day and time");
    await continueToPayment(page);
    await expect(page.getByRole("dialog", { name: booking.pay.title })).toBeVisible();
    await holds(page, size, "review");
    poll.paying();
    await pay(page);
    await expect(page.getByRole("dialog").getByRole("status").getByText(booking.confirming.paid)).toBeVisible();
    await holds(page, size, "wait");
    poll.answer();
    await expect(page.getByRole("dialog", { name: booking.confirmed.label.service })).toBeVisible();
    await holds(page, size, "booked");
  });

  test(`a payment refused, then the hold run out, hold at ${named(size)}`, async ({ page }) => {
    test.setTimeout(120_000);
    await page.clock.install();
    const review = await atReview(page, "failed");
    await pay(page);
    await expect(review.getByRole("alert").getByText(booking.failed.title)).toBeVisible();
    await holds(page, size, "payment refused");
    await page.clock.fastForward("11:00");
    await expect(page.getByRole("dialog", { name: booking.expired.title })).toBeVisible();
    await holds(page, size, "hold run out");
  });

  test(`a visit slow to book holds at ${named(size)}`, async ({ page }) => {
    test.setTimeout(120_000);
    // Paid, and still not booked a minute on.
    await page.clock.install();
    await paidNotYetBooked(page);
    await atReview(page, "paid");
    await pay(page);
    await expect(page.getByRole("dialog").getByRole("status").getByText(booking.confirming.paid)).toBeVisible();
    await page.clock.fastForward("02:00");
    await expect(page.getByRole("dialog", { name: booking.slow.title })).toBeVisible();
    await holds(page, size, "slow");
  });

  test(`a visit refunded holds at ${named(size)}`, async ({ page }) => {
    test.setTimeout(120_000);
    // Paid, and the time given back with the payment refunded.
    await refundedAfterPaying(page);
    await atReview(page, "paid");
    await pay(page);
    await expect(page.getByRole("dialog", { name: booking.refunded.title })).toBeVisible();
    await holds(page, size, "refunded");
  });
}
