// Every page of the client app on a phone, at 390 and 360 px, and at 360 with its text at 130%
// (docs/prompts/client-redesign.md, "Acceptance"): sign-in, its code and help screens; each of the app's pages with a
// visit to come, a past one, a payment open and an issue; the offline bar, a page loading and one that failed; the
// change sheet, its move and its cancel; the booking sheet's day and time, its review, its wait and the visit booked;
// and the other sheets and asks: a note, the rating, the invite and the sign-off. Nothing spills out of its box, as a
// name running into the next, and nothing scrolls sideways, the page itself included, but a row made to, which hides
// its bar: the photographs' angles and the booking's days. Larger text is drawn as the browser's zoom draws it, which
// grows the page's type and its boxes alike: the stricter of the two ways a phone enlarges text.

import type { Page } from "@playwright/test";
import { indiaDate } from "../../packages/web-kit/dates.ts";
import { expect, randomMobile, test } from "../support.ts";
import { AGREE_TERMS, openSheet, passedThrough, PAY_SERVICE, profileAs } from "./booking-fixtures.ts";
import { confirmedByRazorpay, fakeCheckout, noRealCheckout } from "./checkout-fakes.ts";
import { fittedClient } from "./fitted.ts";
import { continueToPayment, OPEN_DAYS, WHEN_STEP } from "./picking.ts";
import { logIn } from "./signed-in.ts";
import {
  booking,
  change,
  errors,
  home,
  live,
  login,
  note,
  refer,
  states,
  titles,
  visits,
} from "../../apps/app/src/content.ts";

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

