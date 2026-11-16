// Every page of the client app on a phone, at 390 and 360 px, and at 360 with its text at 130%
// (docs/prompts/client-redesign.md, "Acceptance"): sign-in, each of the app's pages with a visit to come, a past one and
// a payment open, the change sheet, and the booking sheet's day and time and its review. Nothing spills out of its box, as a name running into the
// next, and nothing scrolls sideways, the page itself included, but a row made to, which hides its bar: the
// photographs' angles and the booking's days. Larger text is drawn as the browser's zoom draws it, which grows the
// page's type and its boxes alike: the stricter of the two ways a phone enlarges text.

import type { Page } from "@playwright/test";
import { expect, test } from "../support.ts";
import { openSheet } from "./booking-fixtures.ts";
import { fittedClient } from "./fitted.ts";
import { continueToPayment, WHEN_STEP } from "./picking.ts";
import { logIn } from "./signed-in.ts";
import { booking, home, login } from "../../apps/app/src/content.ts";

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

/**
 * What spills out of its own box, or scrolls sideways, on the page and in any sheet open on it. A box excused is
 * excused alone, never what it holds: one that clips, as a sheet's panel or the photographs' slider, and a row made to
 * scroll sideways, which hides its bar, as the photographs' angles and the booking's days.
 */
function spills(page: Page) {
  return page.evaluate(() => {
    const excused = (box: Element) => {
      const style = getComputedStyle(box);
      if (style.overflowX === "hidden" || style.overflowX === "clip") return true;
      return (style.overflowX === "auto" || style.overflowX === "scroll") && style.scrollbarWidth === "none";
    };
    // Words kept for a screen reader alone (packages/ui/VisuallyHidden.tsx) are out of sight, so a box within them, or
    // holding only them, shows nothing that could spill.
    const hides = (node: Element) => getComputedStyle(node).clipPath === "inset(50%)";
    const unseen = (node: Element | null): boolean => node !== null && (hides(node) || unseen(node.parentElement));
    const shows = (box: HTMLElement) => {
      if (unseen(box)) return false;
      const words = document.createTreeWalker(box, NodeFilter.SHOW_TEXT);
      for (let word = words.nextNode(); word !== null; word = words.nextNode()) {
        if ((word.textContent ?? "").trim() !== "" && !unseen(word.parentElement)) return true;
      }
      return box.querySelector("img, input, svg, video") !== null;
    };
    // A page's scroller, as its main or a sheet's body, is a box like any other: what it scrolls sideways spills.
    const spilled = [...document.querySelectorAll<HTMLElement>("header, header *, main, main *, nav *, dialog *")]
      .filter((box) => box.closest("svg") === null && !excused(box) && shows(box))
      .filter((box) => box.clientWidth > 0 && box.scrollWidth > box.clientWidth + 1)
      .map((box) => `${box.tagName.toLowerCase()} "${box.textContent.trim().slice(0, 40)}"`);
    return { spilled, sideways: document.documentElement.scrollWidth > document.documentElement.clientWidth };
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

const named = (size: (typeof SIZES)[number]) => `${String(size.width)} px, text at ${String(size.zoom * 100)}%`;

for (const size of SIZES) {
  test(`signing in holds at ${named(size)}`, async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1, name: login.mobile.title })).toBeVisible();
    await sized(page, size);
    expect(await spills(page)).toEqual({ spilled: [], sideways: false });
  });

  test(`every page holds at ${named(size)}`, async ({ page }) => {
    test.setTimeout(120_000);
    const fitted = fittedClient();
    await logIn(page, fitted.mobile);
    // Signed in before any page is asked for: a page asked for sooner is the sign-in screen, which measures nothing.
    await expect(page.getByRole("navigation").first()).toBeVisible();
    const opened = [
      `/visits/${fitted.next.id}`,
      `/visits/${fitted.service.id}`,
      `/profile/payments/${fitted.servicePayment}`,
    ];
    for (const path of [...PAGES, ...opened]) {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await expect(page.getByRole("heading", { level: 1, name: login.mobile.title })).toHaveCount(0);
      // A page's heading comes before what it reads, as the hair systems' list: each is measured once it has read it.
      await page.waitForLoadState("networkidle");
      await sized(page, size);
      expect(await spills(page), path).toEqual({ spilled: [], sideways: false });
    }
  });

  test(`changing a visit holds at ${named(size)}`, async ({ page }) => {
    await logIn(page, fittedClient().mobile);
    await page.getByRole("button", { name: home.reschedule }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await sized(page, size);
    expect(await spills(page), "change").toEqual({ spilled: [], sideways: false });
  });

  test(`booking's day and time, and its review, hold at ${named(size)}`, async ({ page }) => {
    test.setTimeout(120_000);
    await openSheet(page);
    await expect(page.getByRole("dialog", { name: WHEN_STEP })).toBeVisible();
    await sized(page, size);
    expect(await spills(page), "day and time").toEqual({ spilled: [], sideways: false });
    await unzoomed(page);
    await continueToPayment(page);
    await expect(page.getByRole("dialog", { name: booking.pay.title })).toBeVisible();
    await sized(page, size);
    expect(await spills(page), "review").toEqual({ spilled: [], sideways: false });
  });
}
