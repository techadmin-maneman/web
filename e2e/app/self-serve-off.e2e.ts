// The client app with self-serve booking off, as production will run until the
// owner switches it on (docs/decisions/0045-self-serve-booking.md). Locally it
// is on, so the switch is turned off in the one answer the app reads it from,
// /api/me, and everything else is the local mm-api's. Off, no booking sheet
// opens anywhere: booking and changing a visit go to ops on WhatsApp, with a
// message ready, and a first consultation is booked on the public site.

import type { Page } from "@playwright/test";
import { PORTS } from "../../scripts/lib/local-stack.ts";
import { expect, test } from "../support.ts";
import { bookedNumber } from "./booked-numbers.ts";
import { fittedClient } from "./fitted.ts";
import { logIn } from "./signed-in.ts";
import * as appCopy from "../../apps/app/src/content.ts";

/**
 * Passes /api/me through with booking.self_serve false and no kind the client books, and anything else `also` changes. Only the browser resolves
 * app.localhost, so the answer is fetched from the app's server by its address, on the app's own host.
 */
async function selfServeOff(page: Page, also: Record<string, unknown> = {}): Promise<void> {
  await page.route("**/api/me", async (route) => {
    const answer = await route.fetch({
      url: `http://127.0.0.1:${String(PORTS.app)}/api/me`,
      headers: { ...route.request().headers(), host: `app.localhost:${String(PORTS.app)}` },
    });
    if (!answer.ok()) return route.fulfill({ response: answer });
    const me = (await answer.json()) as { booking: Record<string, unknown> };
    await route.fulfill({
      response: answer,
      json: { ...me, ...also, booking: { ...me.booking, self_serve: false, self_serve_kinds: [] } },
    });
  });
}

const WHATSAPP = "^https://wa\\.me/\\d+\\?text=";

test("a fitted client reschedules and books through WhatsApp, and no booking sheet opens", async ({ page }) => {
  await selfServeOff(page);
  await logIn(page, fittedClient().mobile);
  await expect(page.getByRole("heading", { level: 1, name: appCopy.home.next.label })).toBeVisible();

  await expect(page.getByRole("link", { name: appCopy.home.reschedule })).toHaveAttribute(
    "href",
    new RegExp(`${WHATSAPP}${encodeURIComponent("I’d like to move my service visit on")}`),
  );
  await expect(page.getByRole("button", { name: appCopy.home.reschedule })).toHaveCount(0);

  await page.getByRole("navigation").getByRole("link", { name: appCopy.titles.visits }).click();
  await expect(page.getByRole("link", { name: appCopy.home.next.book })).toHaveAttribute(
    "href",
    // Who is asking, so ops need not ask back; the day and window follow where the app offers one.
    new RegExp(`${WHATSAPP}${encodeURIComponent("I’d like to book my next visit. Rohit Malhotra.")}`),
  );
  await expect(page.getByRole("button", { name: appCopy.home.next.book })).toHaveCount(0);
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("a client with nothing booked is sent to the public site to book a consultation", async ({ page }) => {
  // A lead whose consultation has gone, as after cancelling it: nothing next, nothing asked for.
  await selfServeOff(page, { next_visit: null, consultation: null });
  await logIn(page, bookedNumber());

  const book = page.getByRole("link", { name: appCopy.home.nothing.book });
  await expect(book).toHaveAttribute("href", /\/book$/);
  await expect(page.getByRole("button", { name: appCopy.home.nothing.book })).toHaveCount(0);
});