/** Each size a page is held at: its width, and how much its text is enlarged. */
const SIZES = [
  { width: 390, zoom: 1 },
  { width: 360, zoom: 1 },
  { width: 360, zoom: 1.3 },
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

/** The sign-off of a fit, asked for and not yet given, as the live card reads it. */
const SIGN_OFF_ASKED = {
  state: "asked",
  checks: null,
  flag_text: null,
  declined_reason: null,
  asked_at: new Date().toISOString(),
  asks: 1,
  signed_at: null,
  guarantee_days: null,
} as const;

/**
 * What spills, or scrolls sideways, on the page and in any sheet open on it. Words spill when they run out of the box
 * they are in, as a name into the next, and a box when it runs past its parent's edge; a count set over an icon's
 * corner on purpose is no spill, being placed so. A box scrolls sideways when it is a scroller whose bar shows, as the page's main or a sheet's body; a row
 * made to scroll sideways hides its bar, as the photographs' angles and the booking's days. Words kept for a screen
 * reader alone (packages/ui/VisuallyHidden.tsx) are out of sight.
 */
function spills(page: Page) {
  return page.evaluate(() => {
    const unseen = (node: Element | null): boolean =>
      node !== null && (getComputedStyle(node).clipPath === "inset(50%)" || unseen(node.parentElement));
    const shown = [...document.querySelectorAll<HTMLElement>("header, header *, main, main *, nav *, dialog *")].filter(
      (box) => box.closest("svg") === null && !unseen(box),
    );
    const spilled = shown.flatMap((box) => {
      const own = [...box.childNodes].filter(
        (node) => node.nodeType === Node.TEXT_NODE && (node.textContent ?? "").trim() !== "",
      );
      if (own.length === 0) return [];
      const words = document.createRange();
      words.setStartBefore(own[0] as Node);
      words.setEndAfter(own.at(-1) as Node);
      const [text, edge] = [words.getBoundingClientRect(), box.getBoundingClientRect()];
      const out = text.right > edge.right + 1 || text.left < edge.left - 1;
      return out ? [`${box.tagName.toLowerCase()} "${box.textContent.trim().slice(0, 40)}"`] : [];
    });
    // A box running past its parent's edge, as a row of buttons wider than its card, though each keeps its words. A box
    // set absolutely, as a count over an icon's corner, is placed so on purpose; the children of a box that clips or
    // scrolls are its own to hold, measured as it scrolls.
    const overrun = shown.flatMap((box) => {
      const parent = box.parentElement;
      if (parent === null || ["absolute", "fixed"].includes(getComputedStyle(box).position)) return [];
      if (["hidden", "clip", "auto", "scroll"].includes(getComputedStyle(parent).overflowX)) return [];
      const [own, edge] = [box.getBoundingClientRect(), parent.getBoundingClientRect()];
      const out = own.width > 0 && (own.right > edge.right + 1 || own.left < edge.left - 1);
      return out ? [`${box.tagName.toLowerCase()} "${box.textContent.trim().slice(0, 40)}" past its box`] : [];
    });
    const scrolling = shown
      .filter((box) => {
        const style = getComputedStyle(box);
        const scroller = style.overflowX === "auto" || style.overflowX === "scroll";
        return scroller && style.scrollbarWidth !== "none" && box.scrollWidth > box.clientWidth + 1;
      })
      .map((box) => `${box.tagName.toLowerCase()} scrolls sideways`);
    return {
      spilled: [...spilled, ...overrun, ...scrolling],
      sideways: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    };
  });
}

/** Sets the page at a size, its text enlarged as the browser's zoom enlarges it. */
async function sized(page: Page, size: (typeof SIZES)[number]) {
  await page.setViewportSize({ width: size.width, height: 760 });
  if (size.zoom !== 1) await page.addStyleTag({ content: `html { zoom: ${String(size.zoom)}; }` });
}

/**
 * The text back at its own size, so the test can tap: a page zoomed in the stylesheet is drawn where Playwright does
 * not aim. Only what is measured is zoomed.
 */
async function unzoomed(page: Page) {
  await page.addStyleTag({ content: "html { zoom: 1; }" });
}

/** The page measured at `size`, then its text set back to tap on. */
async function holds(page: Page, size: (typeof SIZES)[number], what: string) {
  await sized(page, size);
  expect(await spills(page), what).toEqual({ spilled: [], sideways: false });
  await unzoomed(page);
}

const named = (size: (typeof SIZES)[number]) => `${String(size.width)} px, text at ${String(size.zoom * 100)}%`;

/** Signed in as the fitted client, before any page is asked for: one asked sooner is the sign-in screen. */
async function signedIn(page: Page) {
  const fitted = fittedClient();
  await logIn(page, fitted.mobile);
  await expect(page.getByRole("navigation").first()).toBeVisible();
  return fitted;
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
      await sized(page, size);
      expect(await spills(page), path).toEqual({ spilled: [], sideways: false });
    }
  });

  test(`the offline bar, a page loading and a page that failed hold at ${named(size)}`, async ({ page }) => {
    await signedIn(page);
    await page.context().setOffline(true);
    await expect(page.getByRole("status").filter({ hasText: states.offline })).toBeVisible();
    await holds(page, size, "offline");
    await page.context().setOffline(false);
    await expect(page.getByText(states.offline)).toBeHidden();

    // The inbox's read held unanswered, its page loading; then refused, its page failed.
    await page.route("**/api/me/alerts", () => undefined);
    await page.goto("/alerts");
    await expect(page.getByRole("heading", { level: 1, name: titles.alerts })).toBeVisible();
    await holds(page, size, "loading");
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
    // Nothing is moved or cancelled: the sheet closes, and opens again for the cancel's own step.
    await page.getByRole("dialog").getByRole("button", { name: booking.close }).click();
    await page.getByRole("button", { name: home.reschedule }).click();
    await sheet.getByRole("button", { name: change.move.cancelInstead }).click();
    await expect(page.getByRole("dialog", { name: /^Cancel \w+day’s visit$/ })).toBeVisible();
    await holds(page, size, "cancel");
  });

  test(`booking's day and time, its review, its wait and the visit booked hold at ${named(size)}`, async ({ page }) => {
    test.setTimeout(120_000);
    await noRealCheckout(page);
    await fakeCheckout(page, "paid");
    await confirmedByRazorpay(page);
    // The hold's first word once paid is held back, so the wait is seen before the visit booked.
    let paying = false;
    let answer: () => void = () => undefined;
    const answered = new Promise<void>((resolve) => {
      answer = resolve;
    });
    await page.route(/\/api\/holds\/[0-9a-f-]{36}$/, async (route) => {
      if (paying && route.request().method() === "GET") await answered;
      await route.fallback();
    });
    await openSheet(page);
    await expect(page.getByRole("dialog", { name: WHEN_STEP })).toBeVisible();
    await holds(page, size, "day and time");
    await continueToPayment(page);
    const review = page.getByRole("dialog", { name: booking.pay.title });
    await expect(review).toBeVisible();
    await holds(page, size, "review");
    await review.getByRole("checkbox", { name: AGREE_TERMS }).check();
    paying = true;
    await review.getByRole("button", { name: PAY_SERVICE }).click();
    await expect(page.getByRole("dialog").getByRole("status").getByText(booking.confirming.paid)).toBeVisible();
    await holds(page, size, "wait");
    answer();
    await expect(page.getByRole("dialog", { name: booking.confirmed.label.service })).toBeVisible();
    await holds(page, size, "booked");
  });

  test(`a note, the rating, the invite and the sign-off hold at ${named(size)}`, async ({ page }) => {
    test.setTimeout(120_000);
    const fitted = await signedIn(page);
    await page.goto(`/visits/${fitted.next.id}`);
    await page.getByRole("button", { name: home.note }).click();
    await expect(page.getByRole("dialog").getByRole("textbox", { name: note.label })).toBeVisible();
    await holds(page, size, "note");

    // A low rating, given in the API's place, and its thanks with the way to say what went wrong.
    const rating = visits.detail.rating;
    await page.route(`**/api/visits/${fitted.service.id}/rating`, (route) =>
      route.fulfill({ status: 201, json: { stars: 3, at: new Date().toISOString(), low: true } }),
    );
    await page.goto(`/visits/${fitted.service.id}`);
    await page
      .getByRole("group", { name: rating.label })
      .getByRole("button", { name: rating.star(3) })
      .click();
    await expect(page.getByText(rating.low)).toBeVisible();
    await holds(page, size, "rating");

    await page.goto("/rewards");
    await page.getByRole("button", { name: refer.inviteOnWhatsApp }).click();
    await expect(page.getByRole("dialog", { name: refer.card.title })).toBeVisible();
    await holds(page, size, "invite");

    // The next visit answered as a fit today, its sign-off asked for; an answer with no visit is left as it was.
    await passedThrough(page, "**/api/me", (me: Record<string, unknown>) =>
      typeof me.next_visit === "object" && me.next_visit !== null
        ? {
            ...me,
            next_visit: {
              ...me.next_visit,
              date: indiaDate(new Date().toISOString()),
              type: "replacement",
              status: "in_progress",
              stage: "in_progress",
              latest_update: null,
              step: { index: 5, of: 5, name: "sign_off" },
              sign_off: SIGN_OFF_ASKED,
            },
          }
        : me,
    );
    await page.goto("/");
    await expect(page.getByRole("button", { name: live.signOff.happy })).toBeVisible();
    await holds(page, size, "sign-off");
  });
}
