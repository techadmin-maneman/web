// Every page of the client app on a small phone, at 360 px, and with its text at 130% (docs/prompts/client-redesign.md,
// "Acceptance"): nothing spills out of its box, as a name running into the next, and nothing scrolls sideways but a
// row made to, as the photographs' angles. Larger text is drawn as the browser's zoom draws it, which grows the page's
// type and its boxes alike: the stricter of the two ways a phone enlarges text.

import type { Page } from "@playwright/test";
import { expect, test } from "../support.ts";
import { fittedClient } from "./fitted.ts";
import { logIn } from "./signed-in.ts";
import { login } from "../../apps/app/src/content.ts";

const PATHS = [
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
];

/** What spills out of its own box on the page, outside a row made to scroll sideways, and how far the page scrolls. */
function spills(page: Page) {
  return page.evaluate(() => {
    /** A box that clips what it holds, or a row that scrolls sideways because it is made to. */
    const holds = (box: Element) => {
      const sideways = getComputedStyle(box).overflowX;
      if (sideways === "hidden" || sideways === "clip") return true;
      return (sideways === "auto" || sideways === "scroll") && box.scrollWidth > box.clientWidth + 1;
    };
    const inside = (box: HTMLElement): boolean =>
      box.parentElement !== null && (holds(box.parentElement) || inside(box.parentElement));
    const spilled = [...document.querySelectorAll<HTMLElement>("header *, main *, nav *")]
      .filter((box) => box.closest("svg") === null && !holds(box) && !inside(box))
      .filter((box) => box.clientWidth > 0 && box.scrollWidth > box.clientWidth + 1)
      .map((box) => box.textContent.trim().slice(0, 40));
    return { spilled, sideways: document.documentElement.scrollWidth > document.documentElement.clientWidth };
  });
}

for (const zoom of [1, 1.3]) {
  test(`every page holds at 360 px with its text at ${String(Math.round(zoom * 100))}%`, async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 360, height: 740 });
    await logIn(page, fittedClient().mobile);
    // Signed in before any page is asked for: a page asked for sooner is the sign-in screen, which measures nothing.
    await expect(page.getByRole("navigation").first()).toBeVisible();
    for (const path of PATHS) {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await expect(page.getByRole("heading", { level: 1, name: login.mobile.title })).toHaveCount(0);
      // A page's heading comes before what it reads, as the hair systems' list: each is measured once it has read it.
      await page.waitForLoadState("networkidle");
      if (zoom !== 1) await page.addStyleTag({ content: `html { zoom: ${String(zoom)}; }` });
      expect(await spills(page), path).toEqual({ spilled: [], sideways: false });
    }
  });
}
